import assert from 'node:assert/strict';
import test from 'node:test';
import tiendaModule from '../dist/app.js';
import sociosModule from '../../socios-membresias/dist/app.js';

const secret = 'clave-ficticia-tienda-de-pruebas-de-mas-de-32-caracteres';
const current = new Date('2026-10-19T12:00:00.000Z');
const clock = () => current;
const path = '/api/v1/tienda/productos';
async function fixture(t) {
  const app = tiendaModule.buildTiendaApp({ jwtSecret: secret, clock });
  t.after(() => app.close());
  await app.ready();
  return app;
}
function token(app, changes = {}) {
  const iat = current.getTime() / 1000;
  return app.jwt.sign({ sub: 'socio-ficticio', rol: 'SOCIO', iss: 'gimnasio', aud: 'gimnasio-web', iat, exp: iat + 3600, ...changes });
}

test('salud identifica estructura sin afirmar disponibilidad del proveedor', async (t) => {
  const app = await fixture(t);
  const health = await app.inject('/health');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { servicio: 'tienda', estado: 'estructura', integracion: 'PENDIENTE_CONTRATO', persistencia: 'ninguna' });
});

test('exige JWT válido y vigente; ni clave externa ni técnica autorizan Tienda', async (t) => {
  const app = await fixture(t);
  const iat = current.getTime() / 1000;
  for (const headers of [{}, { 'x-api-key': 'externa-ficticia' }, { 'x-service-key': 'interna-ficticia' },
    ...[token(app, { exp: iat }), token(app, { iss: 'otro' }), token(app, { aud: 'otra' }),
      token(app, { rol: ['SOCIO'] }), token(app, { rol: 'DESCONOCIDO' }), token(app) + 'alterado']
      .map(value => ({ authorization: 'Bearer ' + value }))]) {
    const response = await app.inject({ url: path, headers });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().codigo, 'NO_AUTENTICADO');
    assert.equal(response.headers['www-authenticate'], 'Bearer');
  }
});

test('Socios emite una sesión que Tienda acepta sin consultas externas ni catálogo ficticio', async (t) => {
  const app = await fixture(t);
  const socios = sociosModule.buildSociosApp({ jwtSecret: secret, internalApiKey: 'interna-ficticia', clock });
  t.after(() => socios.close());
  const login = await socios.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { emailOrDni: '11111111', password: 'socio123' } });
  assert.equal(login.statusCode, 200);
  const savedFetch = globalThis.fetch;
  let externalCalls = 0;
  globalThis.fetch = async () => { externalCalls++; throw new Error('No debe invocarse un proveedor sin contrato'); };
  try {
    for (const jwt of [login.json().token, token(app, { rol: 'ADMIN' })]) {
      const result = await app.inject({ url: path, headers: { authorization: 'Bearer ' + jwt } });
      assert.equal(result.statusCode, 503);
      assert.equal(result.headers['cache-control'], 'no-store');
      assert.deepEqual(Object.keys(result.json()).sort(), ['codigo', 'mensaje']);
      assert.equal(result.json().codigo, 'INTEGRACION_PENDIENTE');
      assert.equal(result.json().items, undefined);
      assert.equal(result.json().stock, undefined);
    }
    assert.equal(externalCalls, 0);
  } finally { globalThis.fetch = savedFetch; }
});

test('la configuración de autenticación inválida impide iniciar la estructura', () => {
  assert.throws(() => tiendaModule.buildTiendaApp({ jwtSecret: 'corta' }), /AUTH_JWT_SECRET/);
  assert.throws(() => tiendaModule.buildTiendaApp({ jwtSecret: secret, jwtTtlSeconds: 0 }), /AUTH_JWT_TTL_SECONDS/);
});
