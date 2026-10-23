import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import test from 'node:test';
import sociosModule from '../dist/app.js';
import repositoryModule from '../dist/repository.js';
import securityModule from '../dist/security.js';
import clientModule from '../dist/clients/car-cruds.client.js';

const { buildSociosApp } = sociosModule;
const { MemorySociosRepository, SEED_SOCIOS, SEED_MEMBRESIAS } = repositoryModule;
const { hashPassword } = securityModule;
const { HttpCarCrudsClient, CarCrudsError } = clientModule;
const path = '/api/v1/integraciones/car-cruds/empleados';
const fechaActual = '2026-10-23T15:00:00.000Z';
const password = 'clave-admin-ficticia-de-pruebas';
const admin = {
  socioId: 'admin-integracion', dni: '90000005', nombre: 'Administración Ficticia',
  email: 'admin.integracion@example.invalid', passwordHash: hashPassword(password),
  rol: 'ADMIN', estado: 'ACTIVO', createdAt: fechaActual,
};

function entorno(t, options = {}) {
  const repository = options.repository ?? new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS);
  const writes = [];
  for (const method of ['crearSocio', 'crearMembresia', 'actualizarEstadoMembresia', 'registrarEmpleado']) {
    const original = repository[method].bind(repository);
    repository[method] = (...args) => { writes.push(method); return original(...args); };
  }
  const app = buildSociosApp({
    repository, jwtSecret: 'clave-jwt-ficticia-integracion-con-mas-de-32-caracteres',
    internalApiKey: 'clave-servicio-ficticia-pruebas', clock: () => new Date(fechaActual),
    ...options,
  });
  t.after(() => app.close());
  return { app, repository, writes };
}

async function login(app, emailOrDni = admin.email, clave = password) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { emailOrDni, password: clave } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().token;
}

function headers(token) { return { authorization: 'Bearer ' + token }; }

function clientSpy() {
  const calls = [];
  return {
    calls,
    async listarEmpleados(page, pageSize, context) {
      calls.push({ operation: 'list', page, pageSize, context });
      return { items: [], page, pageSize, total: 0 };
    },
    async consultarEstado(employeeId, context) {
      calls.push({ operation: 'status', employeeId, context });
      return { employeeId, active: false };
    },
  };
}

test('Las consultas Car Cruds requieren un JWT de administrador antes de invocar al proveedor', async (t) => {
  const client = clientSpy();
  const { app, writes } = entorno(t, { carCrudsClient: client });
  const socioToken = await login(app, '11111111', 'socio123');
  for (const url of [path, path + '/empleado-ficticio/estado']) {
    for (const invalidHeaders of [{}, headers('token-alterado'), { 'x-service-key': 'clave-servicio-ficticia-pruebas' }]) {
      const response = await app.inject({ url, headers: invalidHeaders });
      assert.equal(response.statusCode, 401, response.body);
      assert.equal(response.json().codigo, 'NO_AUTENTICADO');
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    const forbidden = await app.inject({ url, headers: headers(socioToken) });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().codigo, 'ACCESO_DENEGADO');
  }
  assert.deepEqual(client.calls, []);
  assert.deepEqual(writes, []);
});

test('La autorización consulta el rol y estado actuales de la cuenta aunque su JWT diga ADMIN', async (t) => {
  const repository = new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS);
  const original = repository.obtenerSocio.bind(repository);
  let actual = admin;
  repository.obtenerSocio = (id) => id === admin.socioId ? Promise.resolve(actual) : original(id);
  const client = clientSpy();
  const { app } = entorno(t, { repository, carCrudsClient: client });
  const token = await login(app);
  for (const [value, status, code] of [
    [{ ...admin, rol: 'SOCIO' }, 403, 'ACCESO_DENEGADO'],
    [{ ...admin, estado: 'INACTIVO' }, 403, 'SOCIO_INACTIVO'],
    [null, 401, 'NO_AUTENTICADO'],
  ]) {
    actual = value;
    const response = await app.inject({ url: path, headers: headers(token) });
    assert.equal(response.statusCode, status, response.body);
    assert.equal(response.json().codigo, code);
  }
  assert.deepEqual(client.calls, []);
});

test('Sin configurar el proveedor, el administrador recibe un pendiente explícito y el resto conserva sus permisos', async (t) => {
  const { app, writes } = entorno(t);
  const token = await login(app);
  for (const url of [path, path + '/empleado-ficticio/estado']) {
    const response = await app.inject({ url, headers: headers(token) });
    assert.equal(response.statusCode, 503, response.body);
    assert.equal(response.json().codigo, 'CAR_CRUDS_NO_CONFIGURADO');
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal((await app.inject({ url })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  assert.deepEqual(writes, []);
});

test('Paginación y consultas inválidas se rechazan antes de consultar Car Cruds', async (t) => {
  const client = clientSpy();
  const { app } = entorno(t, { carCrudsClient: client });
  const token = await login(app);
  const auth = headers(token);
  for (const query of [
    '?page=0', '?page=-1', '?page=1.5', '?page=01', '?page=',
    '?page=9007199254740992', '?pageSize=0', '?pageSize=101',
    '?pageSize=9007199254740992', '?page=1&page=2', '?pageSize=20&pageSize=20',
    '?dni=11111111', '?page=1&extra=true',
  ]) {
    const response = await app.inject({ url: path + query, headers: auth });
    assert.equal(response.statusCode, 400, query + ': ' + response.body);
    assert.equal(response.json().codigo, 'PARAMETROS_INVALIDOS');
  }
  const statusQuery = await app.inject({ url: path + '/empleado-ficticio/estado?active=true', headers: auth });
  assert.equal(statusQuery.statusCode, 400, statusQuery.body);
  assert.deepEqual(client.calls, []);
  assert.equal((await app.inject({ url: path, headers: auth })).statusCode, 200);
  assert.equal((await app.inject({ url: path + '?page=2&pageSize=100', headers: auth })).statusCode, 200);
  assert.deepEqual(client.calls.map(({ page, pageSize }) => [page, pageSize]), [[1, 20], [2, 100]]);
});

test('Una consulta HTTP real propaga la traza con credencial propia, devuelve estado inactivo y no cambia socios ni membresías', async (t) => {
  const externalToken = 'token-ficticio-car-cruds-api-pruebas';
  const privateDetail = 'detalle-privado-del-proveedor-no-publicar';
  const employeeId = 'empleado-ficticio-001';
  const displayName = 'Nombre externo ficticio solo para la respuesta';
  const requests = [];
  let upstreamStatus = 200;
  const server = createServer((request, response) => {
    requests.push({ url: request.url, headers: request.headers, method: request.method });
    response.writeHead(upstreamStatus, { 'content-type': 'application/json' });
    response.end(JSON.stringify(upstreamStatus !== 200
      ? { error: privateDetail, token: externalToken }
      : request.url.endsWith('/status')
        ? { employeeId, active: false }
        : { items: [{ employeeId, displayName }], page: 1, pageSize: 20, total: 1 }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  let logs = '';
  const stream = new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } });
  const client = new HttpCarCrudsClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: externalToken });
  const { app, repository, writes } = entorno(t, {
    carCrudsClient: client,
    logger: { level: 'info', stream, redact: ['req.headers.authorization', 'req.headers.x-service-key', 'req.headers.x-api-key'] },
  });
  const before = await repository.obtenerMembresias('socio-demo-01');
  const token = await login(app);
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const incomingSpan = '00f067aa0ba902b7';
  const auth = { ...headers(token), traceparent: `00-${traceId}-${incomingSpan}-01` };
  const list = await app.inject({ url: path, headers: auth });
  assert.equal(list.statusCode, 200, list.body);
  assert.deepEqual(list.json().items, [{ employeeId, displayName }]);
  const status = await app.inject({ url: path + '/' + employeeId + '/estado', headers: auth });
  assert.equal(status.statusCode, 200, status.body);
  assert.deepEqual(status.json(), { employeeId, active: false });
  for (const [index, response] of [list, status].entries()) {
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-correlation-id'], traceId);
    const outbound = requests[index];
    assert.equal(outbound.method, 'GET');
    assert.equal(outbound.headers.authorization, 'Bearer ' + externalToken);
    assert.notEqual(outbound.headers.authorization, 'Bearer ' + token);
    assert.equal(outbound.headers['x-correlation-id'], traceId);
    assert.match(outbound.headers.traceparent, new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`));
    assert.notEqual(outbound.headers.traceparent, auth.traceparent);
    assert.notEqual(outbound.headers.traceparent, response.headers.traceparent);
  }
  for (const code of [401, 403]) {
    upstreamStatus = code;
    const response = await app.inject({ url: path, headers: auth });
    assert.equal(response.statusCode, 502, response.body);
    assert.equal(response.json().codigo, 'CAR_CRUDS_CREDENCIAL_RECHAZADA');
    assert.equal(response.headers['www-authenticate'], undefined);
    assert.ok(!response.body.includes(privateDetail));
    assert.ok(!response.body.includes(externalToken));
    assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: headers(token) })).statusCode, 200);
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(await repository.obtenerMembresias('socio-demo-01'), before);
  const entries = logs.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(entries.some((entry) => entry.proveedor === 'car-cruds' && entry.trace_id === traceId && entry.operacion === 'listar-empleados'));
  assert.ok(entries.some((entry) => entry.proveedor === 'car-cruds' && entry.codigo === 'CAR_CRUDS_CREDENCIAL_RECHAZADA' && entry.trace_id === traceId));
  for (const secret of [externalToken, token, privateDetail, displayName, admin.dni, admin.email]) {
    assert.ok(!logs.includes(secret), 'Los logs no deben publicar ' + secret);
  }
});

test('Los errores del proveedor mantienen su significado sin convertir desconocidos en bajas', async (t) => {
  let failure;
  const client = {
    async listarEmpleados() { throw failure; },
    async consultarEstado() { throw failure; },
  };
  const { app, writes } = entorno(t, { carCrudsClient: client });
  const token = await login(app);
  for (const [code, status] of [
    ['CAR_CRUDS_EMPLEADO_NO_ENCONTRADO', 404],
    ['CAR_CRUDS_NO_DISPONIBLE', 503],
    ['CAR_CRUDS_TIEMPO_AGOTADO', 504],
    ['CAR_CRUDS_RESPUESTA_INVALIDA', 502],
  ]) {
    failure = new CarCrudsError(code);
    const response = await app.inject({ url: path + '/empleado-ficticio/estado', headers: headers(token) });
    assert.equal(response.statusCode, status, response.body);
    assert.equal(response.json().codigo, code);
    assert.equal(response.json().active, undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  assert.deepEqual(writes, []);
});
