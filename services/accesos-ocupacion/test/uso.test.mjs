import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from '../dist/app.js';

const secret = 'clave-ficticia-de-pruebas-accesos-'.repeat(2);
const serviceKey = 'clave-tecnica-ficticia';
function fixture(t, huboIngreso = async () => true) {
  const consultas = [];
  const repository = {
    salud: async () => {}, sedes: async () => [], existeSede: async () => true, repeticion: async () => null,
    registrar: async () => { throw new Error('no usado'); }, ocupacion: async () => 0, historial: async () => [],
    huboIngreso: async (...args) => { consultas.push(args); return huboIngreso(...args); },
  };
  const app = http.buildAccesosApp({ repository, socios: { verificar: async () => ({ habilitado: true }) }, jwtSecret: secret, serviceKey });
  t.after(() => app.close());
  return { app, consultas };
}
const url = '/internal/v1/accesos/uso?socioId=socio-1&desde=2026-11-01T03:00:00Z&hasta=2026-12-01T03:00:00.000Z';

test('uso interno exige la clave técnica, no un JWT', async t => {
  const { app, consultas } = fixture(t);
  for (const headers of [{}, { 'x-service-key': 'otra' }, { authorization: 'Bearer cualquiera' }]) {
    const r = await app.inject({ url, headers });
    assert.equal(r.statusCode, 401);
  }
  assert.equal(consultas.length, 0);
});

test('uso interno normaliza el rango y responde si hubo un ingreso aceptado', async t => {
  const { app, consultas } = fixture(t, async () => false);
  const r = await app.inject({ url, headers: { 'x-service-key': serviceKey } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { socioId: 'socio-1', desde: '2026-11-01T03:00:00.000Z', hasta: '2026-12-01T03:00:00.000Z', huboIngreso: false });
  assert.deepEqual(consultas, [['socio-1', '2026-11-01T03:00:00.000Z', '2026-12-01T03:00:00.000Z']]);
});

test('uso interno rechaza rangos y parámetros inválidos', async t => {
  const { app, consultas } = fixture(t);
  for (const q of ['socioId=socio-1&desde=2026-11-01&hasta=2026-12-01T03:00:00Z',
    'socioId=socio-1&desde=2026-12-01T03:00:00Z&hasta=2026-11-01T03:00:00Z',
    'socioId=../x&desde=2026-11-01T03:00:00Z&hasta=2026-12-01T03:00:00Z',
    'socioId=socio-1&desde=2026-11-01T03:00:00Z&hasta=2026-12-01T03:00:00Z&sedeId=s']) {
    const r = await app.inject({ url: '/internal/v1/accesos/uso?' + q, headers: { 'x-service-key': serviceKey } });
    assert.equal(r.statusCode, 400, q);
  }
  assert.equal(consultas.length, 0);
});

test('sin clave técnica configurada el uso interno no se habilita', async t => {
  const repository = { salud: async () => {}, huboIngreso: async () => true };
  const app = http.buildAccesosApp({ repository, socios: {}, jwtSecret: secret });
  t.after(() => app.close());
  assert.equal((await app.inject({ url, headers: { 'x-service-key': '' } })).statusCode, 401);
});
