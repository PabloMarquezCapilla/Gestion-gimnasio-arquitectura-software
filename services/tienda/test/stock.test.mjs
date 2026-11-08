import assert from 'node:assert/strict';
import test from 'node:test';
import { TiendaStockService, TiendaError } from '../dist/stock.js';

function fixture() {
  const calls = [];
  const repository = {
    async listarStock() { return []; },
    async recibirReposicion(clave, datos) { calls.push({ clave, datos }); return { reposicionId: 'resultado-del-puerto', estado: 'RECIBIDA' }; },
    async registrarVenta(actorId, clave, datos) { calls.push({ actorId, clave, datos }); return { ventaId: 'venta-del-puerto', estado: 'REGISTRADA', ...datos }; },
    async comprobarSalud() {},
  };
  return { repository, calls, service: new TiendaStockService(repository) };
}
const input = { proveedorId: 'fav', productoCodigo: 'var-ficticia', unidades: 21, referencia: 'entrega-ficticia' };
const errorCodigo = codigo => error => error instanceof TiendaError && error.statusCode === 400 && error.codigo === codigo;

test('reposición conserva IDs opacos, valores y orden canónico; no adopta el límite ficticio de veinte', async () => {
  const { service, calls } = fixture();
  const codigo = '  Variante-Ñ-🧥\u0000-' + 'x'.repeat(4000);
  const referencia = '  entrega-Única  ';
  const result = await service.reponer(' clave-original ', { referencia, unidades: 21, productoCodigo: codigo, proveedorId: 'fav' });
  assert.deepEqual(result, { reposicionId: 'resultado-del-puerto', estado: 'RECIBIDA' });
  assert.deepEqual(calls, [{ clave: ' clave-original ', datos: { proveedorId: 'fav', productoCodigo: codigo, unidades: 21, referencia } }]);
  assert.deepEqual(Object.keys(calls[0].datos), ['proveedorId', 'productoCodigo', 'unidades', 'referencia']);
});

test('una reposición inválida nunca llega al puerto de persistencia ni acepta estado o stock impuestos', async () => {
  const { service, calls } = fixture();
  const invalidos = [null, [], {}, { ...input, proveedorId: 'otro' }, { ...input, productoCodigo: '  ' },
    { ...input, referencia: '' }, { ...input, referencia: 1 }, { ...input, unidades: '2' },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN].map(unidades => ({ ...input, unidades })),
    { ...input, estado: 'RECIBIDA' }, { ...input, unidadesDisponibles: 10 }, { ...input, actorId: 'otro' }];
  for (const body of invalidos) await assert.rejects(service.reponer('clave', body), errorCodigo('SOLICITUD_INVALIDA'));
  for (const key of [undefined, null, '', ' \t\n', 12, ['clave']]) {
    await assert.rejects(service.reponer(key, input), errorCodigo('IDEMPOTENCIA_INVALIDA'));
  }
  assert.deepEqual(calls, []);
});

test('venta recibe el actor autenticado aparte del cuerpo y solo admite variante y cantidad positiva', async () => {
  const { service, calls } = fixture();
  const datos = { productoCodigo: 'Variante-Sin-Normalizar ', unidades: 3 };
  assert.deepEqual(await service.vender('admin-real', 'venta-uno', datos),
    { ventaId: 'venta-del-puerto', estado: 'REGISTRADA', ...datos });
  assert.deepEqual(calls, [{ actorId: 'admin-real', clave: 'venta-uno', datos }]);
  for (const body of [{ ...datos, actorId: 'otro' }, { ...datos, unidades: 0 }, { ...datos, unidades: 0.5 },
    { ...datos, precio: 15 }, { ...datos, proveedorId: 'fav' }, { ...datos, unidades: Number.MAX_SAFE_INTEGER + 1 }]) {
    await assert.rejects(service.vender('admin-real', 'otra', body), errorCodigo('SOLICITUD_INVALIDA'));
  }
  await assert.rejects(service.vender(' ', 'otra', datos), error => error.statusCode === 401 && error.codigo === 'NO_AUTENTICADO');
  assert.equal(calls.length, 1);
});

test('consultar una tienda sin recepciones devuelve vacío; una falla del puerto sigue siendo un error', async () => {
  const { service, repository } = fixture();
  assert.deepEqual(await service.consultarStock(), { proveedorId: 'fav', items: [] });
  const fallo = new Error('Dependencia de datos caída');
  repository.listarStock = async () => { throw fallo; };
  await assert.rejects(service.consultarStock(), error => error === fallo);
});
