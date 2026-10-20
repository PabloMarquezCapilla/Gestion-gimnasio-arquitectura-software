import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';

export interface Principal { socioId: string; rol: 'ADMIN' | 'SOCIO' }

export function registerSessionAuth(
  app: FastifyInstance,
  options: { jwtSecret?: string; internalApiKey?: string; jwtTtlSeconds?: number; clock?: () => Date },
) {
  const secret = options.jwtSecret ?? process.env.AUTH_JWT_SECRET ?? '';
  const internalApiKey = options.internalApiKey ?? process.env.SERVICIOS_API_KEY ?? '';
  const ttl = options.jwtTtlSeconds ?? Number(process.env.AUTH_JWT_TTL_SECONDS ?? 3600);
  const clock = options.clock ?? (() => new Date());
  if (secret.length < 32) throw new Error('AUTH_JWT_SECRET debe tener al menos 32 caracteres.');
  if (!internalApiKey.trim()) throw new Error('Se requiere SERVICIOS_API_KEY.');
  if (!Number.isInteger(ttl) || ttl <= 0) throw new Error('La duración de la sesión debe ser un entero positivo.');
  void app.register(fastifyJwt, {
    secret,
    sign: {
      algorithm: 'HS256', iss: 'gimnasio', aud: 'gimnasio-web',
      expiresIn: String(ttl) + 's', clockTimestamp: clock().getTime(),
    },
    verify: {
      algorithms: ['HS256'], allowedIss: 'gimnasio', allowedAud: 'gimnasio-web',
      requiredClaims: ['sub', 'rol', 'iat', 'exp', 'iss', 'aud'], maxAge: String(ttl) + 's',
    },
  });
  const principals = new WeakMap<FastifyRequest, Principal>();
  async function session(request: FastifyRequest, reply: FastifyReply) {
    try {
      const now = clock().getTime();
      await request.jwtVerify({ clockTimestamp: now });
      const claims = request.user as { sub?: unknown; rol?: unknown; iat?: unknown; exp?: unknown };
      if (typeof claims.sub !== 'string' || !claims.sub
        || (claims.rol !== 'ADMIN' && claims.rol !== 'SOCIO')
        || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)
        || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)
        || claims.exp <= claims.iat || now >= claims.exp * 1000 || now >= (claims.iat + ttl) * 1000) {
        throw new Error('Sesión inválida.');
      }
      principals.set(request, { socioId: claims.sub, rol: claims.rol });
    } catch {
      reply.header('WWW-Authenticate', 'Bearer');
      return reply.code(401).send({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión ausente, inválida o vencida.' });
    }
  }
  async function admin(request: FastifyRequest, reply: FastifyReply) {
    await session(request, reply);
    if (reply.sent) return reply;
    if (principals.get(request)!.rol !== 'ADMIN') {
      return reply.code(403).send({ codigo: 'NO_AUTORIZADO', mensaje: 'Se requiere un administrador.' });
    }
  }
  function target(request: FastifyRequest, socioId?: unknown): string | null {
    const principal = principals.get(request)!;
    if (socioId !== undefined && (typeof socioId !== 'string' || !socioId.trim())) return null;
    const resolved = typeof socioId === 'string' ? socioId.trim() : principal.socioId;
    return principal.rol === 'ADMIN' || resolved === principal.socioId ? resolved : null;
  }
  return { session, admin, target, principal: (request: FastifyRequest) => principals.get(request)! };
}
