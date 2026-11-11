// Test de contrato del consumo de FAV: el cliente se ejecuta contra un servidor HTTP
// real que responde con los ejemplos del OpenAPI fijado (catalogo-pedidos 1.2.0).
// Si FAV cambia el contrato de forma incompatible, la validación del cliente lo rechaza.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { FavError, HttpFavCatalogoClient, favCatalogoConfigDesdeEntorno } from '../dist/clients/fav-catalogo.client.js';

const contrato = parse(readFileSync(resolve(import.meta.dirname, '../../../docs/contracts/fav-catalogo-pedidos-1.2.0.openapi.yaml'), 'utf8'));
const ejemplo = contrato.components.examples.Catalogo.value;

async function servidor(t, responder) {
  const recibidas = [];
  const server = createServer((req, res) => {
    recibidas.push({ url: req.url, headers: req.headers });
    responder(req, res, recibidas.length);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: `http://127.0.0.1:${server.address().port}/fav`, recibidas };
}
const json = (res, status, body, type = 'application/json') => { res.writeHead(status, { 'Content-Type': type }); res.end(JSON.stringify(body)); };
const codigo = c => error => error instanceof FavError && error.codigo === c;

test('el contrato fijado conserva las operaciones que consume Tienda', () => {
  assert.equal(contrato.info.version, '1.2.0');
  assert.ok(contrato.paths['/v1/productos'].get);
  assert.equal(contrato.components.securitySchemes.ClaveDeGrupo.name, 'X-API-Key');
  assert.deepEqual(contrato.components.schemas.Variante.required, ['varianteId', 'talle', 'color', 'precio']);
});

test('consume el ejemplo del contrato enviando la clave, traceparent y correlación', async (t) => {
  const { url, recibidas } = await servidor(t, (_req, res) => json(res, 200, ejemplo));
  const client = new HttpFavCatalogoClient({ baseUrl: url, apiKey: 'clave-ficticia' });
  const traceparent = '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01';
  const productos = await client.listarProductos({ traceparent, correlationId: 'corr-1' });
  assert.equal(productos.length, ejemplo.items.length);
  assert.deepEqual(productos[0].variantes[0], { varianteId: 'var-remera-basica-blanca-m', talle: 'M', color: 'Blanco', precio: 15000 });
  assert.equal(productos[1].fotoUrl, undefined);
  assert.equal(recibidas[0].url, '/fav/v1/productos');
  assert.equal(recibidas[0].headers['x-api-key'], 'clave-ficticia');
  assert.equal(recibidas[0].headers.traceparent, traceparent);
  assert.equal(recibidas[0].headers['x-correlation-id'], 'corr-1');
});

test('detecta cambios incompatibles del proveedor', async (t) => {
  const roto = [
    { productos: ejemplo.items },
    { items: [{ ...ejemplo.items[0], variantes: [] }] },
    { items: [{ ...ejemplo.items[0], variantes: [{ varianteId: 'v', talle: 'M', color: 'x', precio: '15000' }] }] },
    { items: [{ ...ejemplo.items[0], nombre: undefined }] },
    { items: [{ ...ejemplo.items[0], variantes: [{ varianteId: 'v', talle: 'M', color: 'x', precio: -1 }] }] },
    { items: [ejemplo.items[0], ejemplo.items[0]] },
  ];
  for (const body of roto) {
    const { url } = await servidor(t, (_req, res) => json(res, 200, body));
    await assert.rejects(new HttpFavCatalogoClient({ baseUrl: url, apiKey: 'k' }).listarProductos(), codigo('FAV_RESPUESTA_INVALIDA'));
  }
  const { url } = await servidor(t, (_req, res) => json(res, 200, ejemplo, 'text/html'));
  await assert.rejects(new HttpFavCatalogoClient({ baseUrl: url, apiKey: 'k' }).listarProductos(), codigo('FAV_RESPUESTA_INVALIDA'));
});

test('reintenta una vez ante 503 y no reintenta credenciales rechazadas', async (t) => {
  const recuperado = await servidor(t, (_req, res, n) => n === 1
    ? json(res, 503, { codigo: 'NO_DISPONIBLE' }, 'application/problem+json') : json(res, 200, ejemplo));
  assert.equal((await new HttpFavCatalogoClient({ baseUrl: recuperado.url, apiKey: 'k' }).listarProductos()).length, 2);
  assert.equal(recuperado.recibidas.length, 2);

  const caido = await servidor(t, (_req, res) => json(res, 503, { codigo: 'NO_DISPONIBLE' }, 'application/problem+json'));
  await assert.rejects(new HttpFavCatalogoClient({ baseUrl: caido.url, apiKey: 'k' }).listarProductos(), codigo('FAV_NO_DISPONIBLE'));
  assert.equal(caido.recibidas.length, 2);

  const rechazo = await servidor(t, (_req, res) => json(res, 401, { codigo: 'NO_AUTENTICADO' }, 'application/problem+json'));
  await assert.rejects(new HttpFavCatalogoClient({ baseUrl: rechazo.url, apiKey: 'k' }).listarProductos(), error => {
    assert.ok(codigo('FAV_CREDENCIAL_RECHAZADA')(error));
    assert.equal(error.esIndisponibilidad, false);
    return true;
  });
  assert.equal(rechazo.recibidas.length, 1);
});

test('respeta el presupuesto total de tiempo', async (t) => {
  const { url } = await servidor(t, () => { /* nunca responde */ });
  const inicio = performance.now();
  await assert.rejects(new HttpFavCatalogoClient({ baseUrl: url, apiKey: 'k', timeoutMs: 150 }).listarProductos(), codigo('FAV_TIEMPO_AGOTADO'));
  assert.ok(performance.now() - inicio < 1000);
});

test('configuración desde el entorno: vacía es "no configurado", parcial es error', () => {
  assert.equal(favCatalogoConfigDesdeEntorno({}), undefined);
  assert.throws(() => favCatalogoConfigDesdeEntorno({ FAV_CATALOGO_BASE_URL: 'http://fav' }), /conjuntamente/);
  assert.throws(() => favCatalogoConfigDesdeEntorno({ FAV_CATALOGO_BASE_URL: 'ftp://fav', FAV_CATALOGO_API_KEY: 'k' }), /HTTP/);
  assert.throws(() => favCatalogoConfigDesdeEntorno({ FAV_CATALOGO_BASE_URL: 'http://fav', FAV_CATALOGO_API_KEY: 'k', FAV_CATALOGO_TIMEOUT_MS: '0' }));
  assert.deepEqual(favCatalogoConfigDesdeEntorno({ FAV_CATALOGO_BASE_URL: 'http://fav/api', FAV_CATALOGO_API_KEY: 'k' }),
    { baseUrl: 'http://fav/api/', apiKey: 'k', timeoutMs: 3000 });
});

test('consulta disponibilidad para las variantes solicitadas y valida la respuesta', async (t) => {
  const ids = ['var-remera-basica-blanca-m', 'var-jean-mom-celeste-38'];
  const items = ids.map((varianteId, disponible) => ({ varianteId, disponible }));
  const { url, recibidas } = await servidor(t, (_req, res, intento) =>
    json(res, 200, { items: intento === 1 ? items : [items[0]] }));
  const client = new HttpFavCatalogoClient({ baseUrl: url, apiKey: 'clave-ficticia' });
  assert.deepEqual(await client.consultarDisponibilidad([...ids, ids[0]]), items);
  const consulta = new URL(recibidas[0].url, url);
  assert.equal(consulta.pathname, '/fav/v1/disponibilidad');
  assert.equal(consulta.searchParams.get('variantes'), ids.join(','));
  assert.equal(recibidas[0].headers['x-api-key'], 'clave-ficticia');
  await assert.rejects(client.consultarDisponibilidad(ids), codigo('FAV_RESPUESTA_INVALIDA'));
});
