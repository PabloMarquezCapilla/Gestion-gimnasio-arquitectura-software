// MongoDB REAL exclusivo. No carga .env, no usa bases/volúmenes existentes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { MongoClient } from 'mongodb';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import access from '../services/accesos-ocupacion/dist/app.js';
import repositories from '../services/accesos-ocupacion/dist/repository.js';
import sociosModule from '../services/socios-membresias/dist/app.js';
import sociosRepoModule from '../services/socios-membresias/dist/repository.js';
import security from '../services/socios-membresias/dist/security.js';
import sociosClient from '../services/accesos-ocupacion/dist/socios.client.js';

async function freePort() {
  const s = createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
  const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 10000);
  try { await ended; } finally { clearTimeout(timer); }
}
function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Docker no disponible o falló un recurso temporal: ' + (r.error?.message ?? r.stderr));
  return r.stdout.trim();
}

test('Accesos: MongoDB real, HTTP, concurrencia, recuperación y seguridad', { timeout: 120000 }, async t => {
  const contract = parse(await readFile(resolve('docs/contracts/openapi-accesos-v1.yaml'), 'utf8'));
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
  const validarMovimiento = ajv.compile({ ...contract.components.schemas.Resultado, components: contract.components });
  const id = 'gimnasio-accesos-test-' + randomBytes(6).toString('hex');
  const temporary = await mkdtemp(join(tmpdir(), id + '-'));
  await writeFile(join(temporary, 'propietario'), id);
  const mode = process.env.ACCESOS_TEST_MODE ?? 'docker';
  const port = await freePort(); const uri = `mongodb://127.0.0.1:${port}/accesos_prueba?directConnection=true&replicaSet=rs0`;
  let mongod; let created = false; let servidor;
  const apps = []; const clients = [];
  const jwtSecret = randomBytes(32).toString('hex'); const internalApiKey = randomBytes(24).toString('hex');
  let client;
  const startMongo = () => {
    mongod = spawn(process.env.MONGOD_BIN ?? 'mongod', ['--dbpath', temporary, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'rs0', '--logpath', join(temporary, 'mongod.log'), '--logappend'], { stdio: 'ignore' });
    mongod.on('error', () => {});
  };
  const connect = async () => {
    const c = new MongoClient(uri, { serverSelectionTimeoutMS: 500, connectTimeoutMS: 500, timeoutMS: 10000 }); clients.push(c);
    for (let attempt = 0; attempt < 80; attempt++) {
      try { await c.connect(); return c; } catch { await pause(100); }
    }
    throw new Error('No inició el MongoDB temporal.');
  };
  const sedes = [{ sedeId: 'sede-1', nombre: 'Sede ficticia 1' }, { sedeId: 'sede-2', nombre: 'Sede ficticia 2' }];
  const request = async (base, path, { token, body, clave, method = body ? 'POST' : 'GET' } = {}) => {
    const r = await fetch(base + path, { method, signal: AbortSignal.timeout(15000), headers: {
      Connection: 'close', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(clave ? { 'Idempotency-Key': clave } : {}), traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01',
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json(), headers: r.headers };
  };
  try {
    if (mode === 'native') startMongo();
    else if (mode === 'docker') {
      docker(['run', '--detach', '--name', id, '--label', 'gimnasio.accesos.test=' + id, '--tmpfs', '/data/db',
        '--publish', `127.0.0.1:${port}:27017`, 'mongo:8.0', '--replSet', 'rs0', '--bind_ip_all']); created = true;
    } else throw new Error('ACCESOS_TEST_MODE debe ser docker o native.');
    client = await connect();
    await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: mode === 'native' ? '127.0.0.1:' + port : '127.0.0.1:27017' }] } });
    for (let n = 0; n < 100; n++) {
      if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      await pause(100);
    }
    const repoA = new repositories.MongoAccesosRepository(client);
    await repoA.inicializar(sedes);
    const clientB = new MongoClient(uri, { serverSelectionTimeoutMS: 500, timeoutMS: 10000 }); clients.push(clientB); await clientB.connect();
    const repoB = new repositories.MongoAccesosRepository(clientB); await repoB.inicializar(sedes);
    const sociosRepository = new sociosRepoModule.MemorySociosRepository();
    const admin = { socioId: 'admin-recepcion', dni: '90000123', nombre: 'Admin ficticio', email: 'recepcion@example.invalid',
      passwordHash: security.hashPassword('clave-solo-ficticia'), rol: 'ADMIN', estado: 'ACTIVO', createdAt: new Date().toISOString() };
    await sociosRepository.crearSocio(admin);
    const socios = sociosModule.buildSociosApp({ repository: sociosRepository, jwtSecret, internalApiKey }); apps.push(socios);
    await socios.listen({ host: '127.0.0.1', port: 0 });
    const sociosUrl = 'http://127.0.0.1:' + socios.server.address().port;
    const login = await request(sociosUrl, '/api/v1/auth/login', { body: { emailOrDni: admin.email, password: 'clave-solo-ficticia' } });
    assert.equal(login.status, 200); const token = login.body.token;
    const startApp = async repo => {
      const app = access.buildAccesosApp({ repository: repo, socios: new sociosClient.HttpSociosClient(sociosUrl, internalApiKey, 500), jwtSecret });
      apps.push(app); await app.listen({ host: '127.0.0.1', port: 0 }); return 'http://127.0.0.1:' + app.server.address().port;
    };
    const a = await startApp(repoA); const b = await startApp(repoB);
    let next = 0;
    const move = async (socioId, tipo = 'INGRESO', clave = 'movimiento-' + (++next), sedeId = 'sede-1', base = a) => {
      const r = await request(base, '/api/v1/accesos/movimientos', { token, clave, body: { socioId, tipo, sedeId } });
      if (r.body.movimiento) assert.ok(validarMovimiento(r.body), JSON.stringify(validarMovimiento.errors));
      return r;
    };
    const occupancy = async (sede = 'sede-1') => (await request(a, '/api/v1/accesos/sedes/' + sede + '/ocupacion', { token })).body.ocupacion;

    await t.test('CA-G05: ingreso habilitado persiste presencia y movimiento', async () => {
      const r = await move('socio-demo-01'); assert.equal(r.status, 201); assert.equal(r.body.movimiento.aceptado, true);
      assert.equal(await occupancy(), 1); assert.equal(r.headers.get('x-correlation-id'), 'a'.repeat(32));
      assert.equal(await client.db().collection('movimientos').countDocuments(), 1);
    });
    await t.test('Inhabilitado e ingreso repetido quedan en historial sin incrementar ocupación', async () => {
      assert.equal((await move('socio-demo-01')).status, 409);
      assert.equal((await move('socio-suspendido-01')).status, 422);
      assert.equal((await move('socio-vencido-01')).status, 422);
      assert.equal((await move('inexistente')).status, 422);
      assert.equal(await occupancy(), 1);
    });
    await t.test('Dos clientes/réplicas: 20 ingresos concurrentes de la misma persona aceptan exactamente uno', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => move('socio-demo-02', 'INGRESO', 'concurrente-' + i, 'sede-1', i % 2 ? a : b)));
      assert.equal(results.filter(r => r.status === 201).length, 1);
      assert.equal(results.filter(r => r.status === 409).length, 19); assert.equal(await occupancy(), 2);
    });
    await t.test('CA-G06: egresos concurrentes cierran una sola presencia y nunca producen negativos', async () => {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => move('socio-demo-02', 'EGRESO', 'salida-concurrente-' + i, 'sede-1', i % 2 ? a : b)));
      assert.equal(results.filter(r => r.status === 201).length, 1);
      assert.equal(results.filter(r => r.status === 409).length, 19); assert.equal(await occupancy(), 1);
      assert.equal((await move('socio-demo-02', 'EGRESO')).body.movimiento.codigo, 'SIN_INGRESO_ABIERTO');
    });
    await t.test('Repetición concurrente conserva resultado único; replay tardío no reabre tras egreso', async () => {
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => move('socio-demo-03', 'INGRESO', 'replay-durable', 'sede-1', i % 2 ? a : b)));
      assert.ok(results.every(r => r.status === 201)); assert.ok(results.every(r => r.body.movimiento.movimientoId === results[0].body.movimiento.movimientoId));
      assert.equal(await client.db().collection('operaciones').countDocuments({ _id: JSON.stringify([admin.socioId, 'replay-durable']) }), 1);
      assert.equal((await move('socio-demo-03', 'EGRESO')).status, 201);
      assert.deepEqual((await move('socio-demo-03', 'INGRESO', 'replay-durable')).body, results[0].body);
      assert.equal(await occupancy(), 1);
      assert.equal((await move('socio-demo-02', 'INGRESO', 'replay-durable')).body.codigo, 'IDEMPOTENCIA_EN_CONFLICTO');
    });
    await t.test('Misma clave simultánea con cuerpos distintos no aplica ambos', async () => {
      const results = await Promise.all([move('socio-demo-02', 'INGRESO', 'clave-en-conflicto', 'sede-2', a), move('socio-demo-03', 'INGRESO', 'clave-en-conflicto', 'sede-2', b)]);
      assert.deepEqual(results.map(r => r.status).sort(), [201, 409]); assert.equal(await occupancy('sede-2'), 1);
    });
    await t.test('CA-G07: ocupación derivada por sede coincide exactamente con presencias abiertas', async () => {
      for (const sede of sedes) {
        const expected = await client.db().collection('presencias').countDocuments({ sedeId: sede.sedeId, abierta: true });
        assert.equal(await occupancy(sede.sedeId), expected);
      }
    });
    await t.test('Fallo al guardar idempotencia revierte movimiento y presencia (transacción real)', async () => {
      const denied = JSON.stringify([admin.socioId, 'rollback-ficticio']);
      await client.db().command({ collMod: 'operaciones', validator: { _id: { $ne: denied } }, validationLevel: 'strict', validationAction: 'error' });
      try {
        const r = await move('socio-demo-03', 'INGRESO', 'rollback-ficticio'); assert.equal(r.status, 503);
        assert.equal(await client.db().collection('movimientos').countDocuments({ _id: denied }), 0);
        assert.equal(await client.db().collection('presencias').countDocuments({ sedeId: 'sede-1', socioId: 'socio-demo-03', abierta: true }), 0);
      } finally { await client.db().command({ collMod: 'operaciones', validator: {} }); }
      assert.equal((await move('socio-demo-03', 'INGRESO', 'rollback-ficticio')).status, 201);
    });
    await t.test('Historial paginado y filtros; sede inexistente y permisos de API', async () => {
      const h = await request(a, '/api/v1/accesos/movimientos?sedeId=sede-1&tamanio=5&pagina=1', { token });
      assert.equal(h.status, 200); assert.equal(h.body.items.length, 5);
      assert.equal((await request(a, '/api/v1/accesos/sedes')).status, 401);
      const socioToken = (await request(sociosUrl, '/api/v1/auth/login', { body: { emailOrDni: '11111111', password: 'socio123' } })).body.token;
      assert.equal((await request(a, '/api/v1/accesos/sedes', { token: socioToken })).status, 403);
      assert.equal((await move('socio-demo-01', 'INGRESO', 'sede-invalida', 'ausente')).status, 404);
      const filtered = await request(a, '/api/v1/accesos/movimientos?sedeId=sede-1&socioId=socio-demo-01', { token });
      assert.ok(filtered.body.items.every(m => m.socioId === 'socio-demo-01'));
    });
    await t.test('Reinicio de proceso real Accesos conserva datos y replay', async () => {
      const servicePort = await freePort(); const base = 'http://127.0.0.1:' + servicePort;
      const startServer = async () => {
        servidor = spawn(process.execPath, [resolve('services/accesos-ocupacion/dist/server.js')], { stdio: 'ignore', env: {
          ...process.env, NODE_ENV: 'production', PORT: String(servicePort), MONGODB_URL: uri, AUTH_JWT_SECRET: jwtSecret,
          AUTH_JWT_TTL_SECONDS: '3600', SERVICIOS_API_KEY: internalApiKey, SOCIOS_SERVICE_URL: sociosUrl, ACCESOS_SEDES_JSON: JSON.stringify(sedes),
        } });
        for (let n = 0; n < 80; n++) {
          try { if ((await request(base, '/health')).status === 200) return; } catch {}
          if (servidor.exitCode !== null) throw new Error('No inició Accesos temporal.'); await pause(100);
        }
        throw new Error('Accesos no respondió.');
      };
      await startServer();
      const before = await request(base, '/api/v1/accesos/sedes/sede-1/ocupacion', { token });
      await stop(servidor); await startServer();
      assert.deepEqual((await request(base, '/api/v1/accesos/sedes/sede-1/ocupacion', { token })).body.ocupacion, before.body.ocupacion);
      assert.equal((await move('socio-demo-03', 'INGRESO', 'replay-durable', 'sede-1', base)).status, 201);
      await stop(servidor); servidor = undefined;
    });
    if (process.env.ACCESOS_PLAYWRIGHT_MODULE && process.env.NGINX_BIN && process.env.NGINX_MIME_TYPES) {
      await t.test('Frontend y gateway reales con respuesta perdida y reanudación', { timeout: 60000 }, async () => {
        const { verificarAccesosWeb } = await import('./verificar-accesos-web.mjs');
        await verificarAccesosWeb({ temporary, accesosUrl: a, sociosUrl, email: admin.email, password: 'clave-solo-ficticia' });
      });
    }
    await t.test('Socios caído: ingreso sin efecto; egreso y replay siguen operativos', async () => {
      await socios.close();
      const before = await occupancy();
      assert.equal((await move('socio-demo-02')).status, 503); assert.equal(await occupancy(), before);
      assert.equal((await move('socio-demo-01', 'EGRESO')).status, 201);
      assert.equal((await move('socio-demo-03', 'INGRESO', 'replay-durable')).status, 201);
    });
    await t.test('MongoDB indisponible: salud/operaciones fallan con 503 y sin detalle sensible', async () => {
      await clientB.close();
      assert.equal((await request(b, '/health')).status, 503);
      const r = await request(b, '/api/v1/accesos/sedes/sede-1/ocupacion', { token });
      assert.equal(r.status, 503); assert.equal(r.body.codigo, 'ALMACENAMIENTO_NO_DISPONIBLE'); assert.equal(JSON.stringify(r.body).includes(uri), false);
    });
    await t.test('Caída real del motor y recuperación conservan historial y ocupación', async () => {
      const before = await client.db().collection('movimientos').countDocuments();
      const count = await occupancy();
      if (mode === 'native') await stop(mongod);
      else {
        assert.equal(docker(['inspect', '--format', '{{index .Config.Labels "gimnasio.accesos.test"}}', id]), id);
        docker(['pause', id]);
      }
      try {
        assert.equal((await request(a, '/health')).status, 503);
        const r = await move('socio-demo-03', 'EGRESO', 'durante-caida'); assert.equal(r.status, 503);
      } finally {
        if (mode === 'native') startMongo(); else docker(['unpause', id]);
      }
      for (let n = 0; n < 80; n++) {
        try { if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break; } catch {}
        await pause(100);
      }
      assert.equal(await occupancy(), count);
      assert.equal(await client.db().collection('movimientos').countDocuments(), before);
      assert.equal((await move('socio-demo-03', 'EGRESO', 'durante-caida')).status, 201);
    });
    console.log('MongoDB real: ' + (await client.db('admin').command({ buildInfo: 1 })).version + '; Node ' + process.version + '; modo ' + mode);
    console.log('Dependencia Socios: implementación HTTP real con repositorio de fixture en memoria; no acredita PostgreSQL.');
  } finally {
    await stop(servidor);
    for (const app of apps.reverse()) await app.close();
    for (const c of clients) await c.close();
    if (mode === 'native') await stop(mongod);
    if (mode === 'docker') {
      const inspected = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "gimnasio.accesos.test"}}', id], { encoding: 'utf8' });
      if (inspected.status === 0) {
        if (inspected.stdout.trim() !== id) throw new Error('No se elimina un contenedor sin identidad de esta prueba.');
        docker(['rm', '--force', id]);
      } else if (created) throw new Error('No se pudo verificar el contenedor temporal; limpieza pendiente.');
    }
    if (await readFile(join(temporary, 'propietario'), 'utf8') !== id) throw new Error('No se elimina un directorio sin identidad de esta prueba.');
    await rm(temporary, { recursive: true });
  }
});
