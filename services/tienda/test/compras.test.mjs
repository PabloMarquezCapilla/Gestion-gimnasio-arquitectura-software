import assert from 'node:assert/strict';
import test from 'node:test';
import tiendaModule from '../dist/app.js';
import { CatalogoFavService } from '../dist/catalogo.js';
import { FavError } from '../dist/clients/fav-catalogo.client.js';
import { TiendaError, TiendaStockService, datosCompra } from '../dist/stock.js';

const secret = 'clave-ficticia-tienda-de-pruebas-de-mas-de-32-caracteres';
const current = new Date('2026-11-09T12:00:00.000Z');
const catalogoFav = [
  { productoId: 'prod-remera', nombre: 'Remera básica', categoria: 'remeras',
    variantes: [{ varianteId: 'var-remera-m', talle: 'M', color: 'Blanco', precio: 15000 },
      { varianteId: 'var-remera-l', talle: 'L', color: 'Negro', precio: 15000.5 }] },
  { productoId: 'prod-jean', nombre: 'Jean mom', categoria: 'jeans',
    variantes: [{ varianteId: 'var-jean-38', talle: '38', color: 'Celeste', precio: 42000 }] },
  { productoId: 'prod-buzo', nombre: 'Buzo', categoria: 'buzos',
    variantes: [{ varianteId: 'var-buzo-s', talle: 'S', color: 'Gris', precio: 30000 }] },
];

// Repositorio en memoria con la misma semántica que PostgreSQL: todo o nada e idempotente.
function memoria(stockInicial) {
  const stock = new Map(Object.entries(stockInicial));
  const compras = [];
  return {
    compras,
    async listarStock() { return [...stock].map(([productoCodigo, unidadesDisponibles]) => ({ productoCodigo, unidadesDisponibles, unidadesVendidas: 0 })); },
    async recibirReposicion() { throw new Error('no usado'); },
    async registrarVenta() { throw new Error('no usado'); },
    async buscarCompra(socioId, clave, datos) {
      const previa = compras.find(c => c.socioId === socioId && c.clave === clave);
      if (!previa) return undefined;
      if (JSON.stringify(previa.datos) !== JSON.stringify(datos)) throw new TiendaError(409, 'CLAVE_REUTILIZADA', 'otra');
      return previa.resultado;
    },
    async registrarCompra(socioId, clave, datos, items, creadaEn) {
      const repetida = await this.buscarCompra(socioId, clave, datos);
      if (repetida) return repetida;
      if (items.some(i => (stock.get(i.productoCodigo) ?? 0) < i.unidades)) throw new TiendaError(409, 'STOCK_INSUFICIENTE', 'no alcanza');
      for (const i of items) stock.set(i.productoCodigo, stock.get(i.productoCodigo) - i.unidades);
      const resultado = { compraId: `compra-${compras.length + 1}`, estado: 'REGISTRADA', items,
        totalMinor: items.reduce((t, i) => t + i.subtotalMinor, 0), currency: 'ARS', creadaEn: creadaEn.toISOString() };
      compras.push({ socioId, clave, datos, resultado, creadaEn });
      return resultado;
    },
    async listarCompras(socioId, pagina, tamanio) {
      const propias = compras.filter(c => c.socioId === socioId).map(c => c.resultado).reverse();
      return { pagina, tamanio, total: propias.length, items: propias.slice((pagina - 1) * tamanio, pagina * tamanio) };
    },
    async listarComprasAdmin(pagina, tamanio) {
      const todas = compras.map(c => ({ ...c.resultado, socioId: c.socioId })).reverse();
      return { pagina, tamanio, total: todas.length, totalMinor: todas.reduce((t, c) => t + c.totalMinor, 0),
        items: todas.slice((pagina - 1) * tamanio, pagina * tamanio) };
    },
    async comprobarSalud() {},
  };
}

function clienteFav() {
  const estado = { llamadas: 0, falla: null };
  return { estado, async listarProductos() { estado.llamadas++; if (estado.falla) throw estado.falla; return structuredClone(catalogoFav); } };
}

async function fixture(t, { stock = { 'var-remera-m': 5, 'var-jean-38': 1, 'var-buzo-s': 0 }, catalogo } = {}) {
  let ahora = current.getTime();
  const repo = memoria(stock);
  const fav = clienteFav();
  const servicioCatalogo = catalogo ?? new CatalogoFavService(fav, { clock: () => ahora, ttlMs: 60_000, vigenciaDegradadaMs: 15 * 60_000 });
  const app = tiendaModule.buildTiendaApp({ jwtSecret: secret, clock: () => new Date(ahora), stockRepository: repo,
    catalogo: servicioCatalogo, favApiKey: 'fav-ficticia' });
  t.after(() => app.close());
  await app.ready();
  const token = (sub = 'socio-1', rol = 'SOCIO') => {
    const iat = Math.floor(ahora / 1000);
    return 'Bearer ' + app.jwt.sign({ sub, rol, iss: 'gimnasio', aud: 'gimnasio-web', iat, exp: iat + 3600 });
  };
  return { app, repo, fav, token, avanzar: ms => { ahora += ms; } };
}
const comprar = (app, auth, body, key = 'compra-clave-0001') => app.inject({ method: 'POST', url: '/api/v1/tienda/compras',
  headers: { authorization: auth, 'idempotency-key': key }, payload: body });

test('el catálogo combina FAV con el stock local: solo variantes con unidades, precio en centavos', async (t) => {
  const { app, token } = await fixture(t);
  const res = await app.inject({ url: '/api/v1/tienda/productos', headers: { authorization: token() } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.origen, 'FAV');
  assert.equal(body.total, 2);
  assert.deepEqual(body.items.map(p => p.nombre), ['Jean mom', 'Remera básica']);
  assert.deepEqual(body.items[1].variantes, [{ productoCodigo: 'var-remera-m', talle: 'M', color: 'Blanco', precioMinor: 1500000, unidadesDisponibles: 5 }]);
  const filtrado = await app.inject({ url: '/api/v1/tienda/productos?categoria=jeans&tamanio=1', headers: { authorization: token() } });
  assert.deepEqual(filtrado.json().items.map(p => p.productoId), ['prod-jean']);
  const invalido = await app.inject({ url: '/api/v1/tienda/productos?orden=precio', headers: { authorization: token() } });
  assert.equal(invalido.statusCode, 400);
});

test('una compra descuenta stock con precio del servidor y es idempotente', async (t) => {
  const { app, repo, token } = await fixture(t);
  const body = { items: [{ productoCodigo: 'var-remera-m', unidades: 2 }, { productoCodigo: 'var-jean-38', unidades: 1 }] };
  const primera = await comprar(app, token(), body);
  assert.equal(primera.statusCode, 201);
  assert.equal(primera.json().totalMinor, 2 * 1500000 + 4200000);
  assert.equal(primera.json().items[0].nombre, 'Remera básica');
  const repetida = await comprar(app, token(), body);
  assert.deepEqual(repetida.json(), primera.json());
  assert.equal(repo.compras.length, 1);
  const otraClave = await comprar(app, token(), body, 'compra-clave-0002');
  assert.equal(otraClave.statusCode, 409);
  assert.equal(otraClave.json().codigo, 'STOCK_INSUFICIENTE');
  const reutilizada = await comprar(app, token(), { items: [{ productoCodigo: 'var-remera-m', unidades: 1 }] });
  assert.equal(reutilizada.json().codigo, 'CLAVE_REUTILIZADA');
  const mias = await app.inject({ url: '/api/v1/tienda/compras', headers: { authorization: token() } });
  assert.equal(mias.json().total, 1);
  const ajenas = await app.inject({ url: '/api/v1/tienda/compras', headers: { authorization: token('socio-2') } });
  assert.equal(ajenas.json().total, 0);
});

test('el cliente no puede imponer precio ni comprar variantes fuera del catálogo; ADMIN no compra como socio', async (t) => {
  const { app, token } = await fixture(t);
  const conPrecio = await comprar(app, token(), { items: [{ productoCodigo: 'var-remera-m', unidades: 1, precioMinor: 1 }] });
  assert.equal(conPrecio.statusCode, 400);
  const inexistente = await comprar(app, token(), { items: [{ productoCodigo: 'var-inexistente', unidades: 1 }] });
  assert.equal(inexistente.statusCode, 409);
  assert.equal(inexistente.json().codigo, 'PRODUCTO_NO_DISPONIBLE');
  const admin = await comprar(app, token('admin-1', 'ADMIN'), { items: [{ productoCodigo: 'var-remera-m', unidades: 1 }] });
  assert.equal(admin.statusCode, 403);
  const sinClave = await app.inject({ method: 'POST', url: '/api/v1/tienda/compras', headers: { authorization: token() },
    payload: { items: [{ productoCodigo: 'var-remera-m', unidades: 1 }] } });
  assert.equal(sinClave.json().codigo, 'IDEMPOTENCIA_INVALIDA');
});

test('FAV caído: sirve caché degradada, luego 503; la compra repetida sigue respondiendo', async (t) => {
  const { app, fav, token, avanzar } = await fixture(t);
  const body = { items: [{ productoCodigo: 'var-remera-m', unidades: 1 }] };
  assert.equal((await comprar(app, token(), body)).statusCode, 201);
  fav.estado.falla = new FavError('FAV_NO_DISPONIBLE');
  avanzar(61_000);
  const degradado = await app.inject({ url: '/api/v1/tienda/productos', headers: { authorization: token() } });
  assert.equal(degradado.statusCode, 200);
  assert.equal(degradado.json().origen, 'CACHE_DEGRADADA');
  avanzar(15 * 60_000);
  const caido = await app.inject({ url: '/api/v1/tienda/productos', headers: { authorization: token() } });
  assert.equal(caido.statusCode, 503);
  assert.equal(caido.json().codigo, 'PROVEEDOR_NO_DISPONIBLE');
  const nueva = await comprar(app, token(), body, 'compra-clave-0002');
  assert.equal(nueva.statusCode, 503);
  // El reintento de una compra ya registrada no depende de FAV.
  assert.equal((await comprar(app, token(), body)).statusCode, 201);
  const metricas = (await app.inject('/metrics')).body;
  assert.match(metricas, /tienda_catalogo_respuestas_total\{service="tienda",origen="cache_degradada"\} 1/);
});

test('el circuito abierto evita llamar a FAV en cada solicitud', async (t) => {
  const { app, fav, token, avanzar } = await fixture(t);
  fav.estado.falla = new FavError('FAV_TIEMPO_AGOTADO');
  for (let i = 0; i < 5; i++) {
    avanzar(10);
    assert.equal((await app.inject({ url: '/api/v1/tienda/productos', headers: { authorization: token() } })).statusCode, 503);
  }
  assert.equal(fav.estado.llamadas, 3);
  assert.match((await app.inject('/metrics')).body, /tienda_fav_circuito_estado\{service="tienda",estado="ABIERTO"\} 1/);
});

test('validación de compra: límites, duplicados y campos extra', () => {
  const error = body => assert.throws(() => datosCompra(body), e => e.codigo === 'SOLICITUD_INVALIDA');
  error({ items: [] });
  error({ items: Array.from({ length: 11 }, (_, i) => ({ productoCodigo: 'v' + i, unidades: 1 })) });
  error({ items: [{ productoCodigo: 'v', unidades: 11 }] });
  error({ items: [{ productoCodigo: 'v', unidades: 1 }, { productoCodigo: 'v', unidades: 2 }] });
  error({ items: [{ productoCodigo: 'v', unidades: 1 }], socioId: 'otro' });
  assert.deepEqual(datosCompra({ items: [{ unidades: 2, productoCodigo: 'v' }] }), { items: [{ productoCodigo: 'v', unidades: 2 }] });
});

test('el servicio exige socio autenticado', async () => {
  const service = new TiendaStockService(memoria({}));
  await assert.rejects(service.comprar(' ', 'clave-0001', { items: [] }, async () => new Map()), e => e.codigo === 'NO_AUTENTICADO');
});

test('la caja (ADMIN) ve las compras de todos los socios con el total; un socio no puede', async (t) => {
  const { app, token } = await fixture(t);
  await comprar(app, token('socio-1'), { items: [{ productoCodigo: 'var-remera-m', unidades: 1 }] }, 'compra-caja-0001');
  await comprar(app, token('socio-2'), { items: [{ productoCodigo: 'var-jean-38', unidades: 1 }] }, 'compra-caja-0002');
  const caja = await app.inject({ url: '/api/v1/tienda/admin/compras', headers: { authorization: token('admin-1', 'ADMIN') } });
  assert.equal(caja.statusCode, 200);
  assert.equal(caja.json().total, 2);
  assert.equal(caja.json().totalMinor, 1500000 + 4200000);
  assert.deepEqual(caja.json().items.map(c => c.socioId), ['socio-2', 'socio-1']);
  const socio = await app.inject({ url: '/api/v1/tienda/admin/compras', headers: { authorization: token('socio-1') } });
  assert.equal(socio.statusCode, 403);
});
