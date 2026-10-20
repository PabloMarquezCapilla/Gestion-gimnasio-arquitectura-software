import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { IntegracionPendienteError, TiendaService } from './services';

interface TiendaOptions {
  jwtSecret?: string;
  jwtTtlSeconds?: number;
  clock?: () => Date;
  logger?: boolean | Record<string, unknown>;
}

export function buildTiendaApp(options: TiendaOptions = {}) {
  const secret = options.jwtSecret ?? process.env.AUTH_JWT_SECRET ?? '';
  const ttl = options.jwtTtlSeconds ?? Number(process.env.AUTH_JWT_TTL_SECONDS ?? 3600);
  const clock = options.clock ?? (() => new Date());
  if (secret.trim().length < 32) throw new Error('Configurar AUTH_JWT_SECRET de al menos 32 caracteres.');
  if (!Number.isSafeInteger(ttl) || ttl < 1) throw new Error('AUTH_JWT_TTL_SECONDS debe ser un entero positivo.');
  const app = Fastify({ logger: options.logger ?? false });
  const service = new TiendaService();
  void app.register(fastifyJwt, {
    secret,
    verify: { algorithms: ['HS256'], allowedIss: 'gimnasio', allowedAud: 'gimnasio-web',
      requiredClaims: ['sub', 'rol', 'iat', 'exp', 'iss', 'aud'], maxAge: ttl + 's' },
  });
  app.addHook('onRequest', async (_request, reply) => { reply.header('Cache-Control', 'no-store'); });
  app.get('/health', async () => ({
    servicio: 'tienda', estado: 'estructura', integracion: 'PENDIENTE_CONTRATO', persistencia: 'ninguna',
  }));
  app.get('/api/v1/tienda/productos', {
    onRequest: async (request, reply) => {
      try {
        const now = clock().getTime();
        const claims = await request.jwtVerify<{ sub?: unknown; rol?: unknown; iat?: unknown; exp?: unknown }>({ clockTimestamp: now });
        if (typeof claims.sub !== 'string' || !claims.sub || (claims.rol !== 'SOCIO' && claims.rol !== 'ADMIN')
          || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)
          || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)
          || claims.exp <= claims.iat || now >= claims.exp * 1000 || now >= (claims.iat + ttl) * 1000) {
          throw new Error('Sesión inválida.');
        }
      } catch {
        return reply.header('WWW-Authenticate', 'Bearer').code(401)
          .send({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión ausente, inválida o vencida.' });
      }
    },
  }, () => service.consultarProductos());
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IntegracionPendienteError) {
      return reply.code(503).send({ codigo: error.codigo, mensaje: error.message });
    }
    request.log.error({ codigo: 'ERROR_INTERNO' }, 'No se pudo completar la consulta de Tienda');
    return reply.code(500).send({ codigo: 'ERROR_INTERNO', mensaje: 'No se pudo completar la consulta.' });
  });
  return app;
}
