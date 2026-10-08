import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { MockClass, mockClasses } from './mock-data';

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
  logger?: boolean;
  clock?: () => Date;
  classes?: readonly MockClass[];
}

const contract = parse(
  readFileSync(resolve(__dirname, '../../../docs/contracts/openapi-v1.yaml'), 'utf8'),
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
    throw new Error('CAPACIDAD_API_KEY debe tener un valor para iniciar el mock.');
  }

  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers["x-api-key"]', 'req.headers.authorization'] }
      : false,
  });
  const classes = options.classes ?? mockClasses;
  const clock = options.clock ?? (() => new Date());
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

  function publicClass(item: MockClass, consultadoEn: string) {
    return {
      claseId: item.claseId,
      nombre: item.nombre,
      sedeId: item.sedeId,
      inicio: item.inicio,
      capacidad: item.capacidad,
      cuposDisponibles: item.cuposDisponibles,
      consultadoEn,
    };
  }

  function successHeaders(reply: FastifyReply) {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Mock', 'true');
  }

  app.get('/health', async () => ({
    servicio: 'clases-reservas',
    estado: 'estructura',
    modo: 'mock',
  }));

  app.get('/api/v1/clases', { onRequest: authenticate }, async (request, reply) => {
    const query = request.query;
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

    const matches = classes
      .filter((item) => item.publicada)
      .filter((item) => query.sedeId === undefined || item.sedeId === query.sedeId)
      .filter((item) => desde === undefined || Date.parse(item.inicio) >= desde)
      .filter((item) => hasta === undefined || Date.parse(item.inicio) < hasta)
      .sort((left, right) => {
        const difference = Date.parse(left.inicio) - Date.parse(right.inicio);
        if (difference !== 0) return difference;
        return left.claseId < right.claseId ? -1 : left.claseId > right.claseId ? 1 : 0;
      });
    const start = (query.pagina - 1) * query.tamanio;
    const consultadoEn = clock().toISOString();
    const body = {
      items: matches.slice(start, start + query.tamanio).map((item) => publicClass(item, consultadoEn)),
      pagina: query.pagina,
      tamanio: query.tamanio,
      total: matches.length,
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
      const item = classes.find((candidate) => candidate.publicada && candidate.claseId === request.params.claseId);
      if (!item) {
        return sendError(reply, 404, 'CLASE_NO_ENCONTRADA', 'No se encontró la clase solicitada.');
      }
      const body = publicClass(item, clock().toISOString());
      if (!validateDetail(body) || body.cuposDisponibles > body.capacidad) {
        throw new Error('La respuesta de la clase no cumple el contrato.');
      }
      successHeaders(reply);
      return body;
    },
  );

  app.setErrorHandler((error, request, reply) => {
    const statusCode = typeof error === 'object' && error !== null
      && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
    if (statusCode === 400) {
      return sendError(reply, 400, 'PARAMETROS_INVALIDOS', 'La solicitud tiene un formato inválido.');
    }
    request.log.error({ err: error }, 'No se pudo completar la consulta del mock.');
    if (statusCode === 503) {
      return sendError(reply, 503, 'SERVICIO_NO_DISPONIBLE', 'La consulta no está disponible temporalmente.');
    }
    return sendError(reply, 500, 'ERROR_INTERNO', 'No se pudo completar la consulta.');
  });

  return app;
}
