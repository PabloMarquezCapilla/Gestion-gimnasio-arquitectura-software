import { test } from 'node:test';
import assert from 'node:assert/strict';
import module from '../dist/ocupacion.js';

test('Cache-aside: hit evita fuente y registra antigüedad; miss carga y guarda', async () => {
  let loads = 0; let hit = false; let stores = 0;
  const cache = { lookup: async () => ({ ticket: { token: 't', deadline: 1 }, ...(hit ? { value: 4, ageMs: 20 } : {}) }),
    store: async () => { stores++; return true; }, invalidate: async () => {}, close: async () => {} };
  const reader = new module.OcupacionReader(async () => { loads++; return 4; }, cache);
  assert.equal(await reader.read('sede-1'), 4); hit = true;
  assert.equal(await reader.read('sede-1'), 4); assert.equal(loads, 1); assert.equal(stores, 1);
  assert.equal(reader.metrics.hit, 1); assert.equal(reader.metrics.miss, 1); assert.equal(reader.metrics.age.count, 1);
});
test('Fallas Redis no inventan ceros; si Mongo falla se propaga el error', async () => {
  const warnings = [];
  const cache = { lookup: async () => { throw new Error(); }, store: async () => true, invalidate: async () => { throw new Error(); } };
  const reader = new module.OcupacionReader(async () => 7, cache);
  assert.equal(await reader.read('sede-1', c => warnings.push(c)), 7);
  await reader.invalidate('sede-1', c => warnings.push(c));
  assert.equal(reader.metrics.errors, 2); assert.equal(reader.metrics.invalidationErrors, 1);
  assert.deepEqual(warnings, ['CACHE_LECTURA_FALLIDA', 'CACHE_INVALIDACION_FALLIDA']);
  await assert.rejects(new module.OcupacionReader(async () => { throw new Error('fuente caída'); }, cache).read('sede-1'), /fuente caída/);
});
test('Escritura obsoleta rechazada se cuenta; caché desactivada consulta fuente', async () => {
  const cache = { lookup: async () => ({ ticket: { token: 't', deadline: 1 } }), store: async () => false };
  const r = new module.OcupacionReader(async () => 1, cache);
  assert.equal(await r.read('sede-1'), 1); assert.equal(r.metrics.storesRejected, 1);
  const off = new module.OcupacionReader(async () => 2); assert.equal(await off.read('sede-1'), 2); assert.equal(off.metrics.bypass, 1);
});
