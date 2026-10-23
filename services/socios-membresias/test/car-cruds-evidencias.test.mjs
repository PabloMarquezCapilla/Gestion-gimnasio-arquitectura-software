import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import appModule from '../dist/app.js';
import repoModule from '../dist/repository.js';
import securityModule from '../dist/security.js';
import clientModule from '../dist/clients/car-cruds.client.js';
import serviceModule from '../dist/car-cruds-evidencias.service.js';

const { buildSociosApp } = appModule;
const { MemorySociosRepository, SEED_SOCIOS, SEED_MEMBRESIAS } = repoModule;
const { hashPassword } = securityModule;
const { CarCrudsError, HttpCarCrudsClient } = clientModule;
const base = '/api/v1/integraciones/car-cruds';
const employeeId = 'employee-evidence-ficticio';
const socioId = 'socio-demo-01';
const fecha = '2026-10-23T15:00:00.000Z';
const password = 'clave-ficticia-evidencias';
const admin = { socioId: 'admin-evidencias', dni: '90000321', nombre: 'ADMIN ficticio', email: 'evidencias@example.invalid',
  passwordHash: hashPassword(password), rol: 'ADMIN', estado: 'ACTIVO', createdAt: '2026-01-01T00:00:00.000Z' };
const authConfig = { jwtSecret: 'jwt-ficticio-evidencias-con-mas-de-32-caracteres', internalApiKey: 'servicios-ficticios-evidencia' };
const headers = token => ({ authorization: 'Bearer ' + token });
const ruta = id => base + '/empleados/' + encodeURIComponent(id) + '/fotografias';
const envio = id => base + '/fotografias/' + id + '/enviar';
const preparo = (extra = {}) => ({ period: '2026-10', versionVinculoEsperada: 1, versionAnteriorEsperada: 0, ...extra });

function fixture(t, opts = {}) {
  let ahora = new Date(opts.fecha ?? fecha);
  const clock = () => new Date(ahora);
  const repository = new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS, clock);
  const calls = [];
  const client = {
    async listarEmpleados(page, pageSize) { return { items: [], page, pageSize, total: 0 }; },
    async consultarEstado(id) { return { employeeId: id, active: true }; },
    async enviarEvidencia(payload, context) { calls.push({ payload: structuredClone(payload), context }); return { applied: true }; },
  };
  const actualClient = opts.sinCliente ? undefined : opts.client ?? client;
  const app = buildSociosApp({ ...authConfig, repository, clock, carCrudsClient: actualClient });
  t.after(() => app.close());
  return { app, repository, client, calls, clock, avanzar(ms) { ahora = new Date(+ahora + ms); } };
}
async function token(app, emailOrDni = admin.email, clave = password) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { emailOrDni, password: clave } });
  assert.equal(r.statusCode, 200, r.body); return r.json().token;
}
async function vincular(repository, nuevoSocio = socioId, version = 0) {
  return repository.cambiarVinculoCarCruds({ employeeId, socioId: nuevoSocio, versionEsperada: version, administradorId: admin.socioId, fecha });
}
async function preparar(app, jwt, extra = {}) {
  return app.inject({ method: 'POST', url: ruta(employeeId), headers: headers(jwt), payload: preparo(extra) });
}
async function enviar(app, jwt, id, extra = {}) {
  return app.inject({ method: 'POST', url: envio(id), headers: headers(jwt), payload: { versionVinculoEsperada: 1, ...extra } });
}
async function fotoInicial(f) {
  await vincular(f.repository); const jwt = await token(f.app);
  const r = await preparar(f.app, jwt); assert.equal(r.statusCode, 201, r.body);
  return { jwt, foto: r.json() };
}

test('Fotografías: JWT y rol ADMIN vigente antes de consultar, preparar o enviar', async t => {
  const f = fixture(t); const socioToken = await token(f.app, '11111111', 'socio123');
  for (const op of [
    { url: ruta(employeeId) + '?period=2026-10' },
    { method: 'POST', url: ruta(employeeId), payload: preparo() },
    { method: 'POST', url: envio('00000000-0000-4000-8000-000000000000'), payload: { versionVinculoEsperada: 1 } },
  ]) {
    for (const hdrs of [{}, headers('alterado'), { 'x-service-key': authConfig.internalApiKey }]) {
      const r = await f.app.inject({ ...op, headers: hdrs }); assert.equal(r.statusCode, 401, r.body);
      assert.equal(r.headers['cache-control'], 'no-store');
    }
    const r = await f.app.inject({ ...op, headers: headers(socioToken) }); assert.equal(r.statusCode, 403, r.body);
  }
  const jwt = await token(f.app); const original = f.repository.obtenerSocio.bind(f.repository);
  f.repository.obtenerSocio = id => id === admin.socioId ? Promise.resolve({ ...admin, rol: 'SOCIO' }) : original(id);
  assert.equal((await preparar(f.app, jwt)).statusCode, 403); assert.equal(f.calls.length, 0);
});

test('Vista previa queda guardada con fuente y corte del servidor; solo member demostrable es true', async t => {
  const f = fixture(t); const { jwt, foto } = await fotoInicial(f);
  assert.equal(foto.estado, 'PREPARADA'); assert.equal(foto.intentos, 0); assert.equal(f.calls.length, 0);
  assert.deepEqual(foto.payload, { employeeId, period: '2026-10', sourceReference: foto.payload.sourceReference,
    version: 1, observedAt: fecha, member: true, used: null, costMinor: null, spendingMinor: null });
  assert.equal(foto.administradorId, admin.socioId); assert.equal(foto.socioId, socioId); assert.equal(foto.versionVinculo, 1);
  const history = await f.app.inject({ url: ruta(employeeId) + '?period=2026-10', headers: headers(jwt) });
  assert.deepEqual(history.json().items, [foto]); assert.equal(history.headers['cache-control'], 'no-store');
  assert.ok(!history.body.includes('passwordHash')); assert.ok(!history.body.includes(admin.email));
});

test('La afiliación observada se conserva; pasado sin prueba, suspensión y falta de plan permanecen desconocidos', async t => {
  const f = fixture(t); const { jwt } = await fotoInicial(f);
  const anterior = await preparar(f.app, jwt, { period: '2026-09' }); assert.equal(anterior.statusCode, 201, anterior.body);
  assert.equal(anterior.json().payload.member, null);
  await f.repository.actualizarEstadoMembresia('mem-001', 'SUSPENDIDA');
  const actual = await preparar(f.app, jwt, { versionAnteriorEsperada: 1 });
  assert.equal(actual.json().payload.member, true, 'La primera foto prueba afiliación en un tramo del mes aunque ahora esté suspendida');
  const suspendido = fixture(t);
  await vincular(suspendido.repository, SEED_SOCIOS.find(s => s.dni === '55555555').socioId);
  const jwtSuspendido = await token(suspendido.app);
  const sinPrueba = await preparar(suspendido.app, jwtSuspendido);
  assert.equal(sinPrueba.json().payload.member, null);
  await f.repository.crearSocio({ socioId: 'sin-membresia', dni: '90000322', nombre: 'Ficticio sin plan', email: 'sin-plan@example.invalid', estado: 'ACTIVO', createdAt: fecha });
  await vincular(f.repository, 'sin-membresia', 1);
  const sinPlan = await preparar(f.app, jwt, { versionVinculoEsperada: 2, versionAnteriorEsperada: 2, confirmarCambioVinculo: true });
  assert.equal(sinPlan.statusCode, 201, sinPlan.body); assert.equal(sinPlan.json().payload.member, null);
});

test('El mes se interpreta en Argentina y no se admiten meses futuros ni hechos editados por cliente', async t => {
  const f = fixture(t, { fecha: '2026-11-01T01:30:00.000Z' });
  await vincular(f.repository); const jwt = await token(f.app);
  assert.equal(serviceModule.mesArgentina(f.clock()), '2026-10');
  for (const body of [
    { period: '2026-11' }, { period: '2026-00' }, { period: '0000-01' }, { period: '2026-1' },
    { member: true }, { costMinor: 10 }, { observedAt: fecha }, { sourceReference: 'elegida' },
    { administradorId: 'otro' }, { version: 9 }, { versionAnteriorEsperada: -1 }, { versionVinculoEsperada: '1' },
    { confirmarCambioVinculo: 'true' },
  ]) assert.equal((await preparar(f.app, jwt, body)).statusCode, 400, JSON.stringify(body));
  const r = await f.app.inject({ url: ruta(employeeId) + '?period=2026-10&period=2026-09', headers: headers(jwt) });
  assert.equal(r.statusCode, 400);
  assert.equal((await f.app.inject({ url: ruta(employeeId) + '?period=2026-10&actor=x', headers: headers(jwt) })).statusCode, 400);
  assert.deepEqual(await f.repository.obtenerFotografias(employeeId, '2026-10'), []);
});

test('Sin configuración se preparan y leen fotos locales pero no se consume un intento de envío', async t => {
  const f = fixture(t, { sinCliente: true }); const { jwt, foto } = await fotoInicial(f);
  const r = await enviar(f.app, jwt, foto.fotografiaId); assert.equal(r.statusCode, 503, r.body);
  assert.equal(r.json().codigo, 'CAR_CRUDS_NO_CONFIGURADO');
  const [actual] = await f.repository.obtenerFotografias(employeeId, '2026-10');
  assert.equal(actual.estado, 'PREPARADA'); assert.equal(actual.intentos, 0);
});

test('Enviar utiliza solo el cuerpo guardado y la traza; recibir no altera personas ni membresías', async t => {
  const f = fixture(t); const { jwt, foto } = await fotoInicial(f);
  const before = JSON.stringify(await Promise.all(SEED_SOCIOS.map(async s => [await f.repository.obtenerSocio(s.socioId), await f.repository.obtenerMembresias(s.socioId)])));
  const r = await enviar(f.app, jwt, foto.fotografiaId); assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().estado, 'RECIBIDA'); assert.equal(r.json().applied, true); assert.equal(r.json().intentos, 1);
  assert.deepEqual(f.calls[0].payload, foto.payload); assert.ok(f.calls[0].context.traceId);
  assert.equal(JSON.stringify(await Promise.all(SEED_SOCIOS.map(async s => [await f.repository.obtenerSocio(s.socioId), await f.repository.obtenerMembresias(s.socioId)]))), before);
  const repetido = await enviar(f.app, jwt, foto.fotografiaId); assert.equal(repetido.statusCode, 200); assert.equal(f.calls.length, 1);
  assert.equal((await enviar(f.app, jwt, foto.fotografiaId, { member: false })).statusCode, 400);
});

test('Dos confirmaciones simultáneas solo reclaman un envío; resultado incierto conserva cada dato', async t => {
  const f = fixture(t); const { jwt, foto } = await fotoInicial(f);
  let liberar; const espera = new Promise(resolve => { liberar = resolve; });
  f.client.enviarEvidencia = async p => { f.calls.push({ payload: structuredClone(p) }); await espera; throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_TIEMPO_AGOTADO'); };
  const primero = enviar(f.app, jwt, foto.fotografiaId);
  while (f.calls.length === 0) await new Promise(resolve => setImmediate(resolve));
  const segundo = await enviar(f.app, jwt, foto.fotografiaId);
  assert.equal(segundo.statusCode, 409, segundo.body); assert.equal(segundo.json().codigo, 'CAR_CRUDS_ENVIO_EN_CURSO');
  liberar(); const r = await primero; assert.equal(r.json().estado, 'PENDIENTE'); assert.equal(f.calls.length, 1);
  assert.equal((await preparar(f.app, jwt, { versionAnteriorEsperada: 1 })).json().codigo, 'CAR_CRUDS_ENVIO_PENDIENTE');
  f.avanzar(5000);
  f.client.enviarEvidencia = async p => { f.calls.push({ payload: structuredClone(p) }); return { applied: false }; };
  const reintento = await enviar(f.app, jwt, foto.fotografiaId);
  assert.equal(reintento.json().estado, 'RECIBIDA'); assert.equal(reintento.json().applied, false); assert.equal(reintento.json().intentos, 2);
  assert.deepEqual(f.calls[1].payload, f.calls[0].payload);
});

test('Un conflicto exige revisión y nunca incrementa la versión para eludirlo', async t => {
  const f = fixture(t); const { jwt, foto } = await fotoInicial(f);
  f.client.enviarEvidencia = async () => { throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_CONFLICTO'); };
  let r = await enviar(f.app, jwt, foto.fotografiaId); assert.equal(r.json().estado, 'REQUIERE_REVISION');
  assert.equal((await enviar(f.app, jwt, foto.fotografiaId)).json().codigo, 'CAR_CRUDS_REVISION_REQUERIDA');
  assert.equal((await preparar(f.app, jwt, { versionAnteriorEsperada: 1 })).json().codigo, 'CAR_CRUDS_REVISION_REQUERIDA');
  f.client.enviarEvidencia = async p => { assert.deepEqual(p, foto.payload); return { applied: false }; };
  r = await enviar(f.app, jwt, foto.fotografiaId, { confirmarRevision: true });
  assert.equal(r.json().estado, 'RECIBIDA'); assert.equal(r.json().payload.version, 1);
});

test('Corregir vínculo conserva receipt e historia y exige revisión para la foto siguiente', async t => {
  const f = fixture(t); const { jwt, foto } = await fotoInicial(f);
  await enviar(f.app, jwt, foto.fotografiaId);
  await vincular(f.repository, 'socio-demo-02', 1);
  const noConfirmado = await preparar(f.app, jwt, { versionVinculoEsperada: 2, versionAnteriorEsperada: 1 });
  assert.equal(noConfirmado.json().codigo, 'CAR_CRUDS_REVISION_REQUERIDA');
  const nueva = await preparar(f.app, jwt, { versionVinculoEsperada: 2, versionAnteriorEsperada: 1, confirmarCambioVinculo: true });
  assert.equal(nueva.statusCode, 201, nueva.body); assert.equal(nueva.json().payload.version, 2);
  assert.equal(nueva.json().payload.sourceReference, foto.payload.sourceReference);
  const items = await f.repository.obtenerFotografias(employeeId, '2026-10');
  assert.equal(items[0].estado, 'RECIBIDA'); assert.equal(items[0].applied, true); assert.deepEqual(items[0].payload, foto.payload);
  assert.equal((await enviar(f.app, jwt, foto.fotografiaId, { versionVinculoEsperada: 2 })).statusCode, 409);
});

test('Desvincular impide enviar una pendiente; una corrección revisada puede sustituirla sin borrar historia', async t => {
  const f = fixture(t); const { jwt, foto } = await fotoInicial(f);
  f.client.enviarEvidencia = async () => { throw new Error('detalle privado de red'); };
  const r = await enviar(f.app, jwt, foto.fotografiaId); assert.equal(r.json().estado, 'PENDIENTE'); assert.ok(!r.body.includes('detalle privado'));
  await vincular(f.repository, null, 1);
  assert.equal((await enviar(f.app, jwt, foto.fotografiaId, { versionVinculoEsperada: 2 })).statusCode, 409);
  await vincular(f.repository, 'socio-demo-02', 2);
  const nueva = await preparar(f.app, jwt, { versionVinculoEsperada: 3, versionAnteriorEsperada: 1, confirmarCambioVinculo: true });
  assert.equal(nueva.statusCode, 201, nueva.body);
  const items = await f.repository.obtenerFotografias(employeeId, '2026-10');
  assert.equal(items[0].estado, 'REQUIERE_REVISION'); assert.deepEqual(items[0].payload, foto.payload);
  assert.equal(items[1].payload.version, 2);
});

test('Reinicio tras claim y fallo al guardar receipt se recuperan al vencer el lease con el mismo cuerpo', async t => {
  const f = fixture(t); const { jwt, foto } = await fotoInicial(f);
  const finalizar = f.repository.finalizarFotografia.bind(f.repository); let falla = true;
  f.repository.finalizarFotografia = p => { if (falla) throw new Error('fallo DB privado'); return finalizar(p); };
  const r = await enviar(f.app, jwt, foto.fotografiaId); assert.equal(r.statusCode, 500); assert.ok(!r.body.includes('fallo DB privado'));
  assert.equal((await enviar(f.app, jwt, foto.fotografiaId)).json().codigo, 'CAR_CRUDS_ENVIO_EN_CURSO');
  falla = false; f.avanzar(61_000);
  const reiniciada = buildSociosApp({ ...authConfig, repository: f.repository, clock: f.clock, carCrudsClient: f.client });
  t.after(() => reiniciada.close());
  const jwt2 = await token(reiniciada); const reintento = await enviar(reiniciada, jwt2, foto.fotografiaId);
  assert.equal(reintento.json().estado, 'RECIBIDA'); assert.equal(reintento.json().intentos, 2);
  assert.deepEqual(f.calls[0].payload, f.calls[1].payload);
});

test('Integración HTTP controlada: pérdida de respuesta después de recibir y reenvío idéntico sin duplicar', async t => {
  const recibidos = []; let primerEnvio = true; const guardadas = new Map();
  const proveedor = createServer(async (req, res) => {
    let texto = ''; for await (const chunk of req) texto += chunk;
    assert.equal(req.method, 'POST'); assert.equal(req.url, '/v1/employees/membership-evidence');
    assert.equal(req.headers.authorization, 'Bearer token-ficticio-gym'); assert.equal(req.headers['idempotency-key'], undefined);
    recibidos.push(texto); const p = JSON.parse(texto); const id = p.sourceReference + ':' + p.version;
    const repetida = guardadas.has(id); guardadas.set(id, texto);
    if (primerEnvio) { primerEnvio = false; req.socket.destroy(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ applied: !repetida }));
  });
  await new Promise(resolve => proveedor.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => proveedor.close(resolve)));
  const client = new HttpCarCrudsClient({ baseUrl: 'http://127.0.0.1:' + proveedor.address().port, token: 'token-ficticio-gym', timeoutMs: 1000 });
  const f = fixture(t, { client }); const { jwt, foto } = await fotoInicial(f);
  const perdido = await enviar(f.app, jwt, foto.fotografiaId); assert.equal(perdido.json().estado, 'PENDIENTE');
  assert.equal(recibidos.length, 1, 'POST no se reintenta automáticamente');
  const repetido = await enviar(f.app, jwt, foto.fotografiaId);
  assert.equal(repetido.json().estado, 'RECIBIDA'); assert.equal(repetido.json().applied, false);
  assert.equal(recibidos[0], recibidos[1]); assert.equal(guardadas.size, 1);
});
