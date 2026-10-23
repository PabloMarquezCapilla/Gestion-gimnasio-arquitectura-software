// Integración optativa: PostgreSQL exclusivo y efímero, HTTP real y dos instancias.
// No carga .env ni usa las bases/volúmenes del proyecto.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { Writable } from 'node:stream';
import { cpus, totalmem } from 'node:os';
import pg from 'pg';
import sociosModule from '../services/socios-membresias/dist/app.js';
import sociosRepository from '../services/socios-membresias/dist/repository.js';
import adminModule from '../services/socios-membresias/dist/crear-admin.js';
import clasesModule from '../services/clases-reservas/dist/app.js';
import clasesRepository from '../services/clases-reservas/dist/repository.js';
import sociosClientModule from '../services/clases-reservas/dist/clients/socios.client.js';
import { verificarVinculosCarCruds } from './verificar-vinculos-car-cruds.mjs';
import { verificarEvidenciasCarCruds } from './verificar-evidencias-car-cruds.mjs';

const container = 'codex-p4-pg-' + randomBytes(6).toString('hex');
const label = 'codex.verificacion=' + container;
const password = randomBytes(24).toString('hex');
const jwtSecret = randomBytes(32).toString('hex');
const internalApiKey = randomBytes(24).toString('hex');
const empleadosKey = randomBytes(24).toString('hex');
const empleadosCredenciales = [{ apiKey: empleadosKey, grupoId: 'grupo-ficticio-verificacion' }];
const auth = { jwtSecret, internalApiKey };
const pools = [];
const apps = [];
let created = false;
const logs = [];
let logBuffer = '';
const logStream = new Writable({ write(chunk, _encoding, callback) {
  logBuffer += chunk.toString();
  const lines = logBuffer.split('\n');
  logBuffer = lines.pop();
  for (const line of lines) if (line.trim()) logs.push(JSON.parse(line));
  callback();
} });
const logger = { level: 'info', stream: logStream };

function docker(args, env = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env },
  });
  if (result.status !== 0) throw new Error('Falló Docker: ' + (result.stderr || result.error?.message || 'sin detalle'));
  return result.stdout.trim();
}
function pool(database, port) {
  const result = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database,
    max: 20, connectionTimeoutMillis: 2000, statement_timeout: 4000, lock_timeout: 2500 });
  pools.push(result);
  return result;
}
async function request(base, path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + path, { method, headers: {
    Connection: 'close', // El ensayo reinicia servidores; no reutilizar sockets cerrados.
    ...(token ? { Authorization: 'Bearer ' + token } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...headers,
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json(), headers: response.headers };
}
async function startSocios(repository, port = 0) {
  const app = sociosModule.buildSociosApp({ ...auth, repository, empleadosCredenciales, logger });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port });
  return app;
}

try {
  docker(['run', '--detach', '--name', container, '--label', label,
    '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_PASSWORD', 'postgres:17-alpine'], { POSTGRES_PASSWORD: password });
  created = true;
  const published = docker(['port', container, '5432/tcp']);
  const port = Number(published.split(':').at(-1));
  assert.ok(Number.isInteger(port) && port > 0);
  const adminPool = pool('postgres', port);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await adminPool.query('SELECT 1'); ready = true; break; }
    catch { await pause(500); }
  }
  assert.ok(ready, 'PostgreSQL temporal no inició');
  await adminPool.query('CREATE DATABASE socios');
  await adminPool.query('CREATE DATABASE clases');
  const sociosPool = pool('socios', port);
  const clasesPool = pool('clases', port);
  const secondPool = pool('clases', port);
  const sociosRepo = new sociosRepository.PostgresSociosRepository(sociosPool);
  const secondSociosPool = pool('socios', port);
  const secondSociosRepo = new sociosRepository.PostgresSociosRepository(secondSociosPool);
  const repoA = new clasesRepository.PostgresClaseRepository(clasesPool);
  const repoB = new clasesRepository.PostgresClaseRepository(secondPool);
  await Promise.all([sociosRepo.inicializarEsquema(), secondSociosRepo.inicializarEsquema()]);
  await Promise.all([repoA.inicializarEsquema(), repoB.inicializarEsquema()]);
  assert.equal((await sociosPool.query("SELECT count(*)::int n FROM socios WHERE rol='ADMIN'")).rows[0].n, 0);
  const adminData = { dni: '90000001', nombre: 'Admin ficticio', email: 'admin@prueba.example', password: randomBytes(12).toString('hex') };
  const initialAdmin = await adminModule.crearAdministrador(sociosRepo, adminData);
  const storedHash = (await sociosRepo.obtenerSocio(initialAdmin.socioId)).passwordHash;
  await assert.rejects(adminModule.crearAdministrador(sociosRepo, { ...adminData, password: 'otra-clave-ficticia' }));
  assert.equal((await sociosRepo.obtenerSocio(initialAdmin.socioId)).passwordHash, storedHash);
  let sociosApp = await startSocios(sociosRepo);
  const sociosPort = sociosApp.server.address().port;
  const sociosUrl = 'http://127.0.0.1:' + sociosPort;
  const remote = new sociosClientModule.HttpSociosClient(sociosUrl, 500, internalApiKey);
  const replicas = [];
  for (const repository of [repoA, repoB]) {
    const app = clasesModule.buildApp({ ...auth, apiKey: 'externa-ficticia', repository, sociosClient: remote, logger });
    apps.push(app);
    await app.listen({ host: '127.0.0.1', port: 0 });
    replicas.push({ app, url: 'http://127.0.0.1:' + app.server.address().port });
  }
  async function login(emailOrDni, secret = 'socio123') {
    const result = await request(sociosUrl, '/api/v1/auth/login', { method: 'POST', body: { emailOrDni, password: secret } });
    assert.equal(result.status, 200);
    return result.body.token;
  }
  const adminToken = await login(adminData.email, adminData.password);
  await verificarVinculosCarCruds({
    repositoryA: sociosRepo, repositoryB: secondSociosRepo, pool: sociosPool, administradorId: initialAdmin.socioId,
  });
  await verificarEvidenciasCarCruds({
    repositoryA: sociosRepo, repositoryB: secondSociosRepo, pool: sociosPool, administradorId: initialAdmin.socioId,
  });

  // Capacidad externa: dos instancias de Socios, con pools independientes.
  let secondSociosApp = await startSocios(secondSociosRepo);
  const secondSociosPort = secondSociosApp.server.address().port;
  const secondSociosUrl = 'http://127.0.0.1:' + secondSociosPort;
  const employeePath = '/api/v1/integraciones/empleados';
  const employee = { empleadoExternoId: 'externo-pg-001', dni: '00888001', nombre: 'Persona Ficticia', email: 'externo.pg@example.invalid' };
  const employeePost = (base, body = employee, key = 'alta-pg-001') => request(base, employeePath, {
    method: 'POST', body, headers: { 'X-API-Key': empleadosKey, 'Idempotency-Key': key },
  });
  const repeated = await Promise.all(Array.from({ length: 20 }, (_, i) => employeePost(i % 2 ? sociosUrl : secondSociosUrl)));
  for (const result of repeated) {
    assert.equal(result.status, 201);
    assert.deepEqual(result.body, repeated[0].body);
    assert.equal(result.headers.get('x-mock'), null);
  }
  const externalAlta = repeated[0].body;
  const counts = await sociosPool.query(`SELECT
    (SELECT count(*)::int FROM socios WHERE dni=$1) socios,
    (SELECT count(*)::int FROM solicitudes_membresia WHERE socio_id=$2) solicitudes,
    (SELECT count(*)::int FROM empleados_externos WHERE socio_id=$2) referencias,
    (SELECT count(*)::int FROM altas_empleados_idempotencia WHERE solicitud_id=$3) respuestas`,
    [employee.dni, externalAlta.socioId, externalAlta.solicitudId]);
  assert.deepEqual(counts.rows[0], { socios: 1, solicitudes: 1, referencias: 1, respuestas: 1 });
  const externalSocio = await sociosRepo.obtenerSocio(externalAlta.socioId);
  assert.equal(externalSocio.rol, 'SOCIO');
  assert.equal(externalSocio.passwordHash, undefined);
  assert.deepEqual(await sociosRepo.obtenerMembresias(externalAlta.socioId), []);
  await secondSociosApp.close();
  secondSociosApp = await startSocios(new sociosRepository.PostgresSociosRepository(secondSociosPool), secondSociosPort);
  assert.deepEqual((await employeePost(secondSociosUrl)).body, externalAlta, 'Replay durable después de recrear la aplicación');
  const incompatible = await Promise.all([employeePost(sociosUrl, { ...employee, nombre: 'Cambio' }),
    employeePost(secondSociosUrl, { ...employee, empleadoExternoId: 'otro', dni: '00888002' }, 'otra-clave')]);
  assert.deepEqual(incompatible.map((r) => [r.status, r.body.codigo]), [[409, 'IDEMPOTENCIA_EN_CONFLICTO'], [409, 'EMAIL_EXISTENTE']]);
  const identityRace = await Promise.all([sociosUrl, secondSociosUrl].map((base, i) => employeePost(base,
    { ...employee, empleadoExternoId: 'race-' + i, dni: '0088810' + i, email: 'email-race@example.invalid' }, 'race-' + i)));
  assert.deepEqual(identityRace.map((r) => r.status).sort(), [201, 409]);
  assert.equal(identityRace.find((r) => r.status === 409).body.codigo, 'EMAIL_EXISTENTE');
  // Fallo provocado al final de la transacción: no debe quedar ningún alta parcial.
  await sociosPool.query(`CREATE FUNCTION fallo_alta_prueba() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.clave='fallo-atomico' THEN RAISE EXCEPTION 'fallo de prueba'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER fallo_alta_prueba BEFORE INSERT ON altas_empleados_idempotencia FOR EACH ROW EXECUTE FUNCTION fallo_alta_prueba()`);
  const rollbackEmployee = { ...employee, empleadoExternoId: 'fallo-pg', dni: '00888999', email: 'rollback@example.invalid' };
  assert.equal((await employeePost(sociosUrl, rollbackEmployee, 'fallo-atomico')).status, 500);
  const orphan = await sociosPool.query('SELECT socio_id FROM socios WHERE dni=$1', [rollbackEmployee.dni]);
  assert.equal(orphan.rowCount, 0);
  assert.equal((await sociosPool.query("SELECT 1 FROM empleados_externos WHERE empleado_externo_id='fallo-pg'")).rowCount, 0);
  assert.equal((await sociosPool.query("SELECT 1 FROM altas_empleados_idempotencia WHERE clave='fallo-atomico'")).rowCount, 0);
  await sociosPool.query('DROP TRIGGER fallo_alta_prueba ON altas_empleados_idempotencia; DROP FUNCTION fallo_alta_prueba()');
  const retried = await employeePost(secondSociosUrl, rollbackEmployee, 'fallo-atomico');
  assert.equal(retried.status, 201);
  assert.equal((await sociosPool.query('SELECT count(*)::int n FROM solicitudes_membresia WHERE socio_id=$1', [retried.body.socioId])).rows[0].n, 1);
  console.log('Empleados PostgreSQL + HTTP: 20 reintentos entre dos instancias, unicidad concurrente, replay después de reinicio, alta sin credenciales/membresía y rollback total verificados.');
  const tokens = await Promise.all(['11111111', '22222222', '33333333'].map((dni) => login(dni)));
  assert.equal((await request(sociosUrl, '/api/v1/auth/me')).status, 401);
  assert.equal((await request(sociosUrl, '/api/v1/socios/socio-demo-02', { token: tokens[0] })).status, 403);
  assert.equal((await request(sociosUrl, '/api/v1/socios', { method: 'POST', body: adminData })).status, 401);
  assert.equal((await request(sociosUrl, '/api/v1/socios', { method: 'POST', token: tokens[0], body: adminData })).status, 403);
  const account = { dni: '91000001', nombre: 'Sin membresía', email: 'nuevo@prueba.example', password: 'ficticia123' };
  const race = await Promise.all([account, { ...account, dni: '91000002', email: 'NUEVO@prueba.example' }].map((body) =>
    request(sociosUrl, '/api/v1/socios', { method: 'POST', token: adminToken, body })));
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  const alta = race.find((r) => r.status === 201).body;
  assert.equal(alta.membresia, null);
  assert.equal(alta.token, undefined);
  assert.equal((await sociosRepo.obtenerMembresias(alta.socio.socioId)).length, 0);
  assert.equal((await request(sociosUrl, `/api/v1/socios/${alta.socio.socioId}/membresias`, {
    method: 'POST', token: adminToken, body: { pagoConfirmado: true },
  })).status, 501);
  const future = new Date(Date.now() + 86400000).toISOString();
  await sociosRepo.crearMembresia({ membresiaId: 'renovacion-futura-prueba', socioId: 'socio-demo-01', tipoPlan: 'MENSUAL',
    fechaInicio: new Date(Date.now() + 86400000 * 40).toISOString(), fechaFin: '2027-12-31T23:59:59Z', estado: 'HABILITADA',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  assert.equal((await remote.verificarHabilitacion('socio-demo-01', new Date().toISOString())).habilitado, true);
  for (const claseId of ['pg-cupo', 'pg-espera']) {
    await clasesPool.query('INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad,publicada) VALUES($1,$1,$2,$3,$4,1,true)',
      [claseId, 'sede-ficticia', future, new Date(Date.parse(future) + 3600000).toISOString()]);
  }
  const book = (replica, claseId, i, wait = false) => request(replicas[replica].url, '/api/v1/reservas', {
    method: 'POST', token: tokens[i], body: { claseId, ingresarEsperaSiLlena: wait },
  });
  const competition = await Promise.all(Array.from({ length: 12 }, (_, i) => book(i % 2, 'pg-cupo', i % 3)));
  assert.equal(competition.filter((r) => r.status === 201).length, 1);
  assert.equal((await clasesPool.query("SELECT count(*)::int n FROM reservas WHERE clase_id='pg-cupo' AND estado='CONFIRMADA'")).rows[0].n, 1);
  const traceId = randomBytes(16).toString('hex');
  const parentSpan = randomBytes(8).toString('hex');
  const reserved = await request(replicas[0].url, '/api/v1/reservas', {
    method: 'POST', token: tokens[0], body: { claseId: 'pg-espera' },
    headers: { traceparent: `00-${traceId}-${parentSpan}-01` },
  });
  assert.equal(reserved.status, 201);
  assert.equal(reserved.headers.get('x-correlation-id'), traceId);
  const traceLogs = logs.filter((entry) => entry.trace_id === traceId);
  const root = traceLogs.find((entry) => entry.service === 'clases-reservas');
  const children = traceLogs.filter((entry) => entry.service === 'socios-membresias');
  assert.equal(root?.parent_span_id, parentSpan);
  assert.equal(children.length, 2, 'Verificación real de membresía actual y a fecha de clase');
  for (const entry of children) assert.equal(entry.parent_span_id, root.span_id);
  assert.ok(await repoB.obtenerReserva(reserved.body.reservaId), 'La traza debe terminar en una reserva persistida');
  console.log('Traza HTTP real + PostgreSQL:', JSON.stringify({ traceId,
    spans: [root, ...children].map(({ service, span_id, parent_span_id }) => ({ service, span_id, parent_span_id })),
    reservaPersistida: Boolean(await repoB.obtenerReserva(reserved.body.reservaId)),
  }));
  assert.equal((await book(1, 'pg-espera', 1, true)).status, 200);
  assert.equal((await book(0, 'pg-espera', 2, true)).status, 200);
  await sociosApp.close();
  const cancelled = await request(replicas[1].url, `/api/v1/reservas/${reserved.body.reservaId}/cancelar`, { method: 'POST', token: tokens[0] });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.reasignacionPendiente, true);
  await replicas[0].app.reservasService.procesarPendientes();
  assert.equal((await repoA.obtenerPrimerCandidato('pg-espera')).espera.socioId, 'socio-demo-02');
  sociosApp = await startSocios(sociosRepo, sociosPort);
  assert.equal((await book(0, 'pg-espera', 0)).status, 409, 'Una solicitud nueva no puede tomar el cupo retenido');
  await Promise.all(replicas.map(({ app }) => app.reservasService.procesarPendientes()));
  const confirmed = await clasesPool.query("SELECT socio_id FROM reservas WHERE clase_id='pg-espera' AND estado='CONFIRMADA'");
  assert.deepEqual(confirmed.rows, [{ socio_id: 'socio-demo-02' }]);
  const waiting = await clasesPool.query("SELECT socio_id FROM lista_espera WHERE clase_id='pg-espera' AND estado='PENDIENTE' ORDER BY orden");
  assert.deepEqual(waiting.rows, [{ socio_id: 'socio-demo-03' }]);
  // D13: línea base pequeña y reproducible; no calcula saturación ni capacidad máxima.
  for (let i = 0; i < 20; i++) assert.equal((await request(replicas[i % 2].url,
    '/api/v1/reservas/clases', { token: tokens[0] })).status, 200);
  const timings = [];
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: 10 }, async () => {
    while (next < 300) {
      const i = next++;
      const start = performance.now();
      const result = await request(replicas[i % 2].url, '/api/v1/reservas/clases', { token: tokens[0] });
      assert.equal(result.status, 200);
      timings.push(performance.now() - start);
    }
  }));
  const elapsed = performance.now() - started;
  timings.sort((a, b) => a - b);
  const percentile = (p) => Number(timings[Math.ceil(p * timings.length) - 1].toFixed(2));
  console.log('Carga local D13:', JSON.stringify({ ejecutadoEn: new Date().toISOString(),
    solicitudes: timings.length, concurrencia: 10, calentamiento: 20, errores: 0,
    replicasClases: 2, totalClases: (await clasesPool.query('SELECT count(*)::int n FROM clases')).rows[0].n,
    duracionMs: Number(elapsed.toFixed(2)), rps: Number((timings.length * 1000 / elapsed).toFixed(2)),
    mediaMs: Number((timings.reduce((a, b) => a + b, 0) / timings.length).toFixed(2)),
    p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    entorno: { node: process.version, plataforma: process.platform, cpu: cpus()[0]?.model,
      cpusLogicas: cpus().length, memoriaHostGiB: Number((totalmem() / 1024 ** 3).toFixed(1)) },
    alcance: 'HTTP directo, PostgreSQL temporal en Docker, datos ficticios, sin gateway ni proveedor',
  }));
  // La métrica debe reflejar el pool, incluyendo una conexión retenida deliberadamente.
  const held = await Promise.all([clasesPool.connect(), clasesPool.connect()]);
  try {
    assert.equal(repoA.conexionesActivas(), clasesPool.totalCount - clasesPool.idleCount);
    assert.ok(repoA.conexionesActivas() >= 2);
    const metrics = await (await fetch(replicas[0].url + '/metrics')).text();
    assert.match(metrics, new RegExp('pg_pool_active_connections\\{[^}]+\\} ' + repoA.conexionesActivas() + '(?:\\n|$)'));
  } finally { for (const client of held) client.release(); }
  console.log('PostgreSQL + HTTP real: bootstrap sin sobrescritura, JWT/permisos, alta sin membresía, email concurrente, renovación, último cupo y FIFO con caída/recuperación verificados en dos instancias.');
} finally {
  await Promise.allSettled(apps.map((app) => app.close()));
  await Promise.allSettled(pools.map((p) => p.end()));
  if (created) {
    const owned = docker(['inspect', '--format', '{{ index .Config.Labels "codex.verificacion" }}', container]);
    assert.equal(owned, container, 'Se conserva el contenedor si no se puede acreditar su propiedad');
    docker(['rm', '--force', container]);
  }
}
