import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { MongoError } from 'mongodb';
import { AccesosError, AccesosRepository, AccesosService, Contexto, identificador, orden, parametros, SociosClient } from './domain';

export interface AccesosOptions {
  repository: AccesosRepository; socios: SociosClient; jwtSecret: string;
  jwtTtlSeconds?: number; clock?: () => Date; logger?: boolean | Record<string, unknown>;
}
export function buildAccesosApp(options: AccesosOptions) {
  const ttl = options.jwtTtlSeconds ?? 3600;
  if (options.jwtSecret.trim().length < 32 || !Number.isSafeInteger(ttl) || ttl < 1) throw new Error('Configuración JWT de Accesos inválida.');
  const clock = options.clock ?? (() => new Date());
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 16384 });
  void app.register(jwt, { secret: options.jwtSecret, verify: {
    algorithms: ['HS256'], allowedIss: 'gimnasio', allowedAud: 'gimnasio-web',
    requiredClaims: ['sub', 'rol', 'iat', 'exp', 'iss', 'aud'], maxAge: ttl + 's',
  } });
  const repo = options.repository;
  const service = new AccesosService(repo, options.socios, clock);
  const actores = new WeakMap<object, string>(); const trazas = new WeakMap<object, Contexto>();
  const instanceId = hostname();
  let solicitudes = 0; let errores = 0; let dependencia = 0;
  const operaciones: Record<string, number> = {};
  app.addHook('onRequest', async (request, reply) => {
    const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/.exec(String(request.headers.traceparent ?? ''));
    const traceId = match && !/^0+$/.test(match[1]) && !/^0+$/.test(match[2]) ? match[1] : randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    const context = { traceId, spanId, traceFlags: '01' };
    trazas.set(request, context);
    request.log = request.log.child({ service: 'accesos-ocupacion', trace_id: traceId, span_id: spanId,
      ...(match && traceId === match[1] ? { parent_span_id: match[2] } : {}) });
    reply.headers({ 'Cache-Control': 'no-store', 'X-Instance-ID': instanceId,
      'X-Correlation-ID': traceId, traceparent: `00-${traceId}-${spanId}-01` });
    if (!request.url.startsWith('/api/')) return;
    try {
      const claims = await request.jwtVerify<{ sub: string; rol: string; iat: number; exp: number }>({ clockTimestamp: clock().getTime() });
      const now = clock().getTime() / 1000;
      if (!identificador(claims.sub) || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)
        || claims.exp <= claims.iat || claims.iat > now || claims.exp <= now || now >= claims.iat + ttl
        || !['ADMIN', 'SOCIO'].includes(claims.rol)) throw new Error();
      if (claims.rol !== 'ADMIN') throw new AccesosError(403, 'ACCESO_DENEGADO', 'La recepción requiere permisos de administrador.');
      actores.set(request, claims.sub);
    } catch (error) {
      if (error instanceof AccesosError) throw error;
      reply.header('WWW-Authenticate', 'Bearer');
      throw new AccesosError(401, 'NO_AUTENTICADO', 'Se requiere una sesión válida y vigente.');
    }
  });
  app.addHook('onResponse', async (_request, reply) => { solicitudes++; if (reply.statusCode >= 500) errores++; });
  app.get('/health', async (_request, reply) => {
    try { await repo.salud(); return { servicio: 'accesos-ocupacion', estado: 'operativo', persistencia: 'mongodb' }; }
    catch { return reply.code(503).send({ servicio: 'accesos-ocupacion', estado: 'error', persistencia: 'mongodb' }); }
  });
  app.get('/metrics', async (_request, reply) => {
    reply.type('text/plain; version=0.0.4');
    const labels = `service="accesos-ocupacion",instance="${instanceId}"`;
    return [
      '# TYPE http_requests_total counter', `http_requests_total{${labels}} ${solicitudes}`,
      '# TYPE http_errors_total counter', `http_errors_total{${labels}} ${errores}`,
      '# TYPE accesos_dependency_errors_total counter', `accesos_dependency_errors_total{${labels}} ${dependencia}`,
      '# TYPE accesos_operations_total counter', ...Object.entries(operaciones).map(([codigo, n]) => `accesos_operations_total{${labels},codigo="${codigo}"} ${n}`),
      '# TYPE process_uptime_seconds gauge', `process_uptime_seconds{${labels}} ${process.uptime()}`,
    ].join('\n') + '\n';
  });
  app.get('/api/v1/accesos/sedes', async () => ({ items: await repo.sedes() }));
  app.post('/api/v1/accesos/movimientos', async (request, reply) => {
    const body = orden(request.body);
    const clave = request.headers['idempotency-key'];
    if (typeof clave !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(clave)) throw parametros();
    const result = await service.registrar({ ...body, clave, actorId: actores.get(request)! }, trazas.get(request));
    const m = result.movimiento;
    operaciones[m.codigo] = (operaciones[m.codigo] ?? 0) + 1;
    request.log.info({ movimientoId: m.movimientoId, tipo: m.tipo, sedeId: m.sedeId, aceptado: m.aceptado, codigo: m.codigo }, 'Movimiento de recepción resuelto');
    return reply.code(m.aceptado ? 201 : m.codigo === 'MEMBRESIA_NO_HABILITADA' ? 422 : 409).send(result);
  });
  app.get<{ Params: { sedeId: string } }>('/api/v1/accesos/sedes/:sedeId/ocupacion', async request => {
    if (!identificador(request.params.sedeId)) throw parametros();
    await service.exigirSede(request.params.sedeId);
    return { sedeId: request.params.sedeId, ocupacion: await repo.ocupacion(request.params.sedeId), consultadoEn: clock().toISOString() };
  });
  app.get<{ Querystring: Record<string, unknown> }>('/api/v1/accesos/movimientos', async request => {
    const q = request.query;
    if (Object.keys(q).some(k => !['sedeId', 'socioId', 'pagina', 'tamanio'].includes(k))
      || !identificador(q.sedeId) || (q.socioId !== undefined && !identificador(q.socioId))) throw parametros();
    const numero = (value: unknown, def: number, max: number) => {
      if (value === undefined) return def;
      if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw parametros();
      return Number(value);
    };
    const pagina = numero(q.pagina, 1, 1000000); const tamanio = numero(q.tamanio, 20, 100);
    await service.exigirSede(q.sedeId);
    return { items: await repo.historial(q.sedeId, q.socioId as string | undefined, pagina, tamanio), pagina, tamanio };
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AccesosError) {
      if (error.statusCode >= 500) { dependencia++; request.log.warn({ codigo: error.codigo }, 'Dependencia no disponible'); }
      return reply.code(error.statusCode).send({ codigo: error.codigo, mensaje: error.message });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ codigo: 'PARAMETROS_INVALIDOS', mensaje: 'La solicitud no tiene un formato válido.' });
    const mongo = error instanceof MongoError;
    if (mongo) dependencia++;
    // No serializar excepciones Mongo/HTTP ni cuerpos: pueden incluir URI, datos personales o credenciales.
    request.log.error({ codigo: mongo ? 'ALMACENAMIENTO_NO_DISPONIBLE' : 'ERROR_INTERNO' }, 'No se pudo completar la operación');
    return reply.code(mongo ? 503 : 500).send({ codigo: mongo ? 'ALMACENAMIENTO_NO_DISPONIBLE' : 'ERROR_INTERNO',
      mensaje: 'No se pudo confirmar la operación. Conservá la misma clave para reintentar.' });
  });
  return app;
}
