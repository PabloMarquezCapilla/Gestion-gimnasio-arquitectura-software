import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { MockClass, mockClasses } from './mock-data';
import { IClaseRepository, MemoryClaseRepository } from './repository';
import { ISociosClient, MockSociosClient } from './clients/socios.client';
import { registerTracing } from './tracing';

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
      ? { redact: ['req.headers["x-api-key"]', 'req.headers.authorization'], ...options.logger }
      : options.logger
        ? { redact: ['req.headers["x-api-key"]', 'req.headers.authorization'] }
        : false;

  const app = Fastify({
    logger: loggerConfig,
  });

  const clock = options.clock ?? (() => new Date());

  // Inyeccion de dependencias (D2): repositorio y cliente de socios
  const repository: IClaseRepository =
    options.repository ??
    new MemoryClaseRepository(options.classes ?? mockClasses, true);

  const sociosClient: ISociosClient =
    options.sociosClient ?? new MockSociosClient();

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

  function successHeaders(reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    if (repository.isMock) {
      reply.header('X-Mock', 'true');
    }
  }

  app.get('/health', async (request, reply) => {
    const salud = await repository.verificarSalud();
    if (!salud.ok) {
      reply.code(503);
      return {
        servicio: 'clases-reservas',
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
      estado: 'operativo',
      modo: 'produccion',
      persistencia: 'postgresql',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/metrics', async (request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return [
      '# HELP http_requests_total Total de solicitudes HTTP procesadas',
      '# TYPE http_requests_total counter',
      'http_requests_total{service="clases-reservas"} 1',
      '# HELP pg_pool_active_connections Conexiones en el pool de base de datos',
      '# TYPE pg_pool_active_connections gauge',
      `pg_pool_active_connections{service="clases-reservas"} ${repository.isMock ? 0 : 1}`,
      '# HELP process_uptime_seconds Tiempo de actividad en segundos',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds{service="clases-reservas"} ${Math.floor(process.uptime())}`,
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

  // =========================================================================
  // Flujo Principal: Reservas de clases con consistencia y validacion (D1, D3, D4, D5)
  // =========================================================================

  app.post<{
    Body: { claseId: string; socioId: string; ingresarEsperaSiLlena?: boolean };
  }>('/api/v1/reservas', async (request, reply) => {
    const { claseId, socioId, ingresarEsperaSiLlena } = request.body ?? {};

    if (!claseId || !socioId) {
      return reply.code(400).send({
        codigo: 'PARAMETROS_INVALIDOS',
        mensaje: 'claseId y socioId son requeridos.',
      });
    }

    request.log.info({ claseId, socioId }, 'Iniciando solicitud de reserva para clase');

    // 1. Verificar existencia de la clase
    const clase = await repository.obtenerEntidadClase(claseId);
    if (!clase) {
      return reply.code(404).send({
        codigo: 'CLASE_NO_ENCONTRADA',
        mensaje: 'No se encontro la clase solicitada.',
      });
    }

    if (clock() >= new Date(clase.inicio)) {
      return reply.code(400).send({
        codigo: 'CLASE_YA_INICIADA',
        mensaje: 'No se puede reservar una clase que ya comenzo.',
      });
    }

    // 2. Colaboracion sincrona con Socios y Membresias (D5)
    request.log.info(
      { socioId, claseInicio: clase.inicio },
      'Llamando a Socios y Membresias para validar habilitacion'
    );

    let evaluacion;
    try {
      evaluacion = await sociosClient.verificarHabilitacion(
        socioId,
        clase.inicio,
        request.traceContext
      );
    } catch (err) {
      request.log.error({ err }, 'Error de comunicacion al consultar habilitacion de membresia');
      return reply.code(503).send({
        codigo: 'SERVICIO_NO_DISPONIBLE',
        mensaje: 'No se pudo verificar la membresia con el servicio de socios.',
      });
    }

    if (!evaluacion.habilitado) {
      request.log.warn({ socioId, motivo: evaluacion.motivo }, 'Membresia no habilitada para reservar');
      return reply.code(422).send({
        codigo: 'MEMBRESIA_NO_HABILITADA',
        mensaje: 'La membresia del socio no esta habilitada para la fecha de la clase.',
        motivo: evaluacion.motivo,
      });
    }

    // 3. Persistencia con garantias de concurrencia y cupos (D3 / D4)
    const resultado = await repository.reservarCupo(claseId, socioId);

    if (resultado.exito && resultado.reserva) {
      request.log.info({ reservaId: resultado.reserva.reservaId }, 'Reserva confirmada exitosamente');
      return reply.code(201).send(resultado.reserva);
    }

    if (resultado.codigo === 'RESERVA_DUPLICADA') {
      return reply.code(409).send({
        codigo: 'RESERVA_DUPLICADA',
        mensaje: resultado.mensaje,
      });
    }

    if (resultado.codigo === 'CLASE_SIN_CUPOS') {
      if (ingresarEsperaSiLlena) {
        request.log.info({ socioId, claseId }, 'Clase llena, ingresando a lista de espera');
        const esperaRes = await repository.ingresarListaEspera(claseId, socioId);
        if (esperaRes.exito) {
          return reply.code(200).send({
            estado: 'LISTA_ESPERA',
            mensaje: 'Clase llena; socio incorporado a la lista de espera.',
            espera: esperaRes.espera,
          });
        }
      }
      return reply.code(409).send({
        codigo: 'CLASE_SIN_CUPOS',
        mensaje: 'La clase no dispone de cupos libres.',
        puedeIngresarEspera: true,
      });
    }

    return reply.code(400).send({
      codigo: resultado.codigo || 'ERROR_RESERVA',
      mensaje: resultado.mensaje || 'No se pudo completar la reserva.',
    });
  });

  // Cancelacion de reserva y promocion automatica de lista de espera
  app.post<{ Params: { reservaId: string } }>(
    '/api/v1/reservas/:reservaId/cancelar',
    async (request, reply) => {
      const { reservaId } = request.params;
      request.log.info({ reservaId }, 'Solicitud de cancelacion de reserva');

      const resultado = await repository.cancelarReserva(
        reservaId,
        async (candidatoSocioId, inicioClase) => {
          request.log.info(
            { candidatoSocioId, inicioClase },
            'Validando candidato de lista de espera para promocion automatica'
          );
          try {
            const ev = await sociosClient.verificarHabilitacion(
              candidatoSocioId,
              inicioClase,
              request.traceContext
            );
            return ev.habilitado;
          } catch {
            return false;
          }
        }
      );

      if (!resultado.exito) {
        return reply.code(400).send({
          codigo: resultado.codigo,
          mensaje: resultado.mensaje,
        });
      }

      request.log.info(
        { reservaId, promocion: resultado.promocion },
        'Reserva cancelada exitosamente'
      );
      return reply.code(200).send(resultado);
    }
  );

  // Ingreso voluntario a lista de espera
  app.post<{
    Params: { claseId: string };
    Body: { socioId: string };
  }>('/api/v1/clases/:claseId/espera', async (request, reply) => {
    const { claseId } = request.params;
    const { socioId } = request.body ?? {};

    if (!socioId) {
      return reply.code(400).send({
        codigo: 'PARAMETROS_INVALIDOS',
        mensaje: 'socioId es requerido.',
      });
    }

    const clase = await repository.obtenerEntidadClase(claseId);
    if (!clase) {
      return reply.code(404).send({
        codigo: 'CLASE_NO_ENCONTRADA',
        mensaje: 'La clase no existe.',
      });
    }

    let ev;
    try {
      ev = await sociosClient.verificarHabilitacion(
        socioId,
        clase.inicio,
        request.traceContext
      );
    } catch (err) {
      request.log.error({ err }, 'Error de comunicacion con socios al unirse a espera');
      return reply.code(503).send({
        codigo: 'SERVICIO_NO_DISPONIBLE',
        mensaje: 'No se pudo verificar la membresia con el servicio de socios.',
      });
    }

    if (!ev.habilitado) {
      return reply.code(422).send({
        codigo: 'MEMBRESIA_NO_HABILITADA',
        mensaje: 'El socio no tiene membresia habilitada para unirse a la espera.',
      });
    }

    const res = await repository.ingresarListaEspera(claseId, socioId);
    if (!res.exito) {
      return reply.code(409).send({
        codigo: res.codigo,
        mensaje: 'No se pudo agregar a la lista de espera.',
      });
    }

    return reply.code(201).send(res.espera);
  });

  // Endpoint de diagnostico/auditoria de reservas por clase protegido con clave de consumidor
  app.get<{ Params: { claseId: string } }>(
    '/api/v1/clases/:claseId/reservas',
    { onRequest: authenticate },
    async (request, reply) => {
      const { claseId } = request.params;
      const reservas = await repository.obtenerReservasPorClase(claseId);
      const espera = await repository.obtenerEsperaPorClase(claseId);
      return { claseId, reservas, espera };
    }
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

  return app;
}
