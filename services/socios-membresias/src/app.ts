import { hostname } from 'node:os';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import { ISociosRepository, MemorySociosRepository } from './repository';
import { registerTracing } from './tracing';
import { Identidad, JwtIdentidad } from './types';
import { clavesIguales, configuracionAuth } from './security';
import { AuthService, SociosService, resolverFechaReferencia } from './services';
import { IdentidadDuplicadaError, SociosError } from './errors';
import { EmpleadosService } from './empleados.service';
import { CredencialEmpleados, registerEmpleadosHttp } from './empleados.http';

export interface SociosAppOptions {
  repository?: ISociosRepository;
  logger?: boolean | Record<string, unknown>;
  jwtSecret?: string;
  internalApiKey?: string;
  jwtTtlSeconds?: number;
  clock?: () => Date;
  empleadosCredenciales?: readonly CredencialEmpleados[];
}

export function buildSociosApp(options: SociosAppOptions = {}): FastifyInstance {
  const { jwtSecret, internalApiKey, jwtTtlSeconds } = configuracionAuth(options);
  const clock = options.clock ?? (() => new Date());
  const app = Fastify({ logger: options.logger ?? false });
  const repository = options.repository ?? new MemorySociosRepository();
  const sociosService = new SociosService(repository, clock);
  const authService = new AuthService(repository, sociosService, clock);
  const identidades = new WeakMap<FastifyRequest, Identidad>();
  const solicitudesInternas = new WeakSet<FastifyRequest>();
  const instanceId = hostname();
  let httpRequestsTotal = 0;
  let httpErrorsTotal = 0;

  void app.register(fastifyJwt, {
    secret: jwtSecret,
    sign: { algorithm: 'HS256', iss: 'gimnasio', aud: 'gimnasio-web' },
    verify: {
      algorithms: ['HS256'],
      allowedIss: 'gimnasio',
      allowedAud: 'gimnasio-web',
      requiredClaims: ['sub', 'rol', 'iat', 'exp', 'iss', 'aud'],
      maxAge: jwtTtlSeconds + 's',
    },
  });
  void registerTracing(app, { serviceName: 'socios-membresias' });
  registerEmpleadosHttp(app, new EmpleadosService(repository, clock), options.empleadosCredenciales ?? []);

  async function autenticar(request: FastifyRequest): Promise<void> {
    let claims: JwtIdentidad;
    try {
      claims = await request.jwtVerify<JwtIdentidad>({ clockTimestamp: clock().getTime() });
    } catch {
      throw new SociosError(401, 'NO_AUTENTICADO', 'Falta un token Bearer válido y vigente.');
    }
    identidades.set(request, await authService.verificarIdentidad(claims));
  }

  function identidad(request: FastifyRequest): Identidad {
    const actual = identidades.get(request);
    if (!actual) throw new SociosError(401, 'NO_AUTENTICADO', 'Se requiere autenticación.');
    return actual;
  }

  async function administrador(request: FastifyRequest): Promise<void> {
    sociosService.exigirAdministrador(identidad(request));
  }

  async function autorizarHabilitacion(request: FastifyRequest): Promise<void> {
    const clave = request.headers['x-service-key'];
    if (typeof clave === 'string' && clavesIguales(clave, internalApiKey)) {
      solicitudesInternas.add(request);
      return;
    }
    await autenticar(request);
  }

  app.addHook('onResponse', async (_request, reply) => {
    httpRequestsTotal += 1;
    if (reply.statusCode >= 500) httpErrorsTotal += 1;
  });

  app.get('/health', async (_request, reply) => {
    reply.header('X-Instance-ID', instanceId);
    const salud = await repository.verificarSalud();
    if (!salud.ok) reply.code(503);
    return {
      servicio: 'socios-membresias',
      instancia: instanceId,
      estado: salud.ok ? 'operativo' : 'error',
      persistencia: repository instanceof MemorySociosRepository ? 'memoria' : 'postgresql',
      timestamp: clock().toISOString(),
    };
  });

  app.get('/metrics', async (_request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    reply.header('X-Instance-ID', instanceId);
    return [
      '# HELP http_requests_total Total de solicitudes HTTP procesadas',
      '# TYPE http_requests_total counter',
      'http_requests_total{service="socios-membresias",instance="' + instanceId + '"} ' + httpRequestsTotal,
      '# HELP http_errors_total Total de respuestas HTTP 5xx emitidas',
      '# TYPE http_errors_total counter',
      'http_errors_total{service="socios-membresias",instance="' + instanceId + '"} ' + httpErrorsTotal,
      '# HELP pg_pool_active_connections Conexiones activas en el pool de base de datos',
      '# TYPE pg_pool_active_connections gauge',
      'pg_pool_active_connections{service="socios-membresias",instance="' + instanceId + '"} ' + repository.conexionesActivas(),
      '# HELP process_uptime_seconds Tiempo de actividad en segundos',
      '# TYPE process_uptime_seconds gauge',
      'process_uptime_seconds{service="socios-membresias",instance="' + instanceId + '"} ' + Math.floor(process.uptime()),
    ].join('\n') + '\n';
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const resultado = await authService.iniciarSesion(request.body);
    const iat = Math.floor(clock().getTime() / 1000);
    const token = app.jwt.sign({
      sub: resultado.socio.socioId,
      rol: resultado.socio.rol,
      iat,
      exp: iat + jwtTtlSeconds,
    });
    reply.header('Cache-Control', 'no-store');
    return { token, ...resultado };
  });

  app.get('/api/v1/auth/me', { onRequest: autenticar }, async (request, reply) => {
    const { membresia, ...socio } = await sociosService.consultarSocio(identidad(request).socioId);
    reply.header('Cache-Control', 'no-store');
    return { socio, membresia };
  });

  // Crear una cuenta no inicia sesión por ella ni habilita una membresía.
  for (const ruta of ['/api/v1/auth/registro', '/api/v1/socios']) {
    app.post(ruta, { onRequest: [autenticar, administrador] }, async (request, reply) => {
      const resultado = await sociosService.crearSocio(identidad(request), request.body);
      reply.header('Cache-Control', 'no-store');
      request.log.info({ socioId: resultado.socio.socioId }, 'Cuenta de socio creada por administración');
      return reply.code(201).send(resultado);
    });
  }

  app.get<{ Params: { socioId: string }; Querystring: { fecha?: string } }>(
    '/api/v1/socios/:socioId/habilitacion',
    { onRequest: autorizarHabilitacion },
    async (request, reply) => {
      const { socioId } = request.params;
      if (!solicitudesInternas.has(request)) sociosService.exigirPropietario(identidad(request), socioId);
      const fecha = resolverFechaReferencia(request.query.fecha, clock);
      const resultado = await sociosService.evaluarHabilitacion(socioId, fecha);
      reply.header('Cache-Control', 'no-store');
      request.log.info({ socioId, habilitado: resultado.habilitado, motivo: resultado.motivo }, 'Habilitación evaluada');
      return resultado;
    },
  );

  app.get<{ Params: { socioId: string } }>(
    '/api/v1/socios/:socioId', { onRequest: autenticar }, async (request, reply) => {
      sociosService.exigirPropietario(identidad(request), request.params.socioId);
      reply.header('Cache-Control', 'no-store');
      return sociosService.consultarSocio(request.params.socioId);
    },
  );

  app.post<{ Params: { socioId: string } }>(
    '/api/v1/socios/:socioId/membresias',
    { onRequest: [autenticar, administrador] },
    async (request) => sociosService.solicitarMembresia(identidad(request), request.params.socioId),
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SociosError) {
      if (error.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer realm="gimnasio"');
      return reply.code(error.statusCode).send({ codigo: error.codigo, mensaje: error.message });
    }
    if (error instanceof IdentidadDuplicadaError
      || (error && typeof error === 'object' && 'code' in error && error.code === '23505')) {
      return reply.code(409).send({ codigo: 'DATO_DUPLICADO', mensaje: 'El DNI, email o identificador ya se encuentra registrado.' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ codigo: 'DATOS_INVALIDOS', mensaje: 'La solicitud no tiene un formato válido.' });
    }
    request.log.error({ err: error }, 'Error procesando solicitud en socios-membresias');
    return reply.code(500).send({ codigo: 'ERROR_INTERNO', mensaje: 'No se pudo completar la operación.' });
  });
  return app;
}
