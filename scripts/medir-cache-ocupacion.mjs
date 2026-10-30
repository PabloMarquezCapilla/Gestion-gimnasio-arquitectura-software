// Misma ruta HTTP y datos para línea base y comparación. No utiliza recursos existentes.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { cpus, totalmem, platform, arch, loadavg } from 'node:os';
import { execFileSync } from 'node:child_process';
import { entornoMongo } from './cache/entorno.mjs';
import access from '../services/accesos-ocupacion/dist/app.js';
import repos from '../services/accesos-ocupacion/dist/repository.js';

const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
if (!output) throw new Error('Indicar --output=archivo.json para conservar resultados.');
const e = await entornoMongo(); let app;
try {
  const sedes = Array.from({ length: 10 }, (_, i) => ({ sedeId: 'sede-' + i, nombre: 'Sede sintética ' + i }));
  const repo = new repos.MongoAccesosRepository(e.client); await repo.inicializar(sedes);
  // Fixture sintético de lectura, no historial importado ni operaciones de personas reales.
  for (const sede of sedes) {
    const docs = Array.from({ length: 10000 }, (_, i) => ({ _id: JSON.stringify([sede.sedeId, 'socio-' + i]), sedeId: sede.sedeId,
      socioId: 'socio-' + i, abierta: i % 10 < 3, revision: 1 }));
    await e.client.db().collection('presencias').insertMany(docs);
  }
  app = access.buildAccesosApp({ repository: repo, socios: { verificar: async () => { throw new Error('No se consulta membresía en una medición de lectura.'); } }, jwtSecret: 'ficticia-para-benchmark-'.repeat(3) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const token = app.jwt.sign({ sub: 'admin-prueba', rol: 'ADMIN', iss: 'gimnasio', aud: 'gimnasio-web', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
  const read = async i => {
    const r = await fetch(base + '/api/v1/accesos/sedes/sede-' + (i % 10) + '/ocupacion', { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
    const b = await r.json(); assert.equal(r.status, 200); assert.equal(b.ocupacion, 3000);
  };
  for (let i = 0; i < 100; i++) await read(i);
  const counts = { find: 0, aggregate: 0, getMore: 0 };
  const listener = event => { if (event.databaseName === 'cache_prueba' && event.commandName in counts) counts[event.commandName]++; };
  e.client.on('commandStarted', listener);
  const latencies = []; let next = 0; let errors = 0;
  const before = { cpu: process.cpuUsage(), memory: process.memoryUsage(), load: loadavg() }; const start = performance.now();
  await Promise.all(Array.from({ length: 20 }, async () => {
    for (;;) { const i = next++; if (i >= 2000) break; const t = performance.now();
      try { await read(i); } catch { errors++; } finally { latencies.push(performance.now() - t); }
    }
  }));
  const elapsedMs = performance.now() - start; e.client.off('commandStarted', listener);
  latencies.sort((a, b) => a - b); const p = q => latencies[Math.ceil(q * latencies.length) - 1];
  const result = {
    version: 1, scenario: 'sin-cache-original', fecha: new Date().toISOString(), commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    requests: 2000, concurrency: 20, warmup: 100, dataset: { sedes: 10, presencias: 100000, abiertasPorSede: 3000, distribution: 'round-robin uniforme, 30% abiertas por sede', syntheticReadFixture: true },
    endpoint: '/api/v1/accesos/sedes/{sedeId}/ocupacion', http: 'HTTP real directo a Accesos; JWT ADMIN; JSON completo; conexiones reutilizables; sin gateway',
    p50Ms: p(.50), p95Ms: p(.95), p99Ms: p(.99), elapsedMs, requestsPerSecond: 2000 / (elapsedMs / 1000), errors, mongoCommands: counts,
    indexes: await e.client.db().collection('presencias').listIndexes().toArray(),
    environment: { node: process.version, mongodb: (await e.client.db('admin').command({ buildInfo: 1 })).version, mode: e.mode,
      platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(),
      processCpuMicroseconds: process.cpuUsage(before.cpu), processMemoryBefore: before.memory, processMemoryAfter: process.memoryUsage(), hostLoadBefore: before.load, hostLoadAfter: loadavg() },
    limitations: 'Generador y servicios comparten host. Sin escrituras durante carga. Volumen/demanda sintéticos, no capacidad o necesidad de producción confirmada. MongoDB caliente después de 100 lecturas.'
  };
  await mkdir(dirname(resolve(output)), { recursive: true }); await writeFile(resolve(output), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ output, p50Ms: result.p50Ms, p95Ms: result.p95Ms, p99Ms: result.p99Ms, errors, mongoCommands: counts }));
  assert.equal(errors, 0);
} finally { await app?.close(); await e.close(); }
