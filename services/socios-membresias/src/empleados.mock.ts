import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';

interface EmpleadoExterno {
  empleadoExternoId: string;
  dni: string;
  nombre: string;
  email: string;
}

interface AltaPendiente {
  socioId: string;
  solicitudId: string;
  estadoSolicitud: 'PENDIENTE';
  membresiaHabilitada: false;
}

export interface EmpleadosMockOptions {
  credenciales: readonly { apiKey: string; grupoId: string }[];
  sociosIniciales?: readonly { socioId: string; dni: string; email: string }[];
}

interface Contract {
  components: Record<string, unknown>;
  paths: Record<string, {
    post: {
      parameters: { name: string; schema: Record<string, unknown> }[];
      requestBody: { content: Record<string, { schema: Record<string, unknown> }> };
      responses: Record<string, Record<string, unknown>>;
    };
  }>;
}

const ruta = '/api/v1/integraciones/empleados';
const contract = parse(
  readFileSync(resolve(__dirname, '../../../docs/contracts/openapi-empleados-v1.yaml'), 'utf8'),
) as Contract;
const operation = contract.paths[ruta].post;
const ajv = new Ajv2020({ strict: false });
addFormats(ajv, { mode: 'full' });
const validateBody = ajv.compile<EmpleadoExterno>({
  ...operation.requestBody.content['application/json'].schema,
  components: contract.components,
});
const validateKey = ajv.compile(
  operation.parameters.find((parameter) => parameter.name === 'Idempotency-Key')!.schema,
);

function dereference(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.$ref !== 'string') return value;
  let result: unknown = contract;
  for (const part of value.$ref.slice(2).split('/')) {
    result = (result as Record<string, unknown>)[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  }
  return result as Record<string, unknown>;
}

function responseSchema(status: number) {
  const response = dereference(operation.responses[String(status)]);
  const content = response.content as Record<string, { schema: Record<string, unknown> }>;
  return { ...content['application/json'].schema, components: contract.components };
}

const validateAlta = ajv.compile(responseSchema(201));
const validateError = ajv.compile(responseSchema(500));

function normalizeBody(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [
    key,
    typeof field === 'string'
      ? key === 'email' ? field.trim().toLowerCase() : field.trim()
      : field,
  ]));
}

// Mock aislado: no importa buildSociosApp ni crea conexiones a bases o brokers.
export function buildEmpleadosMockApp(options: EmpleadosMockOptions) {
  if (!options.credenciales?.length) {
    throw new Error('El mock requiere al menos una credencial externa ficticia.');
  }
  const origenPorCredencial = new Map<string, string>();
  for (const { apiKey, grupoId } of options.credenciales) {
    if (!apiKey?.trim() || !grupoId?.trim() || origenPorCredencial.has(apiKey)) {
      throw new Error('La configuración de credenciales del mock es inválida.');
    }
    origenPorCredencial.set(apiKey, grupoId.trim());
  }

  const sociosPorDni = new Map<string, { socioId: string; dni: string; email: string }>();
  const sociosPorEmail = new Map<string, { socioId: string; dni: string; email: string }>();
  for (const source of options.sociosIniciales ?? []) {
    const socio = { socioId: source.socioId, dni: source.dni.trim(), email: source.email.trim().toLowerCase() };
    if (!socio.socioId || !socio.dni || !socio.email
      || sociosPorDni.has(socio.dni) || sociosPorEmail.has(socio.email)) {
      throw new Error('Los socios iniciales ficticios deben tener identidad única.');
    }
    sociosPorDni.set(socio.dni, socio);
    sociosPorEmail.set(socio.email, socio);
  }

  const empleadosPorOrigen = new Map<string, { dni: string }>();
  // El JSON guardado es inmutable y cada replay recibe una copia nueva.
  const altasPorClave = new Map<string, { contenido: string; respuestaJson: string }>();
  const app = Fastify({ logger: false });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Mock', 'true');
    return payload;
  });

  function fail(reply: FastifyReply, status: number, codigo: string, mensaje: string) {
    const body = { codigo, mensaje };
    if (!validateError(body)) throw new Error('La respuesta de error no cumple el contrato.');
    return reply.code(status).send(body);
  }

  async function authorize(request: FastifyRequest, reply: FastifyReply) {
    const apiKey = request.headers['x-api-key'];
    if (typeof apiKey !== 'string' || !origenPorCredencial.has(apiKey)) {
      reply.header('WWW-Authenticate', 'ApiKey realm="empleados"');
      return fail(reply, 401, 'NO_AUTENTICADO', 'Credencial externa ausente o inválida.');
    }
    const contentType = request.headers['content-type'];
    if (contentType?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      return fail(reply, 415, 'TIPO_CONTENIDO_NO_ADMITIDO', 'Se requiere Content-Type application/json.');
    }
  }

  app.post(ruta, { onRequest: authorize }, async (request, reply) => {
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !validateKey(idempotencyKey)) {
      return fail(reply, 400, 'PARAMETROS_INVALIDOS', 'Idempotency-Key es obligatoria y debe tener de 1 a 128 caracteres.');
    }
    const body = normalizeBody(request.body);
    if (!validateBody(body)) {
      return fail(reply, 400, 'PARAMETROS_INVALIDOS', 'Los datos del empleado no cumplen el contrato.');
    }
    const grupoId = origenPorCredencial.get(request.headers['x-api-key'] as string)!;
    const claveDeAlta = JSON.stringify([grupoId, idempotencyKey]);
    const contenido = JSON.stringify({
      empleadoExternoId: body.empleadoExternoId,
      dni: body.dni,
      nombre: body.nombre,
      email: body.email,
    });
    const anterior = altasPorClave.get(claveDeAlta);
    if (anterior) {
      if (anterior.contenido !== contenido) {
        return fail(reply, 409, 'IDEMPOTENCIA_EN_CONFLICTO', 'La clave de idempotencia ya se utilizó con otro contenido.');
      }
      return reply.code(201).send(JSON.parse(anterior.respuestaJson) as AltaPendiente);
    }

    const empleadoKey = JSON.stringify([grupoId, body.empleadoExternoId]);
    const empleadoAnterior = empleadosPorOrigen.get(empleadoKey);
    if (empleadoAnterior && empleadoAnterior.dni !== body.dni) {
      return fail(reply, 409, 'EMPLEADO_EXTERNO_EN_CONFLICTO', 'El empleado externo ya está asociado a otro DNI.');
    }
    if (sociosPorDni.has(body.dni)) {
      return fail(reply, 409, 'DNI_EXISTENTE', 'El DNI ya pertenece a un socio.');
    }
    if (sociosPorEmail.has(body.email)) {
      return fail(reply, 409, 'EMAIL_EXISTENTE', 'El email ya pertenece a un socio.');
    }

    const respuesta: AltaPendiente = {
      socioId: 'socio-' + randomUUID(),
      solicitudId: 'sol-' + randomUUID(),
      estadoSolicitud: 'PENDIENTE',
      membresiaHabilitada: false,
    };
    if (!validateAlta(respuesta)) throw new Error('El alta no cumple el contrato.');
    const socio = { socioId: respuesta.socioId, dni: body.dni, email: body.email };
    // No hay await entre comprobaciones y registro: esta demostración es de un solo proceso.
    sociosPorDni.set(socio.dni, socio);
    sociosPorEmail.set(socio.email, socio);
    empleadosPorOrigen.set(empleadoKey, { dni: body.dni });
    altasPorClave.set(claveDeAlta, { contenido, respuestaJson: JSON.stringify(respuesta) });
    return reply.code(201).send({ ...respuesta });
  });

  app.setErrorHandler((error, _request, reply) => {
    const status = typeof error === 'object' && error !== null
      && 'statusCode' in error && typeof error.statusCode === 'number'
      ? error.statusCode
      : 500;
    if (status === 400 || status === 413 || status === 422) {
      return fail(reply, 400, 'PARAMETROS_INVALIDOS', 'La solicitud tiene un formato inválido.');
    }
    if (status === 415) {
      return fail(reply, 415, 'TIPO_CONTENIDO_NO_ADMITIDO', 'Se requiere Content-Type application/json.');
    }
    return fail(reply, 500, 'ERROR_INTERNO', 'No se pudo procesar la solicitud.');
  });
  return app;
}

async function startMock() {
  const port = Number(process.env.MOCK_EMPLEADOS_PORT ?? 3005);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('MOCK_EMPLEADOS_PORT debe ser un entero entre 1 y 65535.');
  }
  const app = buildEmpleadosMockApp({
    credenciales: [{
      apiKey: process.env.MOCK_EMPLEADOS_API_KEY ?? 'clave-ficticia-solo-pruebas',
      grupoId: process.env.MOCK_EMPLEADOS_GRUPO_ID ?? 'grupo-ficticio',
    }],
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => { process.exitCode = 1; });
    });
  }
  await app.listen({ host: '127.0.0.1', port });
  console.log('Mock ficticio de empleados: http://127.0.0.1:' + port + ruta);
  console.log('Solo memoria; sin bases ni pagos. La credencial predeterminada es exclusivamente ficticia.');
}

if (require.main === module) {
  void startMock().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'No se pudo iniciar el mock de empleados.');
    process.exitCode = 1;
  });
}
