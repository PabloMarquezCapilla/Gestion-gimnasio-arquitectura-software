import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { CacheLookup, CacheTicket, OcupacionCache } from './ocupacion';

// Todos los scripts usan dos claves del mismo hash slot. Los tokens aleatorios evitan ABA al expirar/reiniciar.
const LOOKUP = `
local token = redis.call('GET', KEYS[1])
if not token then
  token = ARGV[1]
  redis.call('SET', KEYS[1], token, 'PX', ARGV[2])
  redis.call('DEL', KEYS[2])
end
local now = redis.call('TIME')
local ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local value = redis.call('GET', KEYS[2])
local ttl = redis.call('PTTL', KEYS[2])
return {token, tostring(ms + tonumber(ARGV[3])), value or '', tostring(ttl)}
`;
const STORE = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local now = redis.call('TIME')
local ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
local remaining = tonumber(ARGV[2]) - ms
if remaining <= 0 then return 0 end
redis.call('SET', KEYS[2], ARGV[3], 'PX', remaining)
return 1
`;
const INVALIDATE = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
redis.call('DEL', KEYS[2])
return 1
`;

export interface RedisCacheOptions { url: string; ttlMs?: number; timeoutMs?: number; namespace?: string; onConnectionError?: () => void }
export class RedisOcupacionCache implements OcupacionCache {
  private readonly client: ReturnType<typeof createClient>;
  private readonly ttl: number; private readonly timeout: number; private readonly namespace: string;
  constructor(options: RedisCacheOptions) {
    const url = new URL(options.url);
    if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('REDIS_URL debe ser Redis o Redis TLS.');
    this.ttl = options.ttlMs ?? 30000; this.timeout = options.timeoutMs ?? 100; this.namespace = options.namespace ?? 'pulse:ocupacion:v1';
    if (!Number.isSafeInteger(this.ttl) || this.ttl < 50 || this.ttl > 30000 || !Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 1000
      || !/^[A-Za-z0-9:_-]{1,100}$/.test(this.namespace)) throw new Error('Configuración de caché de ocupación inválida.');
    this.client = createClient({ url: options.url, disableOfflineQueue: true, commandsQueueMaxLength: 1000,
      socket: { connectTimeout: 500, reconnectStrategy: retries => Math.min(100 + retries * 100, 1000) } });
    this.client.on('error', () => options.onConnectionError?.());
  }
  // No impide iniciar Accesos: reconexión en segundo plano, sin cola de operaciones offline.
  start() { void this.client.connect().catch(() => {}); }
  get ready() { return this.client.isReady; }
  private keys(sedeId: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(sedeId)) throw new Error('Sede inválida para caché.');
    const base = `${this.namespace}:ttl${this.ttl}:{${sedeId}}`;
    return [base + ':generation', base + ':value'];
  }
  private async eval(script: string, sedeId: string, args: string[]): Promise<unknown> {
    if (!this.client.isReady) throw new Error('Redis no disponible.');
    // El plazo cubre también comandos ya enviados; abortSignal del driver sólo cancela la cola.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.client.eval(script, { keys: this.keys(sedeId), arguments: args }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Redis excedió el plazo.')), this.timeout); }),
      ]);
    } finally { clearTimeout(timer); }

  }
  async lookup(sedeId: string): Promise<CacheLookup> {
    const result = await this.eval(LOOKUP, sedeId, [randomUUID(), String(this.ttl * 2), String(this.ttl)]) as string[];
    if (!Array.isArray(result) || result.length !== 4 || !result[0] || !Number.isSafeInteger(Number(result[1]))) throw new Error('Respuesta Redis inválida.');
    const ticket = { token: result[0], deadline: Number(result[1]) };
    if (result[2] === '') return { ticket };
    const value = Number(result[2]); const remaining = Number(result[3]);
    if (!/^(0|[1-9][0-9]*)$/.test(result[2]) || !Number.isSafeInteger(value) || value < 0 || remaining <= 0 || remaining > this.ttl) throw new Error('Agregado Redis inválido.');
    return { ticket, value, ageMs: this.ttl - remaining };
  }
  async store(sedeId: string, ticket: CacheTicket, value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Ocupación inválida.');
    return Number(await this.eval(STORE, sedeId, [ticket.token, String(ticket.deadline), String(value)])) === 1;
  }
  async invalidate(sedeId: string) { await this.eval(INVALIDATE, sedeId, [randomUUID(), String(this.ttl * 2)]); }
  async close() { if (this.client.isOpen) this.client.destroy(); }
}
