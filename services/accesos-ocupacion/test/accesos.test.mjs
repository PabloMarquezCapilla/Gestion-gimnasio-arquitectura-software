import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import domain from '../dist/domain.js';
import http from '../dist/app.js';
import client from '../dist/socios.client.js';

const secret = 'clave-ficticia-de-pruebas-accesos-'.repeat(2);
const now = new Date('2026-10-30T12:00:00Z');
function fixture(t, patch = {}) {
  const repository = {
    salud: async () => {}, sedes: async () => [{ sedeId: 'sede-1', nombre: 'Sede ficticia' }],
    existeSede: async id => id === 'sede-1', repeticion: async () => null,
    registrar: async op => ({ movimiento: { movimientoId: 'mov-1', ...op, fecha: now.toISOString(), aceptado: true, codigo: 'INGRESO_REGISTRADO' } }),
    ocupacion: async () => 2, historial: async () => [], ...patch,
  };
  const socios = { verificar: async () => ({ habilitado: true }) };
  const app = http.buildAccesosApp({ repository, socios, jwtSecret: secret, clock: () => now });
  t.after(() => app.close());
  return { app, repository, socios };
}
async function headers(app, rol = 'ADMIN', extra = {}) {
  await app.ready();
  return { authorization: 'Bearer ' + app.jwt.sign({ sub: 'actor-1', rol, iss: 'gimnasio', aud: 'gimnasio-web',
    iat: now.getTime() / 1000, exp: now.getTime() / 1000 + 3600, ...extra }), 'idempotency-key': 'clave-ficticia-001' };
}
const body = { sedeId: 'sede-1', socioId: 'socio-1', tipo: 'INGRESO' };

test('Reglas de alternancia: habilitación, ingreso repetido y egreso independiente', () => {
  assert.equal(domain.decidir('INGRESO', false, { habilitado: true }), 'INGRESO_REGISTRADO');
  assert.equal(domain.decidir('INGRESO', true, { habilitado: true }), 'INGRESO_YA_ABIERTO');
  assert.equal(domain.decidir('INGRESO', false, { habilitado: false }), 'MEMBRESIA_NO_HABILITADA');
  assert.throws(() => domain.decidir('INGRESO', false, null), { codigo: 'SOCIOS_NO_DISPONIBLE' });
  assert.equal(domain.decidir('EGRESO', true, null), 'EGRESO_REGISTRADO');
  assert.equal(domain.decidir('EGRESO', false, null), 'SIN_INGRESO_ABIERTO');
});
test('API de recepción exige ADMIN incluso al cambiar IDs y URLs', async t => {
  const { app } = fixture(t);
  for (const url of ['/api/v1/accesos/sedes', '/api/v1/accesos/movimientos?sedeId=sede-1', '/api/v1/accesos/sedes/sede-1/ocupacion']) {
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: await headers(app, 'SOCIO') })).statusCode, 403);
    assert.equal((await app.inject({ url, headers: { 'x-service-key': secret } })).statusCode, 401);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accesos/movimientos', payload: body, headers: await headers(app, 'SOCIO') })).statusCode, 403);
});
test('JWT inválido, vencido, futuro o de otro emisor no autoriza', async t => {
  const { app } = fixture(t);
  for (const extra of [{ exp: now.getTime() / 1000 - 1 }, { iat: now.getTime() / 1000 + 60 }, { iss: 'otro' }, { aud: 'otra' }]) {
    assert.equal((await app.inject({ url: '/api/v1/accesos/sedes', headers: await headers(app, 'ADMIN', extra) })).statusCode, 401);
  }
  assert.equal((await app.inject({ url: '/api/v1/accesos/sedes', headers: { authorization: 'Bearer alterado' } })).statusCode, 401);
});
test('API rechaza campos adicionales, operadores Mongo y claves inválidas antes de escribir', async t => {
  let writes = 0; const { app } = fixture(t, { registrar: async () => { writes++; } });
  for (const payload of [{ ...body, actorId: 'ajeno' }, { ...body, socioId: { $ne: null } }, { ...body, tipo: 'OTRO' }, { ...body, tipo: ['INGRESO'] }, {}, null]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accesos/movimientos', headers: await headers(app), payload })).statusCode, 400);
  }
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accesos/movimientos', headers: { authorization: (await headers(app)).authorization }, payload: body })).statusCode, 400);
  assert.equal(writes, 0);
});
test('Sede inexistente, historial y paginación inválida', async t => {
  const { app } = fixture(t); const h = await headers(app);
  assert.equal((await app.inject({ url: '/api/v1/accesos/sedes/ausente/ocupacion', headers: h })).statusCode, 404);
  for (const query of ['pagina=0', 'pagina=1.5', 'tamanio=101', 'socioId[$ne]=x', 'pagina=1&pagina=2']) {
    assert.equal((await app.inject({ url: '/api/v1/accesos/movimientos?sedeId=sede-1&' + query, headers: h })).statusCode, 400);
  }
  assert.equal((await app.inject({ url: '/api/v1/accesos/movimientos?sedeId=sede-1', headers: h })).statusCode, 200);
});
test('No inventa ingresos cuando Socios falla y no consulta Socios para egresos ni replay', async t => {
  const { app, socios, repository } = fixture(t);
  socios.verificar = async () => { throw new domain.AccesosError(503, 'SOCIOS_NO_DISPONIBLE', 'Indisponible'); };
  const h = await headers(app);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accesos/movimientos', payload: body, headers: h })).statusCode, 503);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accesos/movimientos', payload: { ...body, tipo: 'EGRESO' }, headers: h })).statusCode, 201);
  repository.repeticion = async () => ({ movimiento: { aceptado: true, codigo: 'INGRESO_REGISTRADO' } });
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/accesos/movimientos', payload: body, headers: h })).statusCode, 201);
});
test('Errores inesperados y salud no exponen datos internos; métricas y correlación', async t => {
  const { app } = fixture(t, { salud: async () => { throw new Error('uri-secreta'); }, ocupacion: async () => { throw new Error('dato-privado'); } });
  assert.equal((await app.inject('/health')).statusCode, 503);
  const r = await app.inject({ url: '/api/v1/accesos/sedes/sede-1/ocupacion', headers: { ...await headers(app), traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01' } });
  assert.equal(r.statusCode, 500); assert.equal(r.body.includes('dato-privado'), false);
  assert.equal(r.headers['x-correlation-id'], 'a'.repeat(32));
  assert.match((await app.inject('/metrics')).body, /http_errors_total.* 2/);
});

async function server(t, handler) {
  const s = createServer(handler); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); }));
  return 'http://127.0.0.1:' + s.address().port;
}
test('Cliente Socios valida identidad, habilitación y vigencia; propaga contexto', async t => {
  let state = 0;
  const url = await server(t, (req, res) => {
    assert.equal(req.headers['x-service-key'], 'tecnica-ficticia'); assert.match(req.headers.traceparent, /^00-a{32}-b{16}-01$/);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ socioId: state === 1 ? 'otro' : 'socio-1', habilitado: state !== 2,
      ...(state === 3 ? {} : { membresia: { membresiaId: 'm-1', estado: 'HABILITADA', fechaInicio: '2026-01-01', fechaFin: '2027-01-01' } }) }));
  });
  const c = new client.HttpSociosClient(url, 'tecnica-ficticia', 500);
  const trace = { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: '01' };
  assert.equal((await c.verificar('socio-1', now.toISOString(), trace)).habilitado, true);
  state = 1; await assert.rejects(c.verificar('socio-1', now.toISOString(), trace), { codigo: 'SOCIOS_NO_DISPONIBLE' });
  state = 2; assert.equal((await c.verificar('socio-1', now.toISOString(), trace)).habilitado, false);
  state = 3; await assert.rejects(c.verificar('socio-1', now.toISOString(), trace), { codigo: 'SOCIOS_NO_DISPONIBLE' });
});
test('Cliente Socios limita timeout también con cuerpo abierto y reintenta solo GET transitorio', async t => {
  let calls = 0;
  const url = await server(t, (_req, res) => { calls++; res.writeHead(calls === 1 ? 503 : 200, { 'content-type': 'application/json' }); if (calls === 1) res.end('{}'); else res.write('{'); });
  const start = performance.now();
  await assert.rejects(new client.HttpSociosClient(url, 'ficticia', 250).verificar('socio-1', now.toISOString()), { codigo: 'SOCIOS_NO_DISPONIBLE' });
  assert.equal(calls, 2); assert.ok(performance.now() - start < 1200);
});
test('Gateway integra Accesos sin retry de POST ni exposición de clave técnica', async () => {
  const conf = await readFile(new URL('../../../infra/gateway/nginx.conf', import.meta.url), 'utf8');
  assert.match(conf, /location \/api\/v1\/accesos\/\s*\{[^}]*proxy_next_upstream off;[^}]*proxy_pass http:\/\/accesos_backend;/);
  assert.match(conf, /proxy_set_header X-Service-Key "";/);
  assert.match(conf, /location = \/metrics\/accesos/);
});
