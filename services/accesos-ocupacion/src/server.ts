import { MongoClient } from 'mongodb';
import { buildAccesosApp } from './app';
import { identificador, Sede } from './domain';
import { MongoAccesosRepository } from './repository';
import { HttpSociosClient } from './socios.client';
import { RedisOcupacionCache } from './redis.cache';

async function start() {
  const url = process.env.MONGODB_URL;
  const sociosUrl = process.env.SOCIOS_SERVICE_URL;
  const jwtSecret = process.env.AUTH_JWT_SECRET ?? '';
  const key = process.env.SERVICIOS_API_KEY ?? '';
  const port = Number(process.env.PORT ?? 3000);
  const ttl = Number(process.env.AUTH_JWT_TTL_SECONDS ?? 3600);
  if (!url || !sociosUrl || jwtSecret.trim().length < 32 || !key.trim()
    || !Number.isSafeInteger(port) || port < 1 || port > 65535 || !Number.isSafeInteger(ttl) || ttl < 1) throw new Error('Configuración de Accesos incompleta o inválida.');
  const sedes = JSON.parse(process.env.ACCESOS_SEDES_JSON ?? '[]') as Sede[];
  if (!Array.isArray(sedes) || !sedes.length || sedes.some(s => !s || !identificador(s.sedeId)
    || typeof s.nombre !== 'string' || !s.nombre.trim() || s.nombre.length > 100 || Object.keys(s).some(k => !['sedeId', 'nombre'].includes(k)))
    || new Set(sedes.map(s => s.sedeId)).size !== sedes.length) throw new Error('Configurar ACCESOS_SEDES_JSON con sedes válidas.');
  const socios = new HttpSociosClient(sociosUrl, key);
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 3000, connectTimeoutMS: 3000,
    socketTimeoutMS: 10000, waitQueueTimeoutMS: 3000, maxPoolSize: 20, timeoutMS: 10000 });
  try {
    await client.connect();
    const repository = new MongoAccesosRepository(client);
    await repository.inicializar(sedes);
    const redisUrl = process.env.REDIS_URL?.trim();
    const cache = redisUrl ? new RedisOcupacionCache({ url: redisUrl,
      namespace: process.env.OCUPACION_CACHE_NAMESPACE ?? 'pulse:ocupacion:v1',
      ttlMs: Number(process.env.OCUPACION_CACHE_TTL_MS ?? 30000), timeoutMs: Number(process.env.REDIS_TIMEOUT_MS ?? 100),
      onConnectionError: () => { console.warn(JSON.stringify({ service: 'accesos-ocupacion', codigo: 'REDIS_CONEXION_FALLIDA', mensaje: 'Caché no disponible; MongoDB sigue siendo la fuente.' })); },
    }) : undefined;
    const app = buildAccesosApp({ repository, socios, jwtSecret, jwtTtlSeconds: ttl,
      ocupacionCache: cache,
      logger: { redact: ['req.headers.authorization', 'req.headers["x-service-key"]', 'req.headers["idempotency-key"]'] } });
    cache?.start();
    app.addHook('onClose', async () => { await client.close(); });
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
    try { await app.listen({ host: '0.0.0.0', port }); }
    catch (error) { await app.close(); throw error; }
  } catch (error) { await client.close(); throw error; }
}
void start().catch(() => { console.error('No se pudo iniciar Accesos. Revisar configuración y disponibilidad de MongoDB replica set.'); process.exitCode = 1; });
