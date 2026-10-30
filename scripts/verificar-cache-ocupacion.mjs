import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import { entornoMongo } from './cache/entorno.mjs';
import { entornoRedis } from './cache/redis-entorno.mjs';
import cacheModule from '../services/accesos-ocupacion/dist/redis.cache.js';
import readers from '../services/accesos-ocupacion/dist/ocupacion.js';
import repos from '../services/accesos-ocupacion/dist/repository.js';
import appModule from '../services/accesos-ocupacion/dist/app.js';

test('Caché: Redis y MongoDB reales; invalidación, carreras, fallas y recuperación', { timeout: 90000 }, async t => {
  const mongo = await entornoMongo(); let redis; const caches = []; const apps = [];
  const cache = async (ttl = 1000) => {
    const c = new cacheModule.RedisOcupacionCache({ url: redis.url, ttlMs: ttl, timeoutMs: 50 }); caches.push(c); c.start();
    for (let n = 0; n < 60 && !c.ready; n++) await pause(50); assert.ok(c.ready); return c;
  };
  try {
    redis = await entornoRedis();
    const repoA = new repos.MongoAccesosRepository(mongo.client);
    const second = new MongoClient(mongo.uri, { timeoutMS: 5000 }); await second.connect();
    const repoB = new repos.MongoAccesosRepository(second);
    t.after(() => second.close());
    await repoA.inicializar([{ sedeId: 'sede-1', nombre: 'Sede 1 sintética' }, { sedeId: 'sede-2', nombre: 'Sede 2 sintética' }]);
    const aCache = await cache(); const bCache = await cache();
    const options = { jwtSecret: 'clave-ficticia-solo-cache-test-'.repeat(3), socios: { verificar: async () => ({ habilitado: true }) } };
    const a = appModule.buildAccesosApp({ ...options, repository: repoA, ocupacionCache: aCache });
    const b = appModule.buildAccesosApp({ ...options, repository: repoB, ocupacionCache: bCache });
    apps.push(a, b); await Promise.all([a.ready(), b.ready()]);
    const now = Math.floor(Date.now() / 1000);
    const auth = { authorization: 'Bearer ' + a.jwt.sign({ sub: 'admin-cache', rol: 'ADMIN', iss: 'gimnasio', aud: 'gimnasio-web', iat: now, exp: now + 3600 }) };
    const read = async (app = a, sede = 'sede-1') => {
      const r = await app.inject({ url: `/api/v1/accesos/sedes/${sede}/ocupacion`, headers: auth }); assert.equal(r.statusCode, 200); return r.json().ocupacion;
    };
    let key = 0;
    const move = (app = a, tipo = 'INGRESO', socioId = 'socio-1', clave = 'cache-mov-' + (++key)) =>
      app.inject({ method: 'POST', url: '/api/v1/accesos/movimientos', payload: { sedeId: 'sede-1', socioId, tipo }, headers: { ...auth, 'idempotency-key': clave } });

    await t.test('Miss/hit reales y aislamiento entre sedes y réplicas', async () => {
      assert.equal(await read(), 0); const n = a.ocupacionMetrics.mongoQueries;
      assert.equal(await read(), 0); assert.equal(a.ocupacionMetrics.mongoQueries, n);
      assert.equal(await read(b), 0); assert.equal(b.ocupacionMetrics.hit, 1);
      await move(); assert.equal(await read(b), 1); assert.equal(await read(a, 'sede-2'), 0);
    });
    await t.test('Ingreso y egreso invalidan después del commit; replay tardío no reaplica', async () => {
      const r = await move(a, 'INGRESO', 'socio-2', 'replay-cache-001'); assert.equal(r.statusCode, 201); assert.equal(await read(b), 2);
      assert.equal((await move(b, 'EGRESO', 'socio-2')).statusCode, 201); assert.equal(await read(a), 1);
      const replay = await move(a, 'INGRESO', 'socio-2', 'replay-cache-001'); assert.equal(replay.json().movimiento.movimientoId, r.json().movimiento.movimientoId);
      assert.equal(await read(b), 1);
    });
    await t.test('Dos ingresos/dos egresos concurrentes preservan MongoDB y el agregado tras invalidar', async () => {
      const ins = await Promise.all([move(a, 'INGRESO', 'socio-3'), move(b, 'INGRESO', 'socio-3')]);
      assert.deepEqual(ins.map(r => r.statusCode).sort(), [201, 409]); assert.equal(await read(), 2);
      const outs = await Promise.all([move(a, 'EGRESO', 'socio-3'), move(b, 'EGRESO', 'socio-3')]);
      assert.deepEqual(outs.map(r => r.statusCode).sort(), [201, 409]); assert.equal(await read(b), 1);
    });
    await t.test('Lectura antigua termina tras invalidación: CAS impide reponer valor obsoleto', async () => {
      await aCache.invalidate('sede-1');
      let release; const gate = new Promise(resolve => { release = resolve; });
      let sampled; const sampledPromise = new Promise(resolve => { sampled = resolve; });
      const reader = new readers.OcupacionReader(async () => { const old = await repoA.ocupacion('sede-1'); sampled(); await gate; return old; }, aCache);
      const oldRead = reader.read('sede-1'); await sampledPromise;
      await move(b, 'INGRESO', 'socio-4'); release();
      assert.equal(await oldRead, 1); assert.equal(reader.metrics.storesRejected, 1); assert.equal(await read(), 2);
    });
    await t.test('Expiración y lectura lenta no renuevan el plazo original', async () => {
      const c = await cache(150);
      const initial = await c.lookup('sede-2'); await pause(100);
      assert.equal(await c.store('sede-2', initial.ticket, 0), true);
      await pause(75); assert.equal((await c.lookup('sede-2')).value, undefined);
      assert.equal(await c.store('sede-2', initial.ticket, 123), false);
    });
    await t.test('Evicción del token no permite ABA ni repone el resultado anterior', async () => {
      const c = await cache(250); const old = await c.lookup('sede-2');
      await pause(550); const newer = await c.lookup('sede-2'); assert.notEqual(newer.ticket.token, old.ticket.token);
      assert.equal(await c.store('sede-2', old.ticket, 999), false);
    });
    await t.test('Redis pausado: ingreso/egreso funcionan, invalidación falla visiblemente y lectura usa Mongo', async () => {
      await read(); const before = a.ocupacionMetrics.invalidationErrors;
      redis.pause();
      try {
        assert.equal((await move(a, 'INGRESO', 'socio-5')).statusCode, 201);
        assert.equal((await move(b, 'EGRESO', 'socio-5')).statusCode, 201);
        assert.equal(await read(), await repoA.ocupacion('sede-1'));
        assert.ok(a.ocupacionMetrics.errors > 0); assert.equal(a.ocupacionMetrics.invalidationErrors, before + 1);
      } finally { redis.resume(); }
      await pause(1100); assert.equal(await read(b), await repoA.ocupacion('sede-1'));
    });
    await t.test('Reinicio Redis rechaza ticket previo; reconexión recupera hit sin estado persistido viejo', async () => {
      const old = await aCache.lookup('sede-2'); await redis.restart();
      for (let n = 0; n < 80 && (!aCache.ready || !bCache.ready); n++) await pause(50);
      assert.ok(aCache.ready && bCache.ready);
      const fresh = await aCache.lookup('sede-2'); assert.notEqual(fresh.ticket.token, old.ticket.token);
      assert.equal(await aCache.store('sede-2', old.ticket, 77), false);
      assert.equal(await read(), await repoA.ocupacion('sede-1')); assert.equal(await read(b), await repoA.ocupacion('sede-1'));
    });
    await t.test('Redis ausente al iniciar permite leer MongoDB; fallo conjunto no inventa cero', async () => {
      await redis.halt();
      const absent = new cacheModule.RedisOcupacionCache({ url: redis.url, timeoutMs: 50 }); caches.push(absent); absent.start();
      try {
        const reader = new readers.OcupacionReader(sede => repoA.ocupacion(sede), absent);
        assert.equal(await reader.read('sede-1'), await repoA.ocupacion('sede-1'));
        assert.equal(reader.metrics.bypass, 1);
        const failing = new readers.OcupacionReader(async () => { throw new Error('Fuente no disponible'); }, absent);
        await assert.rejects(failing.read('sede-1'), /Fuente no disponible/);
      } finally { await absent.close(); await redis.restart(); }
    });
    await t.test('Autorización se ejecuta antes de consultar caché y métricas no contienen IDs personales', async () => {
      assert.equal((await a.inject('/api/v1/accesos/sedes/sede-1/ocupacion')).statusCode, 401);
      const user = a.jwt.sign({ sub: 'socio-privado', rol: 'SOCIO', iss: 'gimnasio', aud: 'gimnasio-web', iat: now, exp: now + 3600 });
      assert.equal((await a.inject({ url: '/api/v1/accesos/sedes/sede-1/ocupacion', headers: { authorization: 'Bearer ' + user } })).statusCode, 403);
      const metrics = (await a.inject('/metrics')).body; assert.match(metrics, /accesos_cache_hits_total/); assert.match(metrics, /accesos_occupancy_duration_seconds_bucket/);
      assert.equal(metrics.includes('socio-privado'), false);
    });
  } finally { for (const app of apps.reverse()) await app.close(); for (const c of caches) await c.close(); await redis?.close(); await mongo.close(); }
});
