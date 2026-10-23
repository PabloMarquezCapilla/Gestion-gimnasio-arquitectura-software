import assert from 'node:assert/strict';
import test from 'node:test';
import sociosModule from '../dist/app.js';
import repositoryModule from '../dist/repository.js';
import securityModule from '../dist/security.js';
import clientModule from '../dist/clients/car-cruds.client.js';

const { buildSociosApp } = sociosModule;
const { MemorySociosRepository, SEED_SOCIOS, SEED_MEMBRESIAS } = repositoryModule;
const { hashPassword } = securityModule;
const { CarCrudsError } = clientModule;
const base = '/api/v1/integraciones/car-cruds';
const fecha = '2026-10-23T15:00:00.000Z';
const clave = 'clave-administrador-ficticia-pruebas';
const admin = {
  socioId: 'admin-vinculos-prueba', dni: '90000101', nombre: 'Administración Ficticia',
  email: 'admin.vinculos@example.invalid', passwordHash: hashPassword(clave),
  rol: 'ADMIN', estado: 'ACTIVO', createdAt: fecha,
};

function clienteControlado() {
  const calls = [];
  return {
    calls, fallo: undefined, active: true,
    async listarEmpleados(page, pageSize) { return { items: [], page, pageSize, total: 0 }; },
    async consultarEstado(employeeId, context) {
      calls.push({ employeeId, context });
      if (this.fallo) throw this.fallo;
      return { employeeId, active: this.active };
    },
  };
}

function entorno(t, options = {}) {
  const repository = options.repository ?? new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS);
  const client = options.carCrudsClient ?? clienteControlado();
  const app = buildSociosApp({
    repository, carCrudsClient: client,
    jwtSecret: 'clave-jwt-ficticia-vinculos-con-mas-de-32-caracteres',
    internalApiKey: 'clave-servicios-ficticia-vinculos', clock: () => new Date(fecha),
    ...options,
  });
  t.after(() => app.close());
  return { app, repository, client };
}

async function login(app, emailOrDni = admin.email, password = clave) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { emailOrDni, password } });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().token;
}

function auth(token) { return { authorization: 'Bearer ' + token }; }
function ruta(employeeId) { return base + '/empleados/' + encodeURIComponent(employeeId) + '/vinculo'; }
function cambio(app, token, employeeId, socioId, versionEsperada = 0, extra = {}) {
  return app.inject({ method: 'PUT', url: ruta(employeeId), headers: auth(token), payload: { socioId, versionEsperada, ...extra } });
}
function localCambio(employeeId, socioId, versionEsperada = 0) {
  return { employeeId, socioId, versionEsperada, administradorId: admin.socioId, fecha };
}

async function snapshotPersonas(repository) {
  return Promise.all([...SEED_SOCIOS, admin].map(async ({ socioId }) => ({
    socio: await repository.obtenerSocio(socioId), membresias: await repository.obtenerMembresias(socioId),
  })));
}

test('Todas las operaciones locales de vínculos requieren administrador antes de consultar o escribir', async (t) => {
  const { app, repository, client } = entorno(t);
  const socioToken = await login(app, '11111111', 'socio123');
  const operations = [
    { url: base + '/vinculos' }, { url: ruta('empleado-ficticio') },
    { url: ruta('empleado-ficticio') + '/historial' },
    { method: 'PUT', url: ruta('empleado-ficticio'), payload: { socioId: 'socio-demo-01', versionEsperada: 0 } },
    { method: 'POST', url: base + '/socios/buscar', payload: { identificador: '11111111' } },
  ];
  for (const operation of operations) {
    for (const headers of [{}, auth('token-alterado'), { 'x-service-key': 'clave-servicios-ficticia-vinculos' }]) {
      const response = await app.inject({ ...operation, headers });
      assert.equal(response.statusCode, 401, response.body);
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    const forbidden = await app.inject({ ...operation, headers: auth(socioToken) });
    assert.equal(forbidden.statusCode, 403, forbidden.body);
    assert.equal(forbidden.json().codigo, 'ACCESO_DENEGADO');
  }
  assert.deepEqual(client.calls, []);
  assert.deepEqual(await repository.getHistorialVinculoCarCruds('empleado-ficticio'), []);
});

test('Un JWT administrativo pierde acceso si cambió el rol o se desactivó la cuenta', async (t) => {
  const repository = new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS);
  const original = repository.obtenerSocio.bind(repository);
  let actual = admin;
  repository.obtenerSocio = (id) => id === admin.socioId ? Promise.resolve(actual) : original(id);
  const { app, client } = entorno(t, { repository });
  const token = await login(app);
  for (const [account, expected] of [[{ ...admin, rol: 'SOCIO' }, 403], [{ ...admin, estado: 'INACTIVO' }, 403], [null, 401]]) {
    actual = account;
    const response = await cambio(app, token, 'empleado-ficticio', 'socio-demo-01');
    assert.equal(response.statusCode, expected, response.body);
  }
  assert.deepEqual(client.calls, []);
  assert.deepEqual(await repository.getHistorialVinculoCarCruds('empleado-ficticio'), []);
});

test('Buscar socios exige DNI o email exactos, devuelve datos públicos y no crea cuentas', async (t) => {
  const { app, repository, client } = entorno(t);
  const token = await login(app);
  const before = await snapshotPersonas(repository);
  for (const identificador of ['11111111', '  JUAN.PEREZ@EXAMPLE.COM  ']) {
    const response = await app.inject({ method: 'POST', url: base + '/socios/buscar', headers: auth(token), payload: { identificador } });
    assert.equal(response.statusCode, 200, response.body);
    const { items } = response.json();
    assert.equal(items.length, 1);
    assert.equal(items[0].socioId, 'socio-demo-01');
    assert.equal(items[0].passwordHash, undefined);
    assert.equal(items[0].password, undefined);
    assert.equal(items[0].token, undefined);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  for (const identificador of ['Juan Pérez', '1111', 'no-existe@example.invalid']) {
    const response = await app.inject({ method: 'POST', url: base + '/socios/buscar', headers: auth(token), payload: { identificador } });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { items: [] });
  }
  assert.deepEqual(await snapshotPersonas(repository), before);
  assert.deepEqual(client.calls, []);
});

test('La búsqueda no elige tácitamente una persona si un dato coincide con dos cuentas', async (t) => {
  const repository = new MemorySociosRepository([
    admin,
    { ...SEED_SOCIOS[0], socioId: 'cruce-a', dni: 'cruce@x.invalid' },
    { ...SEED_SOCIOS[1], socioId: 'cruce-b', email: 'cruce@x.invalid' },
  ], []);
  const { app } = entorno(t, { repository });
  const token = await login(app);
  const response = await app.inject({ method: 'POST', url: base + '/socios/buscar', headers: auth(token), payload: { identificador: 'cruce@x.invalid' } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json().items.map(({ socioId }) => socioId).sort(), ['cruce-a', 'cruce-b']);
  assert.ok(response.json().items.every((item) => item.passwordHash === undefined));
});

test('Vincular, corregir y quitar conserva auditoría del administrador sin cambiar personas ni membresías', async (t) => {
  const { app, repository, client } = entorno(t);
  const token = await login(app);
  const before = await snapshotPersonas(repository);
  const employeeId = 'empleado-historial';
  const absent = await app.inject({ url: ruta(employeeId), headers: auth(token) });
  assert.equal(absent.statusCode, 200, absent.body);
  assert.deepEqual(absent.json(), { employeeId, socioId: null, version: 0, actualizadoEn: null });
  for (const [socioId, versionEsperada, version] of [['socio-demo-01', 0, 1], ['socio-demo-02', 1, 2], [null, 2, 3]]) {
    const response = await cambio(app, token, employeeId, socioId, versionEsperada);
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { employeeId, socioId, version, actualizadoEn: fecha });
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const history = await app.inject({ url: ruta(employeeId) + '/historial', headers: auth(token) });
  assert.equal(history.statusCode, 200, history.body);
  assert.deepEqual(history.json().items.map(({ socioAnteriorId, socioNuevoId, version, administradorId, createdAt }) =>
    ({ socioAnteriorId, socioNuevoId, version, administradorId, createdAt })), [
    { socioAnteriorId: null, socioNuevoId: 'socio-demo-01', version: 1, administradorId: admin.socioId, createdAt: fecha },
    { socioAnteriorId: 'socio-demo-01', socioNuevoId: 'socio-demo-02', version: 2, administradorId: admin.socioId, createdAt: fecha },
    { socioAnteriorId: 'socio-demo-02', socioNuevoId: null, version: 3, administradorId: admin.socioId, createdAt: fecha },
  ]);
  assert.equal(new Set(history.json().items.map(({ historialId }) => historialId)).size, 3);
  assert.equal(client.calls.length, 2, 'Desvincular no depende de Car Cruds');
  assert.deepEqual(await snapshotPersonas(repository), before);
});

test('Un reintento de la misma asociación no consume versiones ni duplica el historial', async (t) => {
  const { app, repository } = entorno(t);
  const token = await login(app);
  const first = await cambio(app, token, 'empleado-reintento', 'socio-demo-01');
  assert.equal(first.statusCode, 200, first.body);
  const repeated = await Promise.all(Array.from({ length: 6 }, () => cambio(app, token, 'empleado-reintento', 'socio-demo-01', 0)));
  for (const response of repeated) {
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), first.json());
  }
  assert.equal((await repository.getHistorialVinculoCarCruds('empleado-reintento')).length, 1);
  assert.equal((await cambio(app, token, 'empleado-reintento', null, 1)).statusCode, 200);
  const repeatedUnlink = await cambio(app, token, 'empleado-reintento', null, 0);
  assert.equal(repeatedUnlink.statusCode, 200, repeatedUnlink.body);
  assert.equal(repeatedUnlink.json().version, 2);
  assert.equal((await repository.getHistorialVinculoCarCruds('empleado-reintento')).length, 2);
});

test('La unicidad uno a uno y la revisión rechazan sobrescrituras y conservan el vínculo anterior', async (t) => {
  const { app, repository } = entorno(t);
  const token = await login(app);
  assert.equal((await cambio(app, token, 'empleado-a', 'socio-demo-01')).statusCode, 200);
  const duplicate = await cambio(app, token, 'empleado-b', 'socio-demo-01');
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  assert.equal(duplicate.json().codigo, 'SOCIO_YA_VINCULADO');
  assert.equal((await cambio(app, token, 'empleado-a', 'socio-demo-02', 1)).statusCode, 200);
  const stale = await cambio(app, token, 'empleado-a', null, 1);
  assert.equal(stale.statusCode, 409, stale.body);
  assert.equal(stale.json().codigo, 'VINCULO_DESACTUALIZADO');
  assert.equal((await repository.obtenerVinculoCarCruds('empleado-a')).socioId, 'socio-demo-02');
  assert.equal((await repository.getHistorialVinculoCarCruds('empleado-a')).length, 2);
  assert.deepEqual(await repository.getHistorialVinculoCarCruds('empleado-b'), []);
  assert.equal((await cambio(app, token, 'empleado-b', 'socio-demo-01')).statusCode, 200, 'Corregir libera el socio anterior');
});

test('Una cuenta inexistente no se crea tácitamente y un empleado inactivo puede vincularse', async (t) => {
  const { app, repository, client } = entorno(t);
  const token = await login(app);
  const invalid = await cambio(app, token, 'empleado-ficticio', 'socio-inexistente');
  assert.equal(invalid.statusCode, 404, invalid.body);
  assert.equal(invalid.json().codigo, 'SOCIO_NO_ENCONTRADO');
  assert.equal(await repository.obtenerSocio('socio-inexistente'), null);
  assert.deepEqual(await repository.getHistorialVinculoCarCruds('empleado-ficticio'), []);
  client.active = false;
  const linked = await cambio(app, token, 'empleado-ficticio', 'socio-demo-01');
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal(linked.json().socioId, 'socio-demo-01');
  assert.equal((await repository.obtenerMembresias('socio-demo-01'))[0].estado, 'HABILITADA');
});

test('Dar de alta un socio sigue siendo una operación explícita y no activa membresía al vincularlo', async (t) => {
  const { app, repository } = entorno(t);
  const token = await login(app);
  const alta = await app.inject({ method: 'POST', url: '/api/v1/socios', headers: auth(token), payload: {
    dni: '90000102', nombre: 'Persona Nueva Ficticia', email: 'alta.vinculo@example.invalid', password: 'clave-ficticia-persona',
  } });
  assert.equal(alta.statusCode, 201, alta.body);
  assert.equal(alta.json().membresia, null);
  assert.equal(alta.json().token, undefined);
  const socioId = alta.json().socio.socioId;
  const linked = await cambio(app, token, 'empleado-alta-explicita', socioId);
  assert.equal(linked.statusCode, 200, linked.body);
  assert.deepEqual(await repository.obtenerMembresias(socioId), []);
  assert.equal((await repository.obtenerSocio(socioId)).rol, 'SOCIO');
  assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: auth(token) })).json().socio.socioId, admin.socioId);
});

test('Una falla o un 404 externo bloquea la asociación sin cambios locales ni baja inferida', async (t) => {
  const { app, repository, client } = entorno(t);
  const token = await login(app);
  assert.equal((await cambio(app, token, 'empleado-con-vinculo', 'socio-demo-01')).statusCode, 200);
  const before = await snapshotPersonas(repository);
  for (const [code, expectedStatus] of [
    ['CAR_CRUDS_EMPLEADO_NO_ENCONTRADO', 404], ['CAR_CRUDS_NO_DISPONIBLE', 503],
    ['CAR_CRUDS_TIEMPO_AGOTADO', 504], ['CAR_CRUDS_RESPUESTA_INVALIDA', 502],
  ]) {
    client.fallo = new CarCrudsError(code);
    const response = await cambio(app, token, 'empleado-con-vinculo', 'socio-demo-02', 1);
    assert.equal(response.statusCode, expectedStatus, response.body);
    assert.equal(response.json().codigo, code);
    assert.equal((await repository.obtenerVinculoCarCruds('empleado-con-vinculo')).socioId, 'socio-demo-01');
    assert.equal((await repository.getHistorialVinculoCarCruds('empleado-con-vinculo')).length, 1);
  }
  assert.deepEqual(await snapshotPersonas(repository), before);
  const calls = client.calls.length;
  assert.equal((await cambio(app, token, 'empleado-con-vinculo', null, 1)).statusCode, 200);
  assert.equal(client.calls.length, calls, 'La recuperación administrativa local funciona con el proveedor caído');
});

test('Los vínculos y su historial pueden consultarse y quitarse sin configurar el proveedor', async (t) => {
  const repository = new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS);
  await repository.cambiarVinculoCarCruds(localCambio('empleado-local', 'socio-demo-01'));
  const { app } = entorno(t, { repository, carCrudsClient: undefined });
  const token = await login(app);
  for (const url of [base + '/vinculos', ruta('empleado-local'), ruta('empleado-local') + '/historial']) {
    const response = await app.inject({ url, headers: auth(token) });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers['cache-control'], 'no-store');
  }
  const blocked = await cambio(app, token, 'empleado-nuevo', 'socio-demo-02');
  assert.equal(blocked.statusCode, 503, blocked.body);
  assert.equal(blocked.json().codigo, 'CAR_CRUDS_NO_CONFIGURADO');
  assert.equal((await cambio(app, token, 'empleado-local', null, 1)).statusCode, 200);
});

test('El listado local pagina en orden estable y excluye los vínculos quitados', async (t) => {
  const { app, repository, client } = entorno(t);
  for (const [employeeId, socioId] of [['empleado-b', 'socio-demo-02'], ['empleado-a', 'socio-demo-01'], ['empleado-c', 'socio-demo-03']]) {
    await repository.cambiarVinculoCarCruds(localCambio(employeeId, socioId));
  }
  await repository.cambiarVinculoCarCruds(localCambio('empleado-b', null, 1));
  const token = await login(app);
  const first = await app.inject({ url: base + '/vinculos?page=1&pageSize=1', headers: auth(token) });
  const second = await app.inject({ url: base + '/vinculos?page=2&pageSize=1', headers: auth(token) });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(second.statusCode, 200, second.body);
  assert.equal(first.json().total, 2);
  assert.equal(first.json().items[0].employeeId, 'empleado-a');
  assert.equal(second.json().items[0].employeeId, 'empleado-c');
  const far = await app.inject({ url: base + '/vinculos?page=9007199254740991&pageSize=100', headers: auth(token) });
  assert.equal(far.statusCode, 200, far.body);
  assert.deepEqual(far.json().items, []);
  assert.equal(far.json().total, 2);
  assert.deepEqual(client.calls, []);
});

test('Entradas inválidas y actor o fecha inyectados se rechazan antes de consultar al proveedor', async (t) => {
  const { app, repository, client } = entorno(t);
  const token = await login(app);
  for (const payload of [
    {}, { socioId: 'socio-demo-01' }, { socioId: '', versionEsperada: 0 }, { socioId: '   ', versionEsperada: 0 },
    { socioId: 10, versionEsperada: 0 }, { socioId: 'socio-demo-01', versionEsperada: -1 },
    { socioId: 'socio-demo-01', versionEsperada: 0.5 }, { socioId: 'socio-demo-01', versionEsperada: '0' },
    { socioId: 'socio-demo-01', versionEsperada: 9007199254740992 },
    { socioId: 'socio-demo-01', versionEsperada: 0, administradorId: 'otro-administrador' },
    { socioId: 'socio-demo-01', versionEsperada: 0, fecha: '2020-01-01T00:00:00Z' },
    { socioId: 'socio-demo-01', versionEsperada: 0, extra: true }, [], null,
  ]) {
    const response = await app.inject({ method: 'PUT', url: ruta('empleado-invalido'), headers: auth(token), payload });
    assert.equal(response.statusCode, 400, JSON.stringify(payload) + ': ' + response.body);
  }
  for (const query of ['?page=0', '?pageSize=101', '?page=01', '?page=1&page=2', '?pageSize=20&pageSize=20', '?otro=1']) {
    const response = await app.inject({ url: base + '/vinculos' + query, headers: auth(token) });
    assert.equal(response.statusCode, 400, query + ': ' + response.body);
  }
  for (const suffix of ['', '/historial']) {
    const response = await app.inject({ url: ruta('empleado-invalido') + suffix + '?otro=1', headers: auth(token) });
    assert.equal(response.statusCode, 400, response.body);
  }
  const putQuery = await app.inject({ method: 'PUT', url: ruta('empleado-invalido') + '?version=0', headers: auth(token), payload: { socioId: 'socio-demo-01', versionEsperada: 0 } });
  assert.equal(putQuery.statusCode, 400, putQuery.body);
  for (const payload of [{}, { identificador: '' }, { identificador: '   ' }, { identificador: 1 }, { identificador: '11111111', rol: 'ADMIN' }]) {
    const response = await app.inject({ method: 'POST', url: base + '/socios/buscar', headers: auth(token), payload });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.deepEqual(client.calls, []);
  assert.deepEqual(await repository.getHistorialVinculoCarCruds('empleado-invalido'), []);
});

test('El repositorio en memoria mantiene exclusión uno a uno y versiones ante solicitudes simultáneas', async () => {
  const repository = new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS);
  const sameSocio = await Promise.allSettled([
    repository.cambiarVinculoCarCruds(localCambio('carrera-empleado-a', 'socio-demo-01')),
    repository.cambiarVinculoCarCruds(localCambio('carrera-empleado-b', 'socio-demo-01')),
  ]);
  assert.equal(sameSocio.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(sameSocio.find(({ status }) => status === 'rejected').reason.codigo, 'SOCIO_YA_VINCULADO');
  const sameEmployee = await Promise.allSettled([
    repository.cambiarVinculoCarCruds(localCambio('carrera-mismo-empleado', 'socio-demo-02')),
    repository.cambiarVinculoCarCruds(localCambio('carrera-mismo-empleado', 'socio-demo-03')),
  ]);
  assert.equal(sameEmployee.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(sameEmployee.find(({ status }) => status === 'rejected').reason.codigo, 'VINCULO_DESACTUALIZADO');
  assert.equal((await repository.getHistorialVinculoCarCruds('carrera-mismo-empleado')).length, 1);
});

test('El vínculo Car Cruds es independiente del registro histórico de la capacidad anterior', async () => {
  const repository = new MemorySociosRepository([admin], []);
  const socio = { ...SEED_SOCIOS[0], socioId: 'socio-capacidad-anterior' };
  await repository.registrarEmpleado({
    origen: 'origen-capacidad-anterior', clave: 'alta-anterior', contenido: 'contenido-ficticio-canonico',
    empleado: { empleadoExternoId: 'empleado-anterior', dni: socio.dni, nombre: socio.nombre, email: socio.email },
    socio, respuesta: { socioId: socio.socioId, solicitudId: 'solicitud-anterior', estadoSolicitud: 'PENDIENTE', membresiaHabilitada: false },
  });
  const before = await repository.obtenerSocio(socio.socioId);
  const linked = await repository.cambiarVinculoCarCruds(localCambio('empleado-car-cruds', socio.socioId));
  assert.equal(linked.socioId, socio.socioId);
  assert.deepEqual(await repository.obtenerSocio(socio.socioId), before);
  assert.deepEqual(await repository.obtenerMembresias(socio.socioId), []);
});
