import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import sociosApp from '../services/socios-membresias/dist/app.js';
import sociosRepos from '../services/socios-membresias/dist/repository.js';
import gestion from '../services/socios-membresias/dist/membresias.postgres.js';
import administradores from '../services/socios-membresias/dist/crear-admin.js';
import tiendaApp from '../services/tienda/dist/app.js';
import tiendaRepos from '../services/tienda/dist/stock.postgres.js';
import { postgresPrueba } from './membresias/entorno.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const mesArgentino = fecha => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
}).format(new Date(fecha));

test('Resúmenes ADMIN completos con PostgreSQL real, moneda y calendario argentino', { timeout: 120000 }, async t => {
  const entorno = await postgresPrueba();
  const apps = [];
  t.after(async () => { await Promise.all(apps.map(app => app.close())); await entorno.close(); });
  await entorno.pool('postgres').query('CREATE DATABASE tienda');
  const sociosPool = entorno.pool('socios'), tiendaPool = entorno.pool('tienda');
  const socios = new sociosRepos.PostgresSociosRepository(sociosPool);
  const tienda = new tiendaRepos.PostgresTiendaStockRepository(tiendaPool);
  await socios.inicializarEsquema();
  await tienda.inicializarEsquema();
  const admin = await administradores.crearAdministrador(socios, {
    dni: '90009990', nombre: 'Admin de reportes', email: 'reportes@example.invalid', password: 'clave-ficticia-reportes',
  });
  await socios.crearSocio({ socioId: 'socio-reportes', dni: '90009991', nombre: 'Socio de reportes',
    email: 'socio-reportes@example.invalid', rol: 'SOCIO', estado: 'ACTIVO', createdAt: new Date().toISOString() });
  const jwtSecret = 'secreto-sintetico-reportes-'.repeat(3);
  const a = sociosApp.buildSociosApp({ repository: socios, gestion: new gestion.PostgresGestionMembresias(sociosPool),
    jwtSecret, internalApiKey: 'interna-sintetica-reportes' });
  const b = tiendaApp.buildTiendaApp({ jwtSecret, favApiKey: 'fav-sintetica-reportes', stockRepository: tienda });
  for (const app of [a, b]) { apps.push(app); await app.listen({ host: '127.0.0.1', port: 0 }); }
  const token = rol => a.jwt.sign({ sub: rol === 'ADMIN' ? admin.socioId : 'socio-reportes', rol, iss: 'gimnasio', aud: 'gimnasio-web',
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const adminToken = token('ADMIN');
  const validadores = new Map();
  const consultar = async (app, ruta, credencial = adminToken) => {
    const response = await fetch('http://127.0.0.1:' + app.server.address().port + ruta, {
      headers: credencial ? { Authorization: 'Bearer ' + credencial } : {}, signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    const validar = validadores.get(ruta);
    if (response.status === 200 && validar) assert.ok(validar(body), JSON.stringify(validar.errors));
    return { status: response.status, body, headers: response.headers };
  };
  const rutas = [[a, '/api/v1/solicitudes/resumen'], [b, '/api/v1/tienda/admin/resumen']];
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
  for (const [ruta, archivo] of [
    [rutas[0][1], 'openapi-membresias-v1.yaml'], [rutas[1][1], 'openapi-tienda-socios-v1.yaml'],
  ]) {
    const contrato = parse(await readFile(new URL('../docs/contracts/' + archivo, import.meta.url), 'utf8'));
    const schema = contrato.paths[ruta].get.responses['200'].content['application/json'].schema;
    validadores.set(ruta, ajv.compile({ ...schema, components: contrato.components }));
  }

  await t.test('Permisos ADMIN, consultas sin parámetros y respuestas vacías válidas', async () => {
    for (const [app, ruta] of rutas) {
      assert.equal((await consultar(app, ruta, '')).status, 401);
      assert.equal((await consultar(app, ruta, token('SOCIO'))).status, 403);
      assert.equal((await consultar(app, ruta + '?pagina=1')).status, 400);
      const r = await consultar(app, ruta);
      assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.body.mesActual, mesArgentino(r.body.consultadoEn));
    }
    assert.equal((await consultar(a, rutas[0][1])).body.pendientes.cantidad, 0);
    assert.equal((await consultar(b, rutas[1][1])).body.historico.cantidad, 0);
  });

  await sociosPool.query(`INSERT INTO socios(socio_id,dni,nombre,email,rol,estado)
    SELECT 'reporte-socio-'||g, '8'||lpad(g::text,7,'0'), 'Socio de reporte '||g,
      'reporte-'||g||'@example.invalid','SOCIO','ACTIVO' FROM generate_series(1,251) g`);
  await sociosPool.query(`INSERT INTO solicitudes_planes(solicitud_id,socio_id,plan_id,nombre_plan,importe_minor,moneda,
    fecha_inicio,fecha_fin,estado,creado_por)
    SELECT 'reporte-pendiente-'||g,'reporte-socio-'||g,'plan-mensual','Plan de reporte',
      CASE WHEN g=251 THEN 500 ELSE 100 END,CASE WHEN g=251 THEN 'USD' ELSE 'ARS' END,
      now(),now()+interval '1 month','PENDIENTE',$1 FROM generate_series(1,251) g`, [admin.socioId]);

  await t.test('Incluye más de 200 solicitudes y conserva los importes por moneda', async () => {
    const r = await consultar(a, rutas[0][1]);
    assert.equal(r.status, 200); assert.equal(r.body.pendientes.cantidad, 251);
    assert.ok(validadores.get(rutas[0][1])(r.body));
    assert.deepEqual(r.body.pendientes.importes, [{ moneda: 'ARS', importeMinor: 25000 }, { moneda: 'USD', importeMinor: 500 }]);
  });

  const frontera = (await sociosPool.query(`SELECT
    (date_trunc('month',now() AT TIME ZONE 'America/Argentina/Buenos_Aires')-interval '1 month')
    AT TIME ZONE 'UTC' AS fecha`)).rows[0].fecha;
  const antes = new Date(frontera.getTime() + 3600000), despues = new Date(frontera.getTime() + 4 * 3600000);
  for (const [indice, moneda, importe, fecha] of [[1, 'ARS', 100, antes], [2, 'ARS', 200, despues], [3, 'USD', 300, despues]]) {
    const id = 'reporte-confirmado-' + indice;
    await sociosPool.query(`INSERT INTO membresias(membresia_id,socio_id,tipo_plan,fecha_inicio,fecha_fin,estado)
      VALUES($1,'reporte-socio-1','Reporte',$2,$2::timestamptz+interval '1 month','HABILITADA')`, [id, fecha]);
    await sociosPool.query(`INSERT INTO solicitudes_planes(solicitud_id,socio_id,plan_id,nombre_plan,importe_minor,moneda,
      fecha_inicio,fecha_fin,estado,creado_por) VALUES($1,'reporte-socio-1','plan-mensual','Plan histórico',$2,$3,
      $4,$4::timestamptz+interval '1 month','CONFIRMADA',$5)`, [id, importe, moneda, fecha, admin.socioId]);
    await sociosPool.query(`INSERT INTO pagos_membresia(pago_id,solicitud_id,referencia,estado,registrado_por)
      VALUES($1,$1,$1,'CONFIRMADO',$2)`, [id, admin.socioId]);
    await sociosPool.query(`INSERT INTO comprobantes_membresia(comprobante_id,pago_id,membresia_id,confirmado_por,confirmado_en)
      VALUES($1,$1,$1,$2,$3)`, [id, admin.socioId, fecha]);
  }
  await t.test('El cambio de mes se calcula en Argentina y los cobros confirmados quedan separados por moneda', async () => {
    const r = await consultar(a, rutas[0][1]);
    assert.equal(r.status, 200);
    assert.equal(r.body.ingresosMensuales.find(i => i.mes === mesArgentino(antes) && i.moneda === 'ARS').importeMinor, 100);
    assert.equal(r.body.ingresosMensuales.find(i => i.mes === mesArgentino(despues) && i.moneda === 'ARS').importeMinor, 200);
    assert.deepEqual(r.body.ingresosPeriodo, [{ moneda: 'ARS', importeMinor: 300 }, { moneda: 'USD', importeMinor: 300 }]);
    assert.deepEqual(r.body.confirmadasPorPlan, [{ nombrePlan: 'Plan histórico', cantidad: 3 }]);
  });

  const fechaCompra = (await tiendaPool.query('SELECT now() AS fecha')).rows[0].fecha;
  await tienda.recibirReposicion('reporte-entrega-unica', {
    proveedorId: 'fav', productoCodigo: 'reporte-variante', unidades: 1000, referencia: 'reporte-entrega-unica',
  });
  const compra = await tienda.registrarCompra('reporte-socio-1', 'reporte-compra-inicial',
    { items: [{ productoCodigo: 'reporte-variante', unidades: 1 }] },
    [{ productoCodigo: 'reporte-variante', nombre: 'Producto de reporte', talle: 'M', color: 'Negro',
      unidades: 1, precioUnitarioMinor: 100, subtotalMinor: 100 }], fechaCompra);
  const registros = Array.from({ length: 550 }, (_, indice) => {
    const compraId = randomUUID(), clave = JSON.stringify('reporte-compra-' + indice);
    const socio = JSON.stringify('reporte-socio-1');
    return { compra_id: compraId, socio_hash: hash(socio), socio_json: socio, clave_hash: hash(clave), clave_json: clave,
      contenido: JSON.stringify({ items: [{ productoCodigo: 'reporte-variante', unidades: 1 }] }),
      respuesta: JSON.stringify({ ...compra, compraId }), total_minor: 100, created_at: fechaCompra.toISOString() };
  });
  await tiendaPool.query(`INSERT INTO tienda_compras SELECT * FROM jsonb_to_recordset($1::jsonb) AS r(
    compra_id uuid,socio_hash text,socio_json text,clave_hash text,clave_json text,contenido text,respuesta text,
    total_minor bigint,created_at timestamptz)`, [JSON.stringify(registros)]);
  await tiendaPool.query(`INSERT INTO tienda_compra_items(compra_id,producto_hash,unidades,precio_unitario_minor)
    SELECT c.compra_id,s.producto_hash,1,100 FROM tienda_compras c CROSS JOIN tienda_stock s
    WHERE c.compra_id<>$1`, [compra.compraId]);
  await tiendaPool.query('UPDATE tienda_stock SET unidades_disponibles=unidades_disponibles-550,unidades_vendidas=unidades_vendidas+550');

  await t.test('Incluye más de 500 compras y los totales diarios son independientes de la página', async () => {
    const r = await consultar(b, rutas[1][1]);
    assert.equal(r.status, 200);
    assert.ok(validadores.get(rutas[1][1])(r.body));
    assert.deepEqual(r.body.hoy, { cantidad: 551, importeMinor: 55100 });
    assert.deepEqual(r.body.historico, { cantidad: 551, importeMinor: 55100 });
    assert.deepEqual(r.body.productos, [{ nombre: 'Producto de reporte', unidades: 551 }]);
    assert.equal((await consultar(b, '/api/v1/tienda/admin/compras?pagina=2&tamanio=50')).body.items.length, 50);
  });
  await tiendaPool.query('UPDATE tienda_compras SET created_at=$1 WHERE compra_id=$2', [antes, compra.compraId]);
  await t.test('Las ventas mensuales usan la fecha de Argentina', async () => {
    const r = await consultar(b, rutas[1][1]);
    assert.equal(r.status, 200);
    assert.equal(r.body.mensuales.find(i => i.mes === mesArgentino(antes)).importeMinor, 100);
    assert.equal(r.body.hoy.cantidad, 550);
  });
  await t.test('Un total fuera del rango seguro produce un error explícito', async () => {
    await tiendaPool.query('UPDATE tienda_compras SET total_minor=9007199254740991 WHERE compra_id=$1', [compra.compraId]);
    const r = await consultar(b, rutas[1][1]);
    assert.equal(r.status, 422); assert.equal(r.body.codigo, 'RESUMEN_NO_REPRESENTABLE');
    await sociosPool.query("UPDATE solicitudes_planes SET importe_minor=9007199254740991 WHERE solicitud_id='reporte-pendiente-1'");
    const s = await consultar(a, rutas[0][1]);
    assert.equal(s.status, 422); assert.equal(s.body.codigo, 'RESUMEN_NO_REPRESENTABLE');
  });
});
