import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import appModule from '../services/tienda/dist/app.js';
import repositoryModule from '../services/tienda/dist/stock.postgres.js';
import catalogoModule from '../services/tienda/dist/catalogo.js';
import { postgresTiendaPrueba } from './tienda/entorno.mjs';

// Compras de socios contra PostgreSQL real y dos instancias de Tienda. El catálogo de FAV
// se reemplaza por el ejemplo de su contrato fijado: la prueba no sale a la red.
test('Tienda: compras de socios concurrentes, idempotentes y validadas contra el contrato', { timeout: 180000 }, async t => {
  const contrato = parse(await readFile(new URL('../docs/contracts/openapi-tienda-socios-v1.yaml', import.meta.url), 'utf8'));
  const fav = parse(await readFile(new URL('../docs/contracts/fav-catalogo-pedidos-1.2.0.openapi.yaml', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv, { mode: 'full' });
  const esquema = (ruta, metodo, status) => {
    const respuesta = contrato.paths[ruta][metodo].responses[status];
    const definicion = respuesta.$ref ? respuesta.$ref.slice(2).split('/').reduce((o, p) => o[p], contrato) : respuesta;
    return ajv.compile({ ...definicion.content['application/json'].schema, components: contrato.components });
  };
  const validarCompra = esquema('/api/v1/tienda/compras', 'post', '201');
  const validarConflicto = esquema('/api/v1/tienda/compras', 'post', '409');
  const validarCatalogo = esquema('/api/v1/tienda/productos', 'get', '200');
  const validarMias = esquema('/api/v1/tienda/compras', 'get', '200');

  const environment = await postgresTiendaPrueba();
  const apps = [];
  t.after(async () => { await Promise.all(apps.map(app => app.close())); await environment.close(); });
  const jwtSecret = 'secreto-sintetico-tienda-integracion-'.repeat(2);
  const favApiKey = 'credencial-fav-de-prueba-' + randomUUID();
  const ejemplo = fav.components.examples.Catalogo.value.items;

  async function start() {
    const repository = new repositoryModule.PostgresTiendaStockRepository(environment.pool());
    await repository.inicializarEsquema();
    const catalogo = new catalogoModule.CatalogoFavService({ listarProductos: async () => structuredClone(ejemplo) });
    const app = appModule.buildTiendaApp({ jwtSecret, favApiKey, stockRepository: repository, catalogo });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    return { app, url: 'http://127.0.0.1:' + app.server.address().port };
  }
  const token = (app, sub) => {
    const iat = Math.floor(Date.now() / 1000);
    return 'Bearer ' + app.jwt.sign({ sub, rol: 'SOCIO', iss: 'gimnasio', aud: 'gimnasio-web', iat, exp: iat + 3600 });
  };
  async function http(base, ruta, { method = 'GET', auth, key, body, headers = {} } = {}) {
    const response = await fetch(base + ruta, { method, signal: AbortSignal.timeout(15000), headers: {
      Connection: 'close', ...headers, ...(auth ? { Authorization: auth } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const reponer = (base, productoCodigo, unidades) => http(base, '/api/v1/consignaciones/reposiciones', { method: 'POST',
    headers: { 'X-API-Key': favApiKey }, key: randomUUID(), body: { proveedorId: 'fav', productoCodigo, unidades, referencia: randomUUID() } });

  const a = await start(), b = await start();
  assert.equal((await reponer(a.url, 'var-remera-basica-blanca-m', 1)).status, 201);
  assert.equal((await reponer(a.url, 'var-jean-mom-celeste-38', 4)).status, 201);

  await t.test('el catálogo publicado cumple el contrato de socios', async () => {
    const res = await http(b.url, '/api/v1/tienda/productos', { auth: token(b.app, 'socio-0') });
    assert.equal(res.status, 200);
    assert.ok(validarCatalogo(res.body), JSON.stringify(validarCatalogo.errors));
    assert.equal(res.body.total, 2);
  });

  await t.test('diez socios compiten por la última remera: exactamente una compra gana', async () => {
    const intentos = await Promise.all(Array.from({ length: 10 }, (_, i) => {
      const nodo = i % 2 ? a : b;
      return http(nodo.url, '/api/v1/tienda/compras', { method: 'POST', auth: token(nodo.app, 'socio-' + i), key: randomUUID(),
        body: { items: [{ productoCodigo: 'var-remera-basica-blanca-m', unidades: 1 }] } });
    }));
    const ganadoras = intentos.filter(r => r.status === 201);
    assert.equal(ganadoras.length, 1);
    assert.ok(validarCompra(ganadoras[0].body), JSON.stringify(validarCompra.errors));
    for (const r of intentos.filter(r => r.status !== 201)) {
      assert.equal(r.status, 409);
      assert.equal(r.body.codigo, 'STOCK_INSUFICIENTE');
      assert.ok(validarConflicto(r.body));
    }
    const stock = await http(a.url, '/api/v1/consignaciones/stock?proveedorId=fav', { headers: { 'X-API-Key': favApiKey } });
    assert.deepEqual(stock.body.items.find(i => i.productoCodigo === 'var-remera-basica-blanca-m'),
      { productoCodigo: 'var-remera-basica-blanca-m', unidadesDisponibles: 0, unidadesVendidas: 1 });
  });

  await t.test('el mismo reintento en ambas instancias registra una sola compra; todo o nada', async () => {
    const key = randomUUID();
    const body = { items: [{ productoCodigo: 'var-jean-mom-celeste-38', unidades: 2 }] };
    const [r1, r2] = await Promise.all([a, b].map(n => http(n.url, '/api/v1/tienda/compras', { method: 'POST', auth: token(n.app, 'socio-x'), key, body })));
    assert.equal(r1.status, 201);
    assert.deepEqual(r2.body, r1.body);
    assert.equal(r1.body.totalMinor, 2 * 4200000);
    // Una variante sin stock hace fallar la compra entera sin descontar la otra.
    const mixta = await http(a.url, '/api/v1/tienda/compras', { method: 'POST', auth: token(a.app, 'socio-x'), key: randomUUID(),
      body: { items: [{ productoCodigo: 'var-jean-mom-celeste-38', unidades: 1 }, { productoCodigo: 'var-remera-basica-blanca-m', unidades: 1 }] } });
    assert.equal(mixta.body.codigo, 'STOCK_INSUFICIENTE');
    const stock = await http(b.url, '/api/v1/consignaciones/stock?proveedorId=fav', { headers: { 'X-API-Key': favApiKey } });
    assert.equal(stock.body.items.find(i => i.productoCodigo === 'var-jean-mom-celeste-38').unidadesDisponibles, 2);
    const mias = await http(b.url, '/api/v1/tienda/compras', { auth: token(b.app, 'socio-x') });
    assert.ok(validarMias(mias.body), JSON.stringify(validarMias.errors));
    assert.equal(mias.body.total, 1);
  });
});
