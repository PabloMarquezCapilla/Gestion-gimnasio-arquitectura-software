import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { clavesIguales } from './security';
import { SociosError } from './errors';
import { EmpleadoExterno, EmpleadosService } from './empleados.service';

export interface CredencialEmpleados { apiKey: string; grupoId: string }

// No se usa CAPACIDAD_API_KEY, la clave técnica ni el JWT como credencial externa.
export function credencialesEmpleadosDesdeEntorno(): CredencialEmpleados[] {
  const apiKey = process.env.EMPLEADOS_API_KEY;
  const grupoId = process.env.EMPLEADOS_ORIGEN_ID;
  if (apiKey === undefined && grupoId === undefined) return [];
  if (!apiKey?.trim() || !grupoId?.trim()) {
    throw new Error('Configurar conjuntamente EMPLEADOS_API_KEY y EMPLEADOS_ORIGEN_ID.');
  }
  return [{ apiKey, grupoId }];
}

const contract = parse(readFileSync(resolve(__dirname, '../../../docs/contracts/openapi-empleados-v1.yaml'), 'utf8'));
const operation = contract.paths['/api/v1/integraciones/empleados'].post;
const ajv = new Ajv2020({ strict: false });
addFormats(ajv, { mode: 'full' });
const validarBody = ajv.compile<EmpleadoExterno>({
  ...operation.requestBody.content['application/json'].schema, components: contract.components,
});
const validarClave = ajv.compile(operation.parameters.find((p: { name: string }) => p.name === 'Idempotency-Key').schema);

export function registerEmpleadosHttp(
  app: FastifyInstance, service: EmpleadosService, credenciales: readonly CredencialEmpleados[],
) {
  const configuradas = credenciales.map((credencial) => ({ ...credencial, grupoId: credencial.grupoId.trim() }));
  const claves = new Set<string>();
  for (const { apiKey, grupoId } of configuradas) {
    if (!apiKey?.trim() || !grupoId || grupoId.length > 100 || claves.has(apiKey)) {
      throw new Error('Configuración de credenciales externas inválida.');
    }
    claves.add(apiKey);
  }
  const origenes = new WeakMap<FastifyRequest, string>();
  function fail(reply: FastifyReply, status: number, codigo: string, mensaje: string) {
    return reply.header('Cache-Control', 'no-store').code(status).send({ codigo, mensaje });
  }
  app.post('/api/v1/integraciones/empleados', {
    onRequest: async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const recibida = request.headers['x-api-key'];
      const origen = typeof recibida === 'string'
        ? configuradas.find(({ apiKey }) => clavesIguales(recibida, apiKey))?.grupoId : undefined;
      if (!origen) {
        reply.header('WWW-Authenticate', 'ApiKey realm="empleados"');
        return fail(reply, 401, 'NO_AUTENTICADO', 'Credencial externa ausente o inválida.');
      }
      origenes.set(request, origen);
      if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return fail(reply, 415, 'TIPO_CONTENIDO_NO_ADMITIDO', 'Se requiere Content-Type application/json.');
      }
    },
    errorHandler: (error, request, reply) => {
      if (error instanceof SociosError) return fail(reply, error.statusCode, error.codigo, error.message);
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 400 || status === 413 || status === 422) {
        return fail(reply, 400, 'PARAMETROS_INVALIDOS', 'La solicitud tiene un formato inválido.');
      }
      if (status === 415) return fail(reply, 415, 'TIPO_CONTENIDO_NO_ADMITIDO', 'Se requiere Content-Type application/json.');
      // Evitar registrar el cuerpo o excepciones SQL que contengan DNI/email.
      request.log.error({ codigo: 'ERROR_INTERNO' }, 'No se pudo registrar el empleado externo');
      return fail(reply, 500, 'ERROR_INTERNO', 'No se pudo procesar la solicitud.');
    },
  }, async (request, reply) => {
    const clave = request.headers['idempotency-key'];
    if (typeof clave !== 'string' || !validarClave(clave)) {
      return fail(reply, 400, 'PARAMETROS_INVALIDOS', 'Idempotency-Key es obligatoria y debe tener de 1 a 128 caracteres.');
    }
    const value = request.body;
    const normalizado = value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).map(([key, field]) => [key,
        typeof field === 'string' ? key === 'email' ? field.trim().toLowerCase() : field.trim() : field,
      ])) : value;
    if (!validarBody(normalizado)) {
      return fail(reply, 400, 'PARAMETROS_INVALIDOS', 'Los datos del empleado no cumplen el contrato.');
    }
    const origen = origenes.get(request)!;
    const result = await service.recibir(origen, clave, normalizado);
    request.log.info({ origen, socioId: result.socioId, solicitudId: result.solicitudId, estadoSolicitud: result.estadoSolicitud },
      'Alta externa resuelta sin habilitar membresía');
    return reply.code(201).send(result);
  });
}
