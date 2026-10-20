import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { MockClass, mockClasses } from './mock-data';
import { IClaseRepository, MemoryClaseRepository } from './repository';
import { ISociosClient, MockSociosClient } from './clients/socios.client';
import { registerTracing } from './tracing';
import { registerSessionAuth } from './auth';
import { ReservasService } from './application/reservas.service';

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema: Record<string, unknown>;
}

interface Operation {
  parameters?: Parameter[];
  responses: Record<string, Record<string, unknown>>;
}

interface Contract {
  paths: Record<string, { get: Operation }>;
  components: { schemas: Record<string, unknown> };
}

interface ListQuery {
  sedeId?: string;
  desde?: string;
  hasta?: string;
  pagina: number;
  tamanio: number;
}

export interface AppOptions {
  apiKey: string;
  jwtSecret?: string;
  internalApiKey?: string;
  jwtTtlSeconds?: number;
  logger?: boolean | Record<string, unknown>;
  clock?: () => Date;
  classes?: readonly MockClass[];
  repository?: IClaseRepository;
  sociosClient?: ISociosClient;
}

const contract = parse(
  readFileSync(resolve(__dirname, '../../../docs/contracts/openapi-v1.yaml'), 'utf8')
) as Contract;
const listOperation = contract.paths['/api/v1/clases'].get;
const detailOperation = contract.paths['/api/v1/clases/{claseId}'].get;
const rfc3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

function schemaWithComponents(schema: Record<string, unknown>) {
  return { ...schema, components: contract.components };
}

function resolveReference(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.$ref !== 'string') return value;
  const parts = value.$ref.replace(/^#\//, '').split('/');
  let result: unknown = contract;
  for (const part of parts) {
    result = (result as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return result as Record<string, unknown>;
}

function responseSchema(operation: Operation, status: number): Record<string, unknown> {
  const response = resolveReference(operation.responses[String(status)]);
  const content = response.content as Record<string, { schema: Record<string, unknown> }>;
  return schemaWithComponents(content['application/json'].schema);
}

export function buildApp(options: AppOptions) {
  if (!options.apiKey || !options.apiKey.trim()) {
    throw new Error('CAPACIDAD_API_KEY debe tener un valor para iniciar el servicio.');
  }

  const loggerConfig =
    typeof options.logger === 'object' && options.logger !== null
      ? { redact: ['req.headers["x-api-key"]', 'req.headers["x-service-key"]', 'req.headers.authorization'], ...options.logger }
      : options.logger
        ? { redact: ['req.headers["x-api-key"]', 'req.headers["x-service-key"]', 'req.headers.authorization'] }
        : false;

  const app = Fastify({
    logger: loggerConfig,
  });

  const auth = registerSessionAuth(app, options);

  const clock = options.clock ?? (() => new Date());

  // Inyeccion de dependencias (D2): repositorio y cliente de socios
  const repository: IClaseRepository =
    options.repository ??
    new MemoryClaseRepository(options.classes ?? mockClasses, true);

  const sociosClient: ISociosClient =
    options.sociosClient ?? new MockSociosClient();

  const reservasService = new ReservasService(repository, sociosClient, { clock });

  // Registro de trazabilidad distribuida W3C (D11)
  void registerTracing(app, { serviceName: 'clases-reservas' });

  const requestValidator = new Ajv2020({ strict: false, coerceTypes: true, useDefaults: true });
  const responseValidator = new Ajv2020({ strict: false });
  addFormats(requestValidator, { mode: 'full' });
  addFormats(responseValidator, { mode: 'full' });

  const queryParameters = listOperation.parameters?.filter((parameter) => parameter.in === 'query') ?? [];
  const validateQuery = requestValidator.compile<ListQuery>({
    type: 'object',
    properties: Object.fromEntries(queryParameters.map((parameter) => [parameter.name, parameter.schema])),
    required: queryParameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
  });
  const validateList = responseValidator.compile(responseSchema(listOperation, 200));
  const validateDetail = responseValidator.compile(responseSchema(detailOperation, 200));
  const validateError = responseValidator.compile(responseSchema(listOperation, 500));

  function sendError(reply: FastifyReply, status: number, codigo: string, mensaje: string) {
    const body = { codigo, mensaje };
    if (!validateError(body)) throw new Error('La respuesta de error no cumple el contrato.');
    return reply.code(status).send(body);
  }

  async function authenticate(request: FastifyRequest, reply: FastifyReply) {
    if (request.headers['x-api-key'] !== options.apiKey) {
      reply.header('WWW-Authenticate', 'ApiKey realm="clases"');
      return sendError(reply, 401, 'NO_AUTENTICADO', 'Clave de consumidor ausente o inválida.');
    }
  }

  const instanceId = hostname();
  let httpRequestsTotal = 0;
  let httpErrorsTotal = 0;

  app.addHook('onResponse', async (request, reply) => {
    httpRequestsTotal += 1;
    if (reply.statusCode >= 500) {
      httpErrorsTotal += 1;
    }
  });

  function successHeaders(reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Instance-ID', instanceId);
    if (repository.isMock) {
      reply.header('X-Mock', 'true');
    }
  }

  app.get('/health', async (request, reply) => {
    reply.header('X-Instance-ID', instanceId);
    const salud = await repository.verificarSalud();
    if (!salud.ok) {
      reply.code(503);
      return {
        servicio: 'clases-reservas',
        instancia: instanceId,
        estado: 'error',
        persistencia: repository.isMock ? 'memoria' : 'postgresql',
        error: salud.detalle,
        timestamp: new Date().toISOString(),
      };
    }
    if (repository.isMock) {
      return {
        servicio: 'clases-reservas',
        estado: 'estructura',
        modo: 'mock',
      };
    }
    return {
      servicio: 'clases-reservas',
      instancia: instanceId,
      estado: 'operativo',
      modo: 'produccion',
      persistencia: 'postgresql',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/metrics', async (request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    reply.header('X-Instance-ID', instanceId);
    return [
      '# HELP http_requests_total Total de solicitudes HTTP procesadas',
      '# TYPE http_requests_total counter',
      `http_requests_total{service="clases-reservas",instance="${instanceId}"} ${httpRequestsTotal}`,
      '# HELP http_errors_total Total de respuestas HTTP 5xx emitidas',
      '# TYPE http_errors_total counter',
      `http_errors_total{service="clases-reservas",instance="${instanceId}"} ${httpErrorsTotal}`,
      '# HELP pg_pool_active_connections Conexiones ocupadas del pool de base de datos',
      '# TYPE pg_pool_active_connections gauge',
      `pg_pool_active_connections{service="clases-reservas",instance="${instanceId}"} ${repository.conexionesActivas()}`,
      '# HELP process_uptime_seconds Tiempo de actividad en segundos',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds{service="clases-reservas",instance="${instanceId}"} ${Math.floor(process.uptime())}`,
    ].join('\n') + '\n';
  });

  // =========================================================================
  // Capacidad Compartida (D8): Consulta de clases y cupos
  // =========================================================================

  app.get('/api/v1/clases', { onRequest: authenticate }, async (request, reply) => {
    const query = request.query as ListQuery;
    if (!validateQuery(query)) {
      return sendError(reply, 400, 'PARAMETROS_INVALIDOS', 'Filtros o paginación inválidos.');
    }
    for (const value of [query.desde, query.hasta]) {
      if (value !== undefined && (!rfc3339.test(value) || !Number.isFinite(Date.parse(value)))) {
        return sendError(reply, 400, 'PARAMETROS_INVALIDOS', 'Las fechas deben ser RFC 3339 con zona horaria.');
      }
    }
    const desde = query.desde === undefined ? undefined : Date.parse(query.desde);
    const hasta = query.hasta === undefined ? undefined : Date.parse(query.hasta);
    if (desde !== undefined && hasta !== undefined && desde >= hasta) {
      return sendError(reply, 400, 'PARAMETROS_INVALIDOS', 'desde debe ser menor que hasta.');
    }

    const consultadoEn = clock().toISOString();
    request.log.info({ query, consultadoEn }, 'Consultando listado de clases y cupos');

    const result = await repository.listarClases(
      {
        sedeId: query.sedeId,
        desde: query.desde,
        hasta: query.hasta,
        pagina: query.pagina,
        tamanio: query.tamanio,
      },
      consultadoEn
    );

    const body = {
      items: result.items,
      pagina: query.pagina,
      tamanio: query.tamanio,
      total: result.total,
    };

    if (!validateList(body) || body.items.some((item) => item.cuposDisponibles > item.capacidad)) {
      throw new Error('La respuesta del listado no cumple el contrato.');
    }
    successHeaders(reply);
    return body;
  });

  app.get<{ Params: { claseId: string } }>(
    '/api/v1/clases/:claseId',
    { onRequest: authenticate },
    async (request, reply) => {
      const consultadoEn = clock().toISOString();
      request.log.info({ claseId: request.params.claseId }, 'Consultando detalle de clase');

      const item = await repository.obtenerClase(request.params.claseId, consultadoEn);
      if (!item) {
        return sendError(reply, 404, 'CLASE_NO_ENCONTRADA', 'No se encontró la clase solicitada.');
      }

      if (!validateDetail(item) || item.cuposDisponibles > item.capacidad) {
        throw new Error('La respuesta de la clase no cumple el contrato.');
      }
      successHeaders(reply);
      return item;
    }
  );

  function forbidden(reply: FastifyReply) {
    return reply.code(403).send({ codigo: 'NO_AUTORIZADO', mensaje: 'No puede operar sobre otro socio.' });
  }

  function businessError(reply: FastifyReply, codigo?: string) {
    const status = codigo === 'MEMBRESIA_NO_HABILITADA' ? 422
      : codigo === 'CLASE_NO_ENCONTRADA' || codigo === 'RESERVA_NO_ENCONTRADA' ? 404
      : codigo === 'CLASE_INICIADA' ? 400 : 409;
    return reply.code(status).send({
      codigo: codigo ?? 'ERROR_RESERVA',
      mensaje: 'No se pudo completar la operación: ' + (codigo ?? 'ERROR_RESERVA'),
      ...(codigo === 'CLASE_SIN_CUPOS' ? { puedeIngresarEspera: true } : {}),
    });
  }

  app.post<{ Body: { claseId?: unknown; socioId?: unknown; ingresarEsperaSiLlena?: unknown } }>(
    '/api/v1/reservas', { onRequest: auth.session }, async (request, reply) => {
      const body = request.body ?? {};
      const socioId = auth.target(request, body.socioId);
      if (!socioId) return forbidden(reply);
      if (typeof body.claseId !== 'string' || !body.claseId.trim()
        || (body.ingresarEsperaSiLlena !== undefined && typeof body.ingresarEsperaSiLlena !== 'boolean')) {
        return sendError(reply, 400, 'PARAMETROS_INVALIDOS', 'Clase y opción de espera inválidas.');
      }
      request.log.info({ claseId: body.claseId.trim(), socioId }, 'Solicitud de reserva');
      const result = await reservasService.reservar(
        body.claseId.trim(), socioId, body.ingresarEsperaSiLlena === true, request.traceContext,
      );
      request.log.info({
        claseId: body.claseId.trim(), socioId, codigo: result.codigo,
        estado: result.reserva?.estado ?? (result.espera ? 'LISTA_ESPERA' : 'RECHAZADA'),
      }, 'Resultado de reserva');
      if (!result.exito) return businessError(reply, result.codigo);
      if (result.espera) return reply.code(200).send({ estado: 'LISTA_ESPERA', espera: result.espera });
      return reply.code(201).send(result.reserva);
    },
  );

  app.post<{ Params: { reservaId: string } }>(
    '/api/v1/reservas/:reservaId/cancelar', { onRequest: auth.session }, async (request, reply) => {
      const reserva = await repository.obtenerReserva(request.params.reservaId);
      if (!reserva) return businessError(reply, 'RESERVA_NO_ENCONTRADA');
      if (!auth.target(request, reserva.socioId)) return forbidden(reply);
      const result = await reservasService.cancelarReserva(reserva.reservaId);
      if (!result.exito) return businessError(reply, result.codigo);
      return result;
    },
  );

  app.post<{ Params: { claseId: string }; Body: { socioId?: unknown } }>(
    '/api/v1/clases/:claseId/espera', { onRequest: auth.session }, async (request, reply) => {
      const socioId = auth.target(request, request.body?.socioId);
      if (!socioId) return forbidden(reply);
      const result = await reservasService.ingresarEspera(request.params.claseId, socioId, request.traceContext);
      if (!result.exito) return businessError(reply, result.codigo);
      return reply.code(201).send(result.espera);
    },
  );

  app.get<{ Querystring: { socioId?: string; sedeId?: string } }>(
    '/api/v1/reservas/clases', { onRequest: auth.session }, async (request, reply) => {
      const socioId = auth.target(request, request.query.socioId);
      if (!socioId) return forbidden(reply);
      const catalogo = await repository.listarClases(
        { sedeId: request.query.sedeId, pagina: 1, tamanio: 100 }, clock().toISOString(),
      );
      const personal = await repository.obtenerReservasPorSocio(socioId);
      reply.header('Cache-Control', 'no-store');
      reply.header('X-Instance-ID', instanceId);
      return { items: catalogo.items, total: catalogo.total, reservasSocio: personal.reservas, esperaSocio: personal.espera };
    },
  );

  app.get<{ Params: { claseId: string } }>(
    '/api/v1/clases/:claseId/reservas', { onRequest: auth.admin }, async (request) => {
      const claseId = request.params.claseId;
      return {
        claseId, reservas: await repository.obtenerReservasPorClase(claseId),
        espera: await repository.obtenerEsperaPorClase(claseId),
      };
    },
  );

  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    if (statusCode === 400) {
      return sendError(reply, 400, 'PARAMETROS_INVALIDOS', 'La solicitud tiene un formato inválido.');
    }
    request.log.error({ err: error }, 'No se pudo completar la consulta.');
    if (statusCode === 503) {
      return sendError(reply, 503, 'SERVICIO_NO_DISPONIBLE', 'La consulta no está disponible temporalmente.');
    }
    return sendError(reply, 500, 'ERROR_INTERNO', 'No se pudo completar la consulta.');
  });

  return Object.assign(app, { reservasService });
}
