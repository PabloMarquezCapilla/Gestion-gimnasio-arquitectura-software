import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { TiendaError, TiendaStockRepository, TiendaStockService } from './stock';
import { IntegracionPendienteError, TiendaService } from './services';

interface TiendaOptions {
  jwtSecret?: string;
  jwtTtlSeconds?: number;
  clock?: () => Date;
  logger?: boolean | Record<string, unknown>;
  stockRepository?: TiendaStockRepository;
  favApiKey?: string;
}

export function buildTiendaApp(options: TiendaOptions = {}) {
  const secret = options.jwtSecret ?? process.env.AUTH_JWT_SECRET ?? '';
  const ttl = options.jwtTtlSeconds ?? Number(process.env.AUTH_JWT_TTL_SECONDS ?? 3600);
  const clock = options.clock ?? (() => new Date());
  if (secret.trim().length < 32) throw new Error('Configurar AUTH_JWT_SECRET de al menos 32 caracteres.');
  if (!Number.isSafeInteger(ttl) || ttl < 1) throw new Error('AUTH_JWT_TTL_SECONDS debe ser un entero positivo.');
  const app = Fastify({ logger: options.logger ?? false });
  // Mantener 415 del contrato; Fastify también admite text/plain por defecto.
  app.removeContentTypeParser('text/plain');
  const service = new TiendaService();
  const stock = options.stockRepository ? new TiendaStockService(options.stockRepository) : undefined;
  const favApiKey = options.favApiKey ?? process.env.FAV_API_KEY ?? '';
  const stockService = () => {
    if (!stock) throw new TiendaError(503, 'SERVICIO_NO_DISPONIBLE', 'El almacenamiento de Tienda no está configurado.');
    return stock;
  };
  let requests = 0, errors = 0;
  const operations = new Map<string, number>();
  void app.register(fastifyJwt, {
    secret,
    verify: { algorithms: ['HS256'], allowedIss: 'gimnasio', allowedAud: 'gimnasio-web',
      requiredClaims: ['sub', 'rol', 'iat', 'exp', 'iss', 'aud'], maxAge: ttl + 's' },
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const raw = request.headers.traceparent;
    const parsed = typeof raw === 'string' ? /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/.exec(raw) : null;
    const valid = parsed && !/^0+$/.test(parsed[1]) && !/^0+$/.test(parsed[2]);
    const traceId = valid ? parsed[1] : randomBytes(16).toString('hex');
    const spanId = randomBytes(8).toString('hex');
    request.log = request.log.child({ service: 'tienda', trace_id: traceId, span_id: spanId,
      ...(valid ? { parent_span_id: parsed[2] } : {}) });
    reply.header('traceparent', `00-${traceId}-${spanId}-${valid ? parsed[3] : '01'}`);
    reply.header('X-Correlation-ID', traceId);
  });
  app.addHook('onResponse', async (_request, reply) => { requests++; if (reply.statusCode >= 500) errors++; });
  app.get('/health', async () => {
    if (!options.stockRepository) return {
      servicio: 'tienda', estado: 'estructura', integracion: 'PENDIENTE_CONTRATO', persistencia: 'ninguna',
    };
    await options.stockRepository.comprobarSalud();
    return { servicio: 'tienda', estado: 'operativo', persistencia: 'postgresql',
      integracion: 'CATALOGO_FAV_PENDIENTE', consignaciones: favApiKey ? 'CONFIGURADA' : 'PENDIENTE_CREDENCIAL' };
  });
  app.get('/metrics', async (_request, reply) => reply.type('text/plain; version=0.0.4').send([
    '# TYPE http_requests_total counter', `http_requests_total{service="tienda"} ${requests}`,
    '# TYPE http_errors_total counter', `http_errors_total{service="tienda"} ${errors}`,
    '# TYPE tienda_movimientos_total counter',
    ...Array.from(operations, ([labels, n]) => `tienda_movimientos_total{service="tienda",${labels}} ${n}`), '',
  ].join('\n')));
  const autenticarFav = async (request: import('fastify').FastifyRequest) => {
    const key = request.headers['x-api-key'];
    if (typeof key !== 'string' || !key.trim()) throw new TiendaError(401, 'NO_AUTENTICADO', 'Clave de consumidor ausente o inválida.');
    if (!favApiKey) throw new TiendaError(503, 'SERVICIO_NO_DISPONIBLE', 'La credencial de FAV no está configurada.');
    const digest = (value: string) => createHash('sha256').update(value).digest();
    if (!timingSafeEqual(digest(key), digest(favApiKey))) throw new TiendaError(401, 'NO_AUTENTICADO', 'Clave de consumidor ausente o inválida.');
  };
  const autenticarUsuario = async (request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    try {
      const now = clock().getTime();
      const claims = await request.jwtVerify<{ sub?: unknown; rol?: unknown; iat?: unknown; exp?: unknown }>({ clockTimestamp: now });
      if (typeof claims.sub !== 'string' || !claims.sub || (claims.rol !== 'SOCIO' && claims.rol !== 'ADMIN')
        || typeof claims.iat !== 'number' || !Number.isFinite(claims.iat)
        || typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)
        || claims.exp <= claims.iat || now >= claims.exp * 1000 || now >= (claims.iat + ttl) * 1000) throw new Error('Sesión inválida.');
    } catch {
      reply.header('WWW-Authenticate', 'Bearer');
      throw new TiendaError(401, 'NO_AUTENTICADO', 'Sesión ausente, inválida o vencida.');
    }
  };
  const administrador = async (request: import('fastify').FastifyRequest) => {
    if ((request.user as { rol: string }).rol !== 'ADMIN') throw new TiendaError(403, 'ACCESO_DENEGADO', 'Se requiere un administrador.');
  };
  const sinQuery = (query: unknown) => {
    if (Object.keys(query as Record<string, unknown>).length) throw new TiendaError(400, 'SOLICITUD_INVALIDA', 'No se admiten parámetros de consulta.');
  };
  const movimiento = async <T>(request: import('fastify').FastifyRequest, op: string, run: () => Promise<T>) => {
    try {
      const result = await run();
      const key = `operacion="${op}",resultado="resuelta"`; operations.set(key, (operations.get(key) ?? 0) + 1);
      request.log.info({ operacion: op, resultado: 'resuelta' }, 'Movimiento de Tienda resuelto; incluye repeticiones reconocidas');
      return result;
    } catch (error) {
      const key = `operacion="${op}",resultado="fallida"`; operations.set(key, (operations.get(key) ?? 0) + 1);
      request.log.warn({ operacion: op, codigo: error instanceof TiendaError ? error.codigo : 'PERSISTENCIA_FALLIDA' }, 'Movimiento de Tienda sin confirmación para esta solicitud');
      throw error;
    }
  };
  app.get('/api/v1/consignaciones/stock', { onRequest: autenticarFav }, async request => {
    const query = request.query as Record<string, unknown>;
    if (Object.keys(query).length !== 1 || typeof query.proveedorId !== 'string') throw new TiendaError(400, 'SOLICITUD_INVALIDA', 'Se requiere únicamente proveedorId=fav.');
    if (query.proveedorId !== 'fav') throw new TiendaError(403, 'PROVEEDOR_NO_AUTORIZADO', 'La credencial no permite consultar otro proveedor.');
    return stockService().consultarStock();
  });
  app.post('/api/v1/consignaciones/reposiciones', { onRequest: autenticarFav }, async (request, reply) => {
    sinQuery(request.query);
    return reply.code(201).send(await movimiento(request, 'reposicion', () => stockService().reponer(request.headers['idempotency-key'], request.body)));
  });
  app.get('/api/v1/tienda/stock', { onRequest: [autenticarUsuario, administrador] }, async request => {
    sinQuery(request.query); return stockService().consultarStock();
  });
  app.post('/api/v1/tienda/ventas', { onRequest: [autenticarUsuario, administrador] }, async (request, reply) => {
    sinQuery(request.query);
    return reply.code(201).send(await movimiento(request, 'venta', () => stockService().vender(
      (request.user as { sub: string }).sub, request.headers['idempotency-key'], request.body)));
  });
  app.get('/api/v1/tienda/productos', {
    onRequest: autenticarUsuario,
  }, () => service.consultarProductos());
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof IntegracionPendienteError) {
      return reply.code(503).send({ codigo: error.codigo, mensaje: error.message });
    }
    if (error instanceof TiendaError) return reply.code(error.statusCode).send({ codigo: error.codigo, mensaje: error.message });
    const detail = typeof error === 'object' && error !== null ? error as { code?: unknown; statusCode?: unknown } : {};
    const code = typeof detail.code === 'string' ? detail.code : '';
    if (detail.statusCode === 400) return reply.code(400).send({ codigo: 'SOLICITUD_INVALIDA', mensaje: 'Cuerpo o parámetros inválidos.' });
    if (detail.statusCode === 415) return reply.code(415).send({ codigo: 'TIPO_CONTENIDO_NO_ADMITIDO', mensaje: 'Enviar el cuerpo como application/json.' });
    if (detail.statusCode === 413) return reply.code(413).send({ codigo: 'SOLICITUD_DEMASIADO_GRANDE', mensaje: 'La solicitud supera el límite de transporte de 1 MiB.' });
    if (/^(08|57P0[123]|53300|55P03|57014)/.test(code) || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'].includes(code)
      || /connection (terminated|timeout)|timeout exceeded when trying to connect/i.test(error instanceof Error ? error.message : '')) {
      request.log.warn({ codigo: 'SERVICIO_NO_DISPONIBLE' }, 'PostgreSQL de Tienda no disponible');
      return reply.code(503).send({ codigo: 'SERVICIO_NO_DISPONIBLE', mensaje: 'No se puede completar la operación en este momento.' });
    }
    request.log.error({ codigo: 'ERROR_INTERNO' }, 'No se pudo completar la consulta de Tienda');
    return reply.code(500).send({ codigo: 'ERROR_INTERNO', mensaje: 'No se pudo completar la consulta.' });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ codigo: 'RUTA_NO_ENCONTRADA', mensaje: 'La ruta solicitada no existe.' }));
  return app;
}
