// Campos used/costMinor/spendingMinor del informe mensual a Car Cruds (perfil 0.3.0)
// y test de contrato: el payload completo cumple el OpenAPI fijado del proveedor.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import serviceModule from '../dist/car-cruds-evidencias.service.js';
import accesosModule from '../dist/clients/accesos.client.js';
import repoModule from '../dist/repository.js';

const { CarCrudsEvidenciasService, costoMensual, gastoDelMes, limitesMes } = serviceModule;
const { HttpAccesosUsoClient } = accesosModule;
const { MemorySociosRepository, SEED_SOCIOS, SEED_MEMBRESIAS } = repoModule;

const contrato = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../docs/contracts/car-cruds-employees-0.3.0.openapi.json'), 'utf8'));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
ajv.addFormat('int64', { type: 'number', validate: Number.isSafeInteger });
const validarFotografia = ajv.compile({
  ...contrato.paths['/v1/employees/membership-evidence'].post.requestBody.content['application/json'].schema,
  components: contrato.components,
});

const noviembre = limitesMes('2026-11');
const corte = new Date('2026-11-20T15:00:00.000Z');
const contrato3Meses = { mesesContratados: 3, importeMinor: 9000000, moneda: 'ARS', fechaInicio: '2026-10-01T03:00:00.000Z',
  fechaFin: '2026-12-31T03:00:00.000Z', confirmadoEn: '2026-11-05T12:00:00.000Z' };

test('el mes se interpreta en hora argentina', () => {
  assert.equal(noviembre.desde.toISOString(), '2026-11-01T03:00:00.000Z');
  assert.equal(noviembre.hasta.toISOString(), '2026-12-01T03:00:00.000Z');
  assert.equal(limitesMes('2026-12').hasta.toISOString(), '2027-01-01T03:00:00.000Z');
});

test('costMinor: importe neto dividido por meses contratados, solo para mes completo y único', () => {
  assert.equal(costoMensual([contrato3Meses], noviembre.desde, noviembre.hasta, corte), 3000000);
  assert.equal(costoMensual(undefined, noviembre.desde, noviembre.hasta, corte), null);
  // Mes parcial: null hasta acuerdo.
  assert.equal(costoMensual([{ ...contrato3Meses, fechaInicio: '2026-11-10T03:00:00.000Z' }], noviembre.desde, noviembre.hasta, corte), null);
  // Dos planes cubren el mismo mes: ambiguo.
  assert.equal(costoMensual([contrato3Meses, contrato3Meses], noviembre.desde, noviembre.hasta, corte), null);
  // Confirmado después del corte: todavía no es un hecho observado.
  assert.equal(costoMensual([{ ...contrato3Meses, confirmadoEn: '2026-11-25T00:00:00.000Z' }], noviembre.desde, noviembre.hasta, corte), null);
  assert.equal(costoMensual([{ ...contrato3Meses, moneda: 'USD' }], noviembre.desde, noviembre.hasta, corte), null);
});

test('spendingMinor: pagos confirmados del mes hasta el corte; sin pagos es cero, sin fuente es null', () => {
  const pagos = [contrato3Meses, { ...contrato3Meses, importeMinor: 500, confirmadoEn: '2026-10-31T12:00:00.000Z' },
    { ...contrato3Meses, importeMinor: 700, confirmadoEn: '2026-11-25T12:00:00.000Z' }];
  assert.equal(gastoDelMes(pagos, noviembre.desde, noviembre.hasta, corte), 9000000);
  assert.equal(gastoDelMes([], noviembre.desde, noviembre.hasta, corte), 0);
  assert.equal(gastoDelMes(undefined, noviembre.desde, noviembre.hasta, corte), null);
  assert.equal(gastoDelMes([{ ...contrato3Meses, moneda: 'USD' }], noviembre.desde, noviembre.hasta, corte), null);
});

test('costMinor exige cubrir el último día completo, con precisión anterior de segundos compatible', () => {
  for (const fechaFin of ['2026-11-29T23:59:59Z', '2026-11-30T03:00:00Z', '2026-12-01T02:59:58.999Z']) {
    assert.equal(costoMensual([{ ...contrato3Meses, fechaFin }], noviembre.desde, noviembre.hasta, corte), null);
  }
  for (const fechaFin of ['2026-12-01T02:59:59Z', '2026-12-01T02:59:59.999Z']) {
    assert.equal(costoMensual([{ ...contrato3Meses, fechaFin }], noviembre.desde, noviembre.hasta, corte), 3000000);
  }
});

test('costMinor conserva desconocida una duración histórica y una fracción de centavo sin acuerdo', () => {
  for (const mesesContratados of [undefined, null, 0, 1.5, 37]) {
    assert.equal(costoMensual([{ ...contrato3Meses, mesesContratados }], noviembre.desde, noviembre.hasta, corte), null);
  }
  assert.equal(costoMensual([{ ...contrato3Meses, importeMinor: 9000001 }], noviembre.desde, noviembre.hasta, corte), null);
  assert.equal(costoMensual([{ ...contrato3Meses, importeMinor: 0 }], noviembre.desde, noviembre.hasta, corte), 0);
});

test('costMinor trata como ambiguo un contrato completo solapado con otro parcial confirmado', () => {
  const parcial = { ...contrato3Meses, fechaInicio: '2026-11-10T03:00:00Z', fechaFin: '2026-11-15T03:00:00Z' };
  assert.equal(costoMensual([contrato3Meses, parcial], noviembre.desde, noviembre.hasta, corte), null);
  assert.equal(costoMensual([contrato3Meses, { ...parcial, confirmadoEn: '2026-11-25T00:00:00Z' }],
    noviembre.desde, noviembre.hasta, corte), 3000000);
});

function servicio(t, { accesos, sinContratos = false, cambiarVinculo = false } = {}) {
  const contratos = sinContratos ? undefined : [contrato3Meses];
  const clock = () => corte;
  const repository = new MemorySociosRepository(SEED_SOCIOS, SEED_MEMBRESIAS, clock);
  let generado;
  const evidencias = {
    async prepararFotografia(cambio) {
      const fuente = {
        vinculo: { employeeId: cambio.employeeId, socioId: cambiarVinculo ? 'socio-demo-02' : 'socio-demo-01', version: 1, actualizadoEn: null },
        socio: SEED_SOCIOS.find(s => s.socioId === (cambiarVinculo ? 'socio-demo-02' : 'socio-demo-01')),
        membresias: [], contratos,
      };
      generado = cambio.generar(fuente, 'referencia-ficticia', 1);
      return { payload: generado };
    },
  };
  const service = new CarCrudsEvidenciasService(evidencias, undefined, clock, {
    accesos, obtenerVinculo: async employeeId => ({ employeeId, socioId: 'socio-demo-01', version: 1, actualizadoEn: null }),
  });
  return { service, generado: () => generado };
}
const admin = { socioId: 'admin', rol: 'ADMIN' };
const cuerpo = { period: '2026-11', versionVinculoEsperada: 1, versionAnteriorEsperada: 0 };

test('el informe completo cumple el contrato fijado de Car Cruds', async (t) => {
  const consultas = [];
  const accesos = { huboIngreso: async (...args) => { consultas.push(args); return true; } };
  const { service } = servicio(t, { accesos });
  const { payload } = await service.preparar(admin, 'employee-1', cuerpo, {});
  assert.deepEqual({ used: payload.used, costMinor: payload.costMinor, spendingMinor: payload.spendingMinor, currency: payload.currency },
    { used: true, costMinor: 3000000, spendingMinor: 9000000, currency: 'ARS' });
  assert.ok(validarFotografia(payload), JSON.stringify(validarFotografia.errors));
  assert.equal(consultas[0][0], 'socio-demo-01');
  assert.equal(consultas[0][1].toISOString(), noviembre.desde.toISOString());
  assert.equal(consultas[0][2].toISOString(), new Date(corte.getTime() + 1).toISOString());
});

test('si Accesos no responde o el vínculo cambió, used queda null y el informe se genera igual', async (t) => {
  for (const caso of [{ accesos: { huboIngreso: async () => undefined } }, { accesos: undefined },
    { accesos: { huboIngreso: async () => true }, cambiarVinculo: true }]) {
    const { service } = servicio(t, caso);
    const { payload } = await service.preparar(admin, 'employee-1', cuerpo, {});
    assert.equal(payload.used, null);
    assert.equal(payload.costMinor, 3000000);
    assert.ok(validarFotografia(payload));
  }
  const { service } = servicio(t, { sinContratos: true });
  const { payload } = await service.preparar(admin, 'employee-1', cuerpo, {});
  assert.equal(payload.currency, undefined);
  assert.ok(validarFotografia(payload));
});

test('cliente HTTP de Accesos: clave técnica, un reintento ante 503 y degradación a desconocido', async (t) => {
  let llamadas = 0, recibida;
  const server = createServer((req, res) => {
    llamadas++;
    recibida = req;
    if (llamadas === 1) { res.writeHead(503).end('{}'); return; }
    const q = new URL(req.url, 'http://x').searchParams;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ socioId: q.get('socioId'), desde: q.get('desde'), hasta: q.get('hasta'), huboIngreso: true }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { server.closeAllConnections(); server.close(r); }));
  const client = new HttpAccesosUsoClient(`http://127.0.0.1:${server.address().port}`, 'clave-tecnica');
  assert.equal(await client.huboIngreso('socio-1', noviembre.desde, noviembre.hasta), true);
  assert.equal(llamadas, 2);
  assert.equal(recibida.headers['x-service-key'], 'clave-tecnica');
  assert.match(recibida.url, /^\/internal\/v1\/accesos\/uso\?socioId=socio-1&desde=/);
  const caido = new HttpAccesosUsoClient('http://127.0.0.1:1', 'clave-tecnica', 300);
  assert.equal(await caido.huboIngreso('socio-1', noviembre.desde, noviembre.hasta), undefined);
});
