import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import mockModule from '../dist/empleados.mock.js';

const { buildEmpleadosMockApp } = mockModule;
const path = '/api/v1/integraciones/empleados';
const contract = parse(readFileSync(
  new URL('../../../docs/contracts/openapi-empleados-v1.yaml', import.meta.url),
  'utf8',
));
const operation = contract.paths[path].post;
const ajv = new Ajv2020({ strict: false });
addFormats(ajv, { mode: 'full' });
const validateRequest = ajv.compile({
  ...operation.requestBody.content['application/json'].schema,
  components: contract.components,
});
const keyA = 'clave-ficticia-grupo-a';
const keyB = 'clave-ficticia-grupo-b';
const credenciales = [
  { apiKey: keyA, grupoId: 'grupo-ficticio-a' },
  { apiKey: keyB, grupoId: 'grupo-ficticio-b' },
];
const empleado = {
  empleadoExternoId: 'empleado-ficticio-001',
  dni: '99900001',
  nombre: 'Persona Ficticia',
  email: 'persona.ficticia@example.invalid',
};

function dereference(value) {
  if (!value?.$ref) return value;
  return value.$ref.slice(2).split('/').reduce(
    (current, part) => current[part.replace(/~1/g, '/').replace(/~0/g, '~')],
    contract,
  );
}

function verifyResponse(response) {
  const definition = dereference(operation.responses[String(response.statusCode)]);
  assert.ok(definition, 'El contrato debe declarar HTTP ' + response.statusCode);
  const validate = ajv.compile({
    ...definition.content['application/json'].schema,
    components: contract.components,
  });
  assert.equal(validate(response.json()), true, JSON.stringify(validate.errors));
  for (const [name, original] of Object.entries(definition.headers ?? {})) {
    const header = dereference(original);
    if (header.required) assert.ok(response.headers[name.toLowerCase()], 'Falta ' + name);
    if (response.headers[name.toLowerCase()] !== undefined && header.schema?.const !== undefined) {
      assert.equal(response.headers[name.toLowerCase()], header.schema.const);
    }
  }
  assert.equal(response.headers['x-mock'], 'true');
  assert.equal(response.headers['cache-control'], 'no-store');
  return response.json();
}

async function withApp(run, options = {}) {
  const app = buildEmpleadosMockApp({ credenciales, ...options });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

function post(app, payload = empleado, options = {}) {
  const headers = { 'content-type': options.contentType ?? 'application/json' };
  if (options.apiKey !== null) headers['x-api-key'] = options.apiKey ?? keyA;
  if (options.idempotencyKey !== null) headers['idempotency-key'] = options.idempotencyKey ?? 'alta-ficticia-001';
  return app.inject({ method: 'POST', url: path, headers, payload });
}

test('el contrato y el mock reciben un empleado y crean solo un alta pendiente', async () => {
  assert.equal(validateRequest(empleado), true, JSON.stringify(validateRequest.errors));
  await withApp(async (app) => {
    const response = await post(app);
    assert.equal(response.statusCode, 201);
    const body = verifyResponse(response);
    assert.deepEqual(Object.keys(body).sort(), [
      'estadoSolicitud', 'membresiaHabilitada', 'socioId', 'solicitudId',
    ]);
    assert.equal(body.estadoSolicitud, 'PENDIENTE');
    assert.equal(body.membresiaHabilitada, false);
    assert.ok(body.socioId);
    assert.ok(body.solicitudId);

    const maxLengths = {
      empleadoExternoId: 'e'.repeat(100),
      dni: '9'.repeat(20),
      nombre: 'N'.repeat(100),
      email: 'a'.repeat(60) + '@' + 'b'.repeat(31) + '.invalid',
    };
    assert.equal(maxLengths.email.length, 100);
    assert.equal(validateRequest(maxLengths), true);
    const maximum = await post(app, maxLengths, { idempotencyKey: 'alta-limites' });
    assert.equal(maximum.statusCode, 201);
    verifyResponse(maximum);
  });
});

test('el replay conserva el 201 y los IDs originales después de normalizar, antes de rechazar duplicados', async () => {
  await withApp(async (app) => {
    const first = await post(app, {
      empleadoExternoId: ' ' + empleado.empleadoExternoId + ' ',
      dni: ' ' + empleado.dni + ' ',
      nombre: ' ' + empleado.nombre + ' ',
      email: ' PERSONA.FICTICIA@EXAMPLE.INVALID ',
    });
    assert.equal(first.statusCode, 201);
    const original = verifyResponse(first);
    const reordered = {
      email: empleado.email,
      nombre: empleado.nombre,
      dni: empleado.dni,
      empleadoExternoId: empleado.empleadoExternoId,
    };
    const replay = await post(app, reordered);
    assert.equal(replay.statusCode, 201);
    assert.deepEqual(verifyResponse(replay), original);
    const modifiedCopy = replay.json();
    modifiedCopy.socioId = 'modificacion-externa-ficticia';
    const again = await post(app);
    assert.deepEqual(verifyResponse(again), original);
  });
});

test('la misma clave con otro contenido da conflicto sin modificar el alta anterior', async () => {
  await withApp(async (app) => {
    const original = verifyResponse(await post(app));
    const changed = await post(app, { ...empleado, nombre: 'Otra Persona Ficticia' });
    assert.equal(changed.statusCode, 409);
    assert.equal(verifyResponse(changed).codigo, 'IDEMPOTENCIA_EN_CONFLICTO');
    assert.deepEqual(verifyResponse(await post(app)), original);
  });
});

test('DNI y email preexistentes son conflictos globales sin sobrescribir socios', async () => {
  const seed = [{ socioId: 'socio-ficticio-existente', dni: '99900020', email: 'existente@example.invalid' }];
  const snapshot = structuredClone(seed);
  await withApp(async (app) => {
    for (const [index, body, codigo] of [
      [1, { ...empleado, dni: seed[0].dni }, 'DNI_EXISTENTE'],
      [2, { ...empleado, email: ' EXISTENTE@EXAMPLE.INVALID ' }, 'EMAIL_EXISTENTE'],
    ]) {
      const response = await post(app, body, { apiKey: keyB, idempotencyKey: 'conflicto-' + index });
      assert.equal(response.statusCode, 409);
      assert.equal(verifyResponse(response).codigo, codigo);
    }
    const created = await post(app);
    assert.equal(created.statusCode, 201);
    const duplicate = await post(app, {
      ...empleado, empleadoExternoId: 'otro-empleado-ficticio', email: 'otra.persona@example.invalid',
    }, { apiKey: keyB, idempotencyKey: 'dni-entre-grupos' });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(verifyResponse(duplicate).codigo, 'DNI_EXISTENTE');
    const duplicateEmail = await post(app, {
      ...empleado, empleadoExternoId: 'tercer-empleado-ficticio', dni: '99900030',
    }, { apiKey: keyB, idempotencyKey: 'email-entre-grupos' });
    assert.equal(duplicateEmail.statusCode, 409);
    assert.equal(verifyResponse(duplicateEmail).codigo, 'EMAIL_EXISTENTE');
    assert.deepEqual(seed, snapshot);
  }, { sociosIniciales: seed });
});

test('la identidad externa y la clave se distinguen por origen; un empleado no cambia de DNI', async () => {
  await withApp(async (app) => {
    const first = verifyResponse(await post(app));
    const otherOrigin = await post(app, {
      ...empleado, dni: '99900002', email: 'segundo.grupo@example.invalid',
    }, { apiKey: keyB });
    assert.equal(otherOrigin.statusCode, 201);
    assert.notEqual(verifyResponse(otherOrigin).socioId, first.socioId);
    const mismatch = await post(app, {
      ...empleado, dni: '99900003', email: 'tercera.persona@example.invalid',
    }, { idempotencyKey: 'otra-alta-ficticia' });
    assert.equal(mismatch.statusCode, 409);
    assert.equal(verifyResponse(mismatch).codigo, 'EMPLEADO_EXTERNO_EN_CONFLICTO');
    const sameDniNewKey = await post(app, empleado, { idempotencyKey: 'nueva-clave-mismo-empleado' });
    assert.equal(sameDniNewKey.statusCode, 409);
    assert.equal(verifyResponse(sameDniNewKey).codigo, 'DNI_EXISTENTE');
  });
});

test('campos requeridos, tipos, longitudes y email se validan desde OpenAPI', async () => {
  const invalidBodies = [null, [], 'texto-ficticio'];
  for (const field of Object.keys(empleado)) {
    const missing = { ...empleado };
    delete missing[field];
    invalidBodies.push(missing, { ...empleado, [field]: 42 }, { ...empleado, [field]: '' });
    const limit = { empleadoExternoId: 100, dni: 20, nombre: 100, email: 100 }[field];
    invalidBodies.push({ ...empleado, [field]: 'x'.repeat(limit + 1) });
  }
  invalidBodies.push({ ...empleado, email: 'correo-invalido' });
  await withApp(async (app) => {
    for (const body of invalidBodies) {
      assert.equal(validateRequest(body), false);
      const response = await post(app, body === null ? 'null' : body);
      assert.equal(response.statusCode, 400, JSON.stringify(body));
      assert.equal(verifyResponse(response).codigo, 'PARAMETROS_INVALIDOS');
    }
    for (const field of Object.keys(empleado)) {
      const response = await post(app, { ...empleado, [field]: '   ' });
      assert.equal(response.statusCode, 400);
      verifyResponse(response);
    }
  });
});

test('el consumidor no puede inyectar origen, rol, plan, contraseña ni habilitación', async () => {
  await withApp(async (app) => {
    for (const extra of [
      { origen: 'otro-grupo' }, { grupoId: 'otro-grupo' }, { rol: 'ADMIN' },
      { plan: 'PLAN_FICTICIO' }, { tipoPlan: 'PLAN_FICTICIO' }, { password: 'password-ficticio' },
      { estadoSolicitud: 'APROBADA' }, { membresiaHabilitada: true }, { pagoConfirmado: true },
    ]) {
      const body = { ...empleado, ...extra };
      assert.equal(validateRequest(body), false);
      const response = await post(app, body);
      assert.equal(response.statusCode, 400);
      assert.equal(verifyResponse(response).codigo, 'PARAMETROS_INVALIDOS');
    }
  });
});

test('autentica antes de validar o repetir el alta y exige una clave de idempotencia válida', async () => {
  await withApp(async (app) => {
    verifyResponse(await post(app));
    for (const apiKey of [null, 'credencial-ficticia-incorrecta']) {
      const response = await post(app, empleado, { apiKey });
      assert.equal(response.statusCode, 401);
      assert.equal(verifyResponse(response).codigo, 'NO_AUTENTICADO');
    }
    const malformedWithoutAuth = await post(app, '{', { apiKey: null, idempotencyKey: null });
    assert.equal(malformedWithoutAuth.statusCode, 401);
    verifyResponse(malformedWithoutAuth);
    for (const idempotencyKey of [null, '', '   ', 'x'.repeat(129)]) {
      const response = await post(app, empleado, { idempotencyKey });
      assert.equal(response.statusCode, 400);
      assert.equal(verifyResponse(response).codigo, 'PARAMETROS_INVALIDOS');
    }
  });
});

test('JSON malformado y medios no admitidos mantienen errores de solicitud declarados', async () => {
  await withApp(async (app) => {
    const malformed = await post(app, '{');
    assert.equal(malformed.statusCode, 400);
    assert.equal(verifyResponse(malformed).codigo, 'PARAMETROS_INVALIDOS');
    const plainText = await post(app, 'texto-ficticio', { contentType: 'text/plain' });
    assert.equal(plainText.statusCode, 415);
    assert.equal(verifyResponse(plainText).codigo, 'TIPO_CONTENIDO_NO_ADMITIDO');
  });
});

test('solicitudes concurrentes con la misma clave producen el mismo alta en este proceso', async () => {
  await withApp(async (app) => {
    const responses = await Promise.all(Array.from({ length: 10 }, () => post(app)));
    const original = verifyResponse(responses[0]);
    for (const response of responses) {
      assert.equal(response.statusCode, 201);
      assert.deepEqual(verifyResponse(response), original);
    }
    const conflicts = await Promise.all([
      post(app, empleado, { idempotencyKey: 'otra-clave-1' }),
      post(app, empleado, { idempotencyKey: 'otra-clave-2' }),
    ]);
    for (const response of conflicts) {
      assert.equal(response.statusCode, 409);
      assert.equal(verifyResponse(response).codigo, 'DNI_EXISTENTE');
    }
  });
});

test('un error inesperado devuelve el 500 genérico del contrato sin exponer su causa', async () => {
  await withApp(async (app) => {
    app.addHook('preHandler', async () => { throw new Error('detalle-ficticio-que-no-debe-publicarse'); });
    const response = await post(app);
    assert.equal(response.statusCode, 500);
    const body = verifyResponse(response);
    assert.equal(body.codigo, 'ERROR_INTERNO');
    assert.equal(JSON.stringify(body).includes('detalle-ficticio'), false);
  });
});
