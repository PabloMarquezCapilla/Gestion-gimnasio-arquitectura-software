import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import appModule from '../services/tienda/dist/app.js';
import repositoryModule from '../services/tienda/dist/stock.postgres.js';
import { postgresTiendaPrueba } from './tienda/entorno.mjs';

// Prueba HTTP y PostgreSQL reales. No accede a FAV ni a los datos del entorno local.
test('Tienda: PostgreSQL real, contrato FAV y movimientos entre dos instancias', { timeout: 180000 }, async t => {
  const contract = parse(await readFile(new URL('../docs/contracts/openapi-fav-v1.yaml', import.meta.url), 'utf8'));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv, { mode: 'full' });
  const validators = new Map();
  const environment = await postgresTiendaPrueba();
  const apps = [];
  const jwtSecret = 'secreto-sintetico-tienda-integracion-'.repeat(2);
  const favApiKey = 'credencial-fav-exclusiva-de-prueba-' + randomUUID();
  const stockPath = '/api/v1/consignaciones/stock?proveedorId=fav';
  const receiptPath = '/api/v1/consignaciones/reposiciones';
  const salesPath = '/api/v1/tienda/ventas';
  const adminStockPath = '/api/v1/tienda/stock';

  const resolve = value => value?.$ref
    ? value.$ref.slice(2).split('/').reduce((object, part) => object[part], contract)
    : value;

  async function request(base, route, { method = 'GET', apiKey, token, key, body, rawBody, contentType } = {}) {
    const response = await fetch(base + route, {
      method,
      headers: {
        Connection: 'close',
        ...(apiKey !== undefined ? { 'X-API-Key': apiKey } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(key !== undefined ? { 'Idempotency-Key': key } : {}),
        ...(contentType ? { 'Content-Type': contentType } : body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(rawBody !== undefined ? { body: rawBody } : body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000),
    });
    assert.match(response.headers.get('content-type') ?? '', /^application\/json(?:;|$)/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    const operation = contract.paths[new URL(base + route).pathname]?.[method.toLowerCase()];
    if (operation) {
      const definition = resolve(operation.responses[String(response.status)]);
      assert.ok(definition, 'Respuesta externa no declarada: HTTP ' + response.status);
      const schema = definition.content?.['application/json']?.schema;
      assert.ok(schema, 'Falta esquema de respuesta externa.');
      const cacheKey = route.split('?')[0] + ':' + method + ':' + response.status;
      if (!validators.has(cacheKey)) validators.set(cacheKey, ajv.compile({ ...schema, components: contract.components }));
      const validate = validators.get(cacheKey);
      assert.ok(validate(data), JSON.stringify(validate.errors));
    }
    return { status: response.status, body: data };
  }

  async function start(pool) {
    const repository = new repositoryModule.PostgresTiendaStockRepository(pool);
    await repository.inicializarEsquema();
    const app = appModule.buildTiendaApp({ jwtSecret, favApiKey, stockRepository: repository });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    return { app, repository, url: 'http://127.0.0.1:' + app.server.address().port };
  }

  function token(app, rol = 'ADMIN', sub = 'admin-tienda-sintetico') {
    const iat = Math.floor(Date.now() / 1000);
    return app.jwt.sign({ sub, rol, iss: 'gimnasio', aud: 'gimnasio-web', iat, exp: iat + 3600 });
  }

  const receipt = (productoCodigo, unidades, referencia = randomUUID()) => ({ proveedorId: 'fav', productoCodigo, unidades, referencia });
  const expectedStock = (productoCodigo, unidadesDisponibles, unidadesVendidas) => ({ productoCodigo, unidadesDisponibles, unidadesVendidas });
  let a, b, original, originalKey, originalReceipt, adminToken;

  try {
    const poolA = environment.pool(), poolB = environment.pool();
    [a, b] = await Promise.all([start(poolA), start(poolB)]);
    adminToken = token(a.app);
    const restock = (body, key = randomUUID(), base = a.url) => request(base, receiptPath, { method: 'POST', apiKey: favApiKey, key, body });
    const stock = async (base = a.url) => {
      const response = await request(base, stockPath, { apiKey: favApiKey });
      assert.equal(response.status, 200);
      return response.body;
    };
    const item = async code => (await stock()).items.find(value => value.productoCodigo === code);
    const sell = (productoCodigo, unidades, key = randomUUID(), base = a.url, who = adminToken) =>
      request(base, salesPath, { method: 'POST', token: who, key, body: { productoCodigo, unidades } });

    await t.test('Autenticación de proveedor y ADMIN separada, antes de interpretar JSON', async () => {
      for (const options of [{}, { apiKey: 'incorrecta' }, { token: adminToken }]) {
        const response = await request(a.url, stockPath, options);
        assert.equal(response.status, 401);
        assert.equal(response.body.codigo, 'NO_AUTENTICADO');
      }
      const malformed = await request(a.url, receiptPath, { method: 'POST', rawBody: '{', contentType: 'application/json' });
      assert.equal(malformed.status, 401);
      for (const route of [adminStockPath, salesPath]) {
        const method = route === salesPath ? 'POST' : 'GET';
        assert.equal((await request(a.url, route, { method, apiKey: favApiKey })).status, 401);
        assert.equal((await request(a.url, route, { method, token: token(a.app, 'SOCIO'), ...(method === 'POST' ? { body: { productoCodigo: 'var-sintetica', unidades: 1 }, key: randomUUID() } : {}) })).status, 403);
      }
      assert.equal((await request(a.url, salesPath, { method: 'POST', rawBody: '{', contentType: 'application/json' })).status, 401);
    });

    await t.test('Base nueva responde vacía y ADMIN consulta el mismo stock local', async () => {
      assert.deepEqual(await stock(), { proveedorId: 'fav', items: [] });
      const admin = await request(a.url, adminStockPath, { token: adminToken });
      assert.equal(admin.status, 200);
      assert.deepEqual(admin.body, { proveedorId: 'fav', items: [] });
      await a.repository.comprobarSalud();
    });

    await t.test('Validaciones y tipos de contenido no crean movimientos ni consumen claves', async () => {
      const base = receipt('var-validacion', 1);
      for (const invalid of [
        { ...base, unidades: 0 }, { ...base, unidades: -1 }, { ...base, unidades: 1.2 },
        { ...base, unidades: Number.MAX_SAFE_INTEGER + 1 }, { ...base, productoCodigo: ' ' },
        { ...base, referencia: '' }, { ...base, precio: 5 },
      ]) assert.equal((await restock(invalid)).status, 400);
      assert.equal((await request(a.url, receiptPath, { method: 'POST', apiKey: favApiKey, body: base })).status, 400);
      assert.equal((await request(a.url, receiptPath, { method: 'POST', apiKey: favApiKey, key: randomUUID(), rawBody: '{', contentType: 'application/json' })).status, 400);
      assert.equal((await request(a.url, receiptPath, { method: 'POST', apiKey: favApiKey, key: randomUUID(), rawBody: 'texto', contentType: 'text/plain' })).status, 415);
      assert.equal((await restock({ ...base, referencia: 'x'.repeat(1024 * 1024) })).status, 413);
      assert.equal((await request(a.url, '/api/v1/consignaciones/stock', { apiKey: favApiKey })).status, 400);
      assert.deepEqual((await stock()).items, []);
    });

    await t.test('Reposición de más de veinte unidades y replay por clave/cuerpo canónico', async () => {
      originalKey = randomUUID();
      originalReceipt = receipt('var-principal', 21, 'entrega-original');
      const first = await restock(originalReceipt, originalKey);
      assert.equal(first.status, 201);
      assert.equal(first.body.estado, 'RECIBIDA');
      original = first.body;
      const reordered = { referencia: originalReceipt.referencia, unidades: 21, productoCodigo: originalReceipt.productoCodigo, proveedorId: 'fav' };
      assert.deepEqual((await restock(reordered, originalKey, b.url)).body, original);
      assert.deepEqual(await item('var-principal'), expectedStock('var-principal', 21, 0));
    });

    await t.test('Referencia reconoce otra clave y vincula durablemente esa clave a la entrega', async () => {
      const otherKey = randomUUID();
      const replay = await restock(originalReceipt, otherKey, b.url);
      assert.equal(replay.status, 201);
      assert.deepEqual(replay.body, original);
      const conflict = await restock({ ...originalReceipt, referencia: 'otra-entrega', unidades: 1 }, otherKey);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.codigo, 'CLAVE_REUTILIZADA');
      const changedReference = await restock({ ...originalReceipt, unidades: 22 });
      assert.equal(changedReference.status, 409);
      assert.equal(changedReference.body.codigo, 'REFERENCIA_REUTILIZADA');
      const changedKey = await restock({ ...originalReceipt, unidades: 22 }, originalKey);
      assert.equal(changedKey.status, 409);
      assert.equal(changedKey.body.codigo, 'CLAVE_REUTILIZADA');
      assert.deepEqual(await item('var-principal'), expectedStock('var-principal', 21, 0));
    });

    await t.test('Las ventas son administrativas e idempotentes; el replay de recepción no repone lo vendido', async () => {
      const key = randomUUID();
      const sale = await sell('var-principal', 3, key);
      assert.equal(sale.status, 201);
      assert.match(sale.body.ventaId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.equal(sale.body.estado, 'REGISTRADA');
      assert.equal(sale.body.productoCodigo, 'var-principal');
      assert.equal(sale.body.unidades, 3);
      assert.deepEqual((await sell('var-principal', 3, key, b.url)).body, sale.body);
      const conflict = await sell('var-principal', 4, key);
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.codigo, 'CLAVE_REUTILIZADA');
      assert.deepEqual((await restock(originalReceipt, originalKey, b.url)).body, original);
      assert.deepEqual(await item('var-principal'), expectedStock('var-principal', 18, 3));
    });

    await t.test('Venta de producto inexistente o insuficiente no modifica stock ni guarda éxito', async () => {
      const missing = await sell('var-no-recibida', 1);
      assert.equal(missing.status, 404);
      assert.equal(missing.body.codigo, 'PRODUCTO_NO_ENCONTRADO');
      const key = randomUUID();
      const insufficient = await sell('var-principal', 19, key);
      assert.equal(insufficient.status, 409);
      assert.equal(insufficient.body.codigo, 'STOCK_INSUFICIENTE');
      assert.deepEqual(await item('var-principal'), expectedStock('var-principal', 18, 3));
      assert.equal((await restock(receipt('var-principal', 1))).status, 201);
      assert.equal((await sell('var-principal', 19, key)).status, 201);
      assert.deepEqual(await item('var-principal'), expectedStock('var-principal', 0, 22));
    });

    await t.test('Identificadores opacos Unicode y NUL conservados sin normalizar', async () => {
      const code = 'var-\u0000-\u{1F60A}-A ';
      const body = receipt(code, 2, 'entrega-\u0000-\u{1F60A}');
      const key = randomUUID();
      const response = await restock(body, key);
      assert.equal(response.status, 201);
      assert.deepEqual((await restock(body, key, b.url)).body, response.body);
      assert.deepEqual(await item(code), expectedStock(code, 2, 0));
      assert.equal((await sell(code, 1)).status, 201);
      assert.deepEqual(await item(code), expectedStock(code, 1, 1));
      const longCode = 'var-larga-' + 'x'.repeat(10000);
      assert.equal((await restock(receipt(longCode, 1, 'entrega-larga-' + 'y'.repeat(10000)))).status, 201);
      assert.deepEqual(await item(longCode), expectedStock(longCode, 1, 0));
    });

    await t.test('Concurrencia de la misma clave y de referencia con múltiples claves produce una entrega', async () => {
      for (const sameKey of [true, false]) {
        const code = sameKey ? 'var-race-clave' : 'var-race-referencia';
        const body = receipt(code, 4);
        const key = randomUUID();
        const responses = await Promise.all(Array.from({ length: 12 }, (_, n) => restock(body, sameKey ? key : randomUUID(), n % 2 ? a.url : b.url)));
        assert.ok(responses.every(value => value.status === 201));
        assert.equal(new Set(responses.map(value => value.body.reposicionId)).size, 1);
        assert.deepEqual(await item(code), expectedStock(code, 4, 0));
      }
    });

    await t.test('Conflictos simultáneos de clave o referencia con otros datos tienen un único ganador', async () => {
      for (const sameKey of [true, false]) {
        const code = sameKey ? 'var-race-otros-datos-clave' : 'var-race-otros-datos-ref';
        const key = randomUUID(), ref = randomUUID();
        const inputs = [receipt(code, 2, ref), receipt(code, 3, sameKey ? randomUUID() : ref)];
        const responses = await Promise.all(inputs.map((body, n) => restock(body, sameKey ? key : randomUUID(), n ? b.url : a.url)));
        assert.deepEqual(responses.map(value => value.status).sort(), [201, 409]);
        const winningUnits = inputs[responses.findIndex(value => value.status === 201)].unidades;
        assert.deepEqual(await item(code), expectedStock(code, winningUnits, 0));
      }
    });

    await t.test('Reposiciones distintas concurrentes no pierden unidades', async () => {
      const code = 'var-race-reposiciones-distintas';
      const responses = await Promise.all(Array.from({ length: 12 }, (_, n) => restock(receipt(code, 2), randomUUID(), n % 2 ? a.url : b.url)));
      assert.ok(responses.every(value => value.status === 201));
      assert.equal(new Set(responses.map(value => value.body.reposicionId)).size, 12);
      assert.deepEqual(await item(code), expectedStock(code, 24, 0));
    });

    await t.test('Dos instancias compiten por la última unidad sin saldo negativo', async () => {
      const code = 'var-ultima-unidad';
      await restock(receipt(code, 1));
      const responses = await Promise.all(Array.from({ length: 12 }, (_, n) => sell(code, 1, randomUUID(), n % 2 ? a.url : b.url)));
      assert.equal(responses.filter(value => value.status === 201).length, 1);
      assert.equal(responses.filter(value => value.status === 409 && value.body.codigo === 'STOCK_INSUFICIENTE').length, 11);
      assert.deepEqual(await item(code), expectedStock(code, 0, 1));
    });

    await t.test('Ventas y reposiciones simultáneas conservan entradas menos ventas aceptadas', async () => {
      const code = 'var-race-mixta';
      await restock(receipt(code, 2));
      const operations = Array.from({ length: 12 }, (_, n) => [
        restock(receipt(code, 1), randomUUID(), n % 2 ? a.url : b.url).then(result => ({ tipo: 'reposicion', result })),
        sell(code, 1, randomUUID(), n % 2 ? b.url : a.url).then(result => ({ tipo: 'venta', result })),
      ]).flat();
      const responses = await Promise.all(operations);
      const receipts = responses.filter(value => value.tipo === 'reposicion');
      const sales = responses.filter(value => value.tipo === 'venta');
      assert.ok(receipts.every(value => value.result.status === 201));
      assert.ok(sales.every(value => value.result.status === 201 || (value.result.status === 409 && value.result.body.codigo === 'STOCK_INSUFICIENTE')));
      const acceptedSales = sales.filter(value => value.result.status === 201).length;
      assert.deepEqual(await item(code), expectedStock(code, 14 - acceptedSales, acceptedSales));
    });

    await t.test('Fallo real antes del resultado idempotente revierte recepción y venta completas', async () => {
      const code = 'var-rollback';
      await restock(receipt(code, 3));
      const body = receipt(code, 7), receiptKey = randomUUID(), saleKey = randomUUID();
      const snapshot = async () => ({
        stock: await stock(),
        counts: (await poolA.query(`SELECT (SELECT count(*)::int FROM tienda_stock) stock,
          (SELECT count(*)::int FROM tienda_reposiciones) reposiciones,
          (SELECT count(*)::int FROM tienda_ventas) ventas,
          (SELECT count(*)::int FROM tienda_operaciones) operaciones`)).rows[0],
      });
      const before = await snapshot();
      await poolA.query(`CREATE FUNCTION prueba_fallo_resultado_tienda() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Fallo sintético de resultado de Tienda'; END $$;
        CREATE TRIGGER prueba_rollback_tienda BEFORE INSERT ON tienda_operaciones
        FOR EACH ROW EXECUTE FUNCTION prueba_fallo_resultado_tienda();`);
      try {
        assert.equal((await restock(body, receiptKey)).status, 500);
        assert.equal((await sell(code, 2, saleKey, b.url)).status, 500);
        assert.deepEqual(await snapshot(), before);
      } finally {
        await poolA.query('DROP TRIGGER prueba_rollback_tienda ON tienda_operaciones; DROP FUNCTION prueba_fallo_resultado_tienda()');
      }
      assert.equal((await restock(body, receiptKey, b.url)).status, 201);
      assert.equal((await sell(code, 2, saleKey)).status, 201);
      assert.deepEqual(await item(code), expectedStock(code, 8, 2));
    });

    await t.test('Límites de entero seguro se comprueban sin efectos parciales', async () => {
      const code = 'var-limite-entero';
      assert.equal((await restock(receipt(code, Number.MAX_SAFE_INTEGER))).status, 201);
      const overflow = await restock(receipt(code, 1));
      assert.equal(overflow.status, 422);
      assert.equal(overflow.body.codigo, 'STOCK_NO_REPRESENTABLE');
      assert.deepEqual(await item(code), expectedStock(code, Number.MAX_SAFE_INTEGER, 0));
      assert.equal((await sell(code, 1)).status, 201);
      assert.equal((await restock(receipt(code, 1))).status, 201);
      const soldOverflow = await sell(code, Number.MAX_SAFE_INTEGER);
      assert.equal(soldOverflow.status, 422);
      assert.equal(soldOverflow.body.codigo, 'STOCK_NO_REPRESENTABLE');
      assert.deepEqual(await item(code), expectedStock(code, Number.MAX_SAFE_INTEGER, 1));
    });

    await t.test('Una aplicación nueva recupera entregas y claves reconocidas desde PostgreSQL', async () => {
      await a.app.close();
      const c = await start(environment.pool());
      const replay = await restock(originalReceipt, originalKey, c.url);
      assert.equal(replay.status, 201);
      assert.deepEqual(replay.body, original);
      const replacementKey = randomUUID();
      assert.deepEqual((await restock(originalReceipt, replacementKey, c.url)).body, original);
      assert.deepEqual((await restock(originalReceipt, replacementKey, b.url)).body, original);
      const result = await request(c.url, adminStockPath, { token: token(c.app) });
      assert.equal(result.status, 200);
      assert.deepEqual(result.body.items.find(value => value.productoCodigo === 'var-principal'), expectedStock('var-principal', 0, 22));
      a = c;
    });

    await t.test('Caída de PostgreSQL propio produce indisponibilidad, sin stock vacío inventado', async () => {
      environment.stop();
      const result = await request(a.url, stockPath, { apiKey: favApiKey });
      assert.equal(result.status, 503);
      assert.equal(result.body.codigo, 'SERVICIO_NO_DISPONIBLE');
      assert.equal(result.body.items, undefined);
      const incoming = await restock(receipt('var-fallo-db', 1));
      assert.equal(incoming.status, 503);
      assert.equal(incoming.body.codigo, 'SERVICIO_NO_DISPONIBLE');
    });

    console.log('PostgreSQL real ' + environment.version + '; Node ' + process.version + '; dos instancias HTTP; datos y credenciales exclusivamente sintéticos.');
  } finally {
    for (const app of apps.reverse()) await app.close();
    await environment.close();
  }
});
