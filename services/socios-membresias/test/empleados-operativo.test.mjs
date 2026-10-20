import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import appModule from '../dist/app.js';
import repositoryModule from '../dist/repository.js';

const path = '/api/v1/integraciones/empleados';
const keyA = 'externa-ficticia-grupo-a';
const keyB = 'externa-ficticia-grupo-b';
const credenciales = [{ apiKey: keyA, grupoId: 'origen-a' }, { apiKey: keyB, grupoId: 'origen-b' }];
const employee = { empleadoExternoId: 'empleado-001', dni: '00001001', nombre: 'Persona Ficticia', email: 'ficticia@example.invalid' };
const auth = { jwtSecret: 'secreto-ficticio-operativo-con-mas-de-32-caracteres', internalApiKey: 'interna-ficticia' };
const contract = parse(readFileSync(new URL('../../../docs/contracts/openapi-empleados-v1.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv, { mode: 'full' });
function verify(response, status) {
  assert.equal(response.statusCode, status, response.body);
  let definition = contract.paths[path].post.responses[String(status)];
  if (definition.$ref) definition = definition.$ref.slice(2).split('/').reduce((a, k) => a[k], contract);
  const validate = ajv.compile({ ...definition.content['application/json'].schema, components: contract.components });
  assert.equal(validate(response.json()), true, JSON.stringify(validate.errors));
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-mock'], undefined);
  return response.json();
}
function fixture(t, options = {}) {
  const repository = options.repository ?? new repositoryModule.MemorySociosRepository();
  const app = appModule.buildSociosApp({ ...auth, repository, empleadosCredenciales: credenciales, ...options });
  t.after(() => app.close());
  return { app, repository };
}
function post(app, payload = employee, options = {}) {
  return app.inject({ method: 'POST', url: path, headers: {
    'content-type': options.contentType ?? 'application/json',
    ...(options.apiKey === null ? {} : { 'x-api-key': options.apiKey ?? keyA }),
    ...(options.clave === null ? {} : { 'idempotency-key': options.clave ?? 'alta-001' }),
  }, payload });
}

test('alta operativa cumple contrato, normaliza y crea SOCIO sin contraseña ni membresía', async (t) => {
  const { app, repository } = fixture(t);
  const result = verify(await post(app, { ...employee, dni: ' 00001001 ', email: ' FICTICIA@EXAMPLE.INVALID ' }), 201);
  assert.equal(result.estadoSolicitud, 'PENDIENTE');
  assert.equal(result.membresiaHabilitada, false);
  const socio = await repository.obtenerSocio(result.socioId);
  assert.equal(socio.dni, '00001001');
  assert.equal(socio.email, employee.email);
  assert.equal(socio.rol, 'SOCIO');
  assert.equal(socio.passwordHash, undefined);
  assert.deepEqual(await repository.obtenerMembresias(result.socioId), []);
  const habilitacion = await app.inject({ url: `/api/v1/socios/${result.socioId}/habilitacion`, headers: { 'x-service-key': auth.internalApiKey } });
  assert.equal(habilitacion.json().habilitado, false);
  assert.equal(habilitacion.json().motivo, 'SIN_MEMBRESIA');
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { emailOrDni: socio.email, password: 'cualquier-clave' } });
  assert.equal(login.statusCode, 401);
});

test('replay devuelve los mismos IDs antes de conflictos y respeta normalización/orden JSON', async (t) => {
  const { app } = fixture(t);
  const first = verify(await post(app), 201);
  const replay = verify(await post(app, { email: ' FICTICIA@EXAMPLE.INVALID ', nombre: employee.nombre, dni: employee.dni, empleadoExternoId: employee.empleadoExternoId }), 201);
  assert.deepEqual(replay, first);
  replay.socioId = 'modificado-en-cliente';
  assert.deepEqual(verify(await post(app), 201), first);
  const conflict = verify(await post(app, { ...employee, nombre: 'Otra Persona' }), 409);
  assert.equal(conflict.codigo, 'IDEMPOTENCIA_EN_CONFLICTO');
});

test('conflictos de identidad no sobrescriben ni actualizan socios existentes', async (t) => {
  const { app, repository } = fixture(t);
  const original = verify(await post(app), 201);
  const cases = [
    [{ ...employee, dni: 'otro-dni' }, 'EMPLEADO_EXTERNO_EN_CONFLICTO'],
    [employee, 'DNI_EXISTENTE'],
    [{ ...employee, empleadoExternoId: 'otro-empleado', dni: 'otro-dni' }, 'EMAIL_EXISTENTE'],
    [{ ...employee, empleadoExternoId: 'otro-empleado', dni: '11111111', email: 'nuevo@example.invalid' }, 'DNI_EXISTENTE'],
    [{ ...employee, empleadoExternoId: 'otro-empleado', dni: 'otro-dni', email: 'JUAN.PEREZ@EXAMPLE.COM' }, 'EMAIL_EXISTENTE'],
  ];
  for (const [payload, codigo] of cases) assert.equal(verify(await post(app, payload, { clave: 'otra-clave' }), 409).codigo, codigo);
  assert.equal((await repository.obtenerSocio(original.socioId)).dni, employee.dni);
  assert.deepEqual(verify(await post(app), 201), original);
});

test('origen proviene de la credencial; claves y empleado externo se separan por origen', async (t) => {
  const { app } = fixture(t);
  const first = verify(await post(app), 201);
  const second = verify(await post(app, { ...employee, dni: '00001002', email: 'otra@example.invalid' }, { apiKey: keyB }), 201);
  assert.notEqual(first.socioId, second.socioId);
  assert.equal(verify(await post(app, employee, { apiKey: keyB, clave: 'otra' }), 409).codigo, 'EMPLEADO_EXTERNO_EN_CONFLICTO');
  verify(await post(app, { ...employee, origen: 'origen-b' }, { clave: 'nueva' }), 400);
  const unauth = verify(await post(app, '{', { apiKey: null }), 401);
  assert.equal(unauth.codigo, 'NO_AUTENTICADO');
  assert.equal((await post(app, employee, { apiKey: auth.internalApiKey })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/socios', headers: { 'x-api-key': keyA }, payload: employee })).statusCode, 401);
});

test('valida JSON, contenido, campos y clave según contrato antes de escribir', async (t) => {
  const { app } = fixture(t);
  for (const clave of [null, '', '   ', 'a'.repeat(129)]) verify(await post(app, employee, { clave }), 400);
  for (const payload of ['{', [], {}, { ...employee, rol: 'ADMIN' }, { ...employee, email: 'invalido' }, { ...employee, dni: 1001 }, { ...employee, nombre: ' ' }]) {
    verify(await post(app, payload), 400);
  }
  verify(await post(app, 'texto', { contentType: 'text/plain' }), 415);
  verify(await post(app, employee), 201); // Los errores no consumen la clave.
});

test('reintentos simultáneos no duplican el alta y claves incompatibles no cambian su resultado', async (t) => {
  const { app } = fixture(t);
  const responses = await Promise.all(Array.from({ length: 20 }, () => post(app)));
  const expected = verify(responses[0], 201);
  for (const response of responses) assert.deepEqual(verify(response, 201), expected);
  const conflicts = await Promise.all(Array.from({ length: 8 }, (_, i) => post(app, { ...employee, nombre: 'Distinto ' + i })));
  for (const response of conflicts) assert.equal(verify(response, 409).codigo, 'IDEMPOTENCIA_EN_CONFLICTO');
});

test('fallas de almacenamiento devuelven el error contractual sin filtrar datos; logs conservan traza', async (t) => {
  class BrokenRepository extends repositoryModule.MemorySociosRepository {
    async registrarEmpleado() { throw new Error('error privado con dni y email ficticia@example.invalid'); }
  }
  let logs = '';
  const stream = new Writable({ write(chunk, _encoding, callback) { logs += chunk.toString(); callback(); } });
  const { app } = fixture(t, { repository: new BrokenRepository(), logger: { level: 'info', stream } });
  verify(await post(app), 500);
  assert.ok(!logs.includes(employee.email));
  const success = fixture(t, { logger: { level: 'info', stream } }).app;
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const result = await success.inject({ method: 'POST', url: path, headers: {
    'content-type': 'application/json', 'x-api-key': keyA, 'idempotency-key': 'alta-001',
    traceparent: '00-' + traceId + '-00f067aa0ba902b7-01',
  }, payload: employee });
  verify(result, 201);
  assert.equal(result.headers['x-correlation-id'], traceId);
  const entries = logs.trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(entries.some((entry) => entry.service === 'socios-membresias' && entry.trace_id === traceId && entry.solicitudId === result.json().solicitudId));
  for (const secret of [keyA, employee.email, employee.dni]) assert.ok(!logs.includes(secret));
});
