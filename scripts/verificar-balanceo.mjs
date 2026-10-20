// Prueba de distribución y falla controlada; no es un benchmark de capacidad.
// Copia solo fuentes, genera sus propias claves y limpia únicamente su proyecto.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, copyFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const project = 'codex-balanceo-' + randomBytes(6).toString('hex');
const tempRoot = resolve(tmpdir());
const workspace = resolve(tempRoot, project);
const services = ['socios-membresias', 'clases-reservas', 'accesos-ocupacion', 'tienda', 'gateway'];
const keyNames = ['POSTGRES_ADMIN_PASSWORD', 'SOCIOS_DB_PASSWORD', 'CLASES_DB_PASSWORD',
  'MONGO_ROOT_PASSWORD', 'ACCESOS_DB_PASSWORD', 'MONGO_KEYFILE', 'RABBITMQ_PASSWORD',
  'CAPACIDAD_API_KEY', 'AUTH_JWT_SECRET', 'SERVICIOS_API_KEY', 'EMPLEADOS_API_KEY'];
const keys = Object.fromEntries(keyNames.map(key => [key, randomBytes(32).toString('hex')]));
const env = { ...process.env, ...keys, EMPLEADOS_ORIGEN_ID: 'grupo-ficticio-balanceo' };
let started = false;
let base;

async function run(command, args, cwd = workspace) {
  try {
    return (await exec(command, args, { cwd, env, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  } catch (error) {
    const detail = String(error.stderr || error.stdout || error.message).split('\n').slice(-25).join('\n');
    throw new Error(command + ' no completó la verificación: ' + detail);
  }
}
const composeArgs = ['compose', '--project-name', project, '--project-directory', workspace,
  '--env-file', resolve(workspace, '.env'), '-f', resolve(workspace, 'compose.yaml'), '-f', resolve(workspace, 'compose.verificacion.yaml')];
const compose = (...args) => run('docker', [...composeArgs, ...args]);
async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise((ok, fail) => server.close(error => error ? fail(error) : ok()));
  return port;
}
async function replicas() {
  const ids = (await compose('ps', '--quiet', 'clases-reservas')).split(/\r?\n/).filter(Boolean);
  const result = [];
  for (const id of ids) {
    const [container] = JSON.parse(await run('docker', ['inspect', id]));
    assert.equal(container.Config.Labels['com.docker.compose.project'], project);
    assert.equal(container.Config.Labels['com.docker.compose.service'], 'clases-reservas');
    result.push({ id, instancia: container.Config.Hostname });
  }
  return result;
}
async function request(path, { token, body } = {}) {
  try {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: {
      Connection: 'close', 'X-API-Key': keys.CAPACIDAD_API_KEY,
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(18000) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, instancia: response.headers.get('x-instance-id'),
      mock: response.headers.get('x-mock'), data };
  } catch { return { status: 'ERROR_RED', instancia: null, mock: null, data: null }; }
}
async function sample(count = 40) {
  const results = [];
  for (let i = 0; i < count; i += 8) {
    results.push(...await Promise.all(Array.from({ length: Math.min(8, count - i) }, () =>
      request('/api/v1/clases?sedeId=sede-demo-01'))));
  }
  return results;
}
function summary(results) {
  const byInstance = {}, byStatus = {};
  for (const result of results) {
    byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
    if (result.instancia) byInstance[result.instancia] = (byInstance[result.instancia] ?? 0) + 1;
  }
  return { solicitudes: results.length, estados: byStatus, instancias: byInstance };
}
function verifyReads(results, expected) {
  for (const result of results) {
    assert.equal(result.status, 200, 'La lectura no fue atendida correctamente');
    assert.equal(result.mock, null, 'La prueba debe usar PostgreSQL');
    assert.ok(expected.includes(result.instancia), 'La instancia debe pertenecer al proyecto temporal');
    assert.ok(Array.isArray(result.data?.items));
  }
}

try {
  await run('docker', ['info', '--format', '{{.ServerVersion}}'], root);
  await mkdir(workspace);
  const files = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], root)).split(/\r?\n/);
  for (const file of files) {
    // No copiar secretos, dependencias, compilados ni metadatos Git, aunque se versionaran por error.
    if (!file || /(^|\/)(node_modules|dist|\.git)(\/|$)/.test(file) || /(^|\/)\.env(?:\.|$)/.test(file)) continue;
    const source = resolve(root, file), target = resolve(workspace, file);
    assert.ok(source.startsWith(root + sep) && target.startsWith(workspace + sep));
    try { if (!(await stat(source)).isFile()) continue; } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
  env.GATEWAY_PORT = String(await freePort());
  base = 'http://127.0.0.1:' + env.GATEWAY_PORT;
  await writeFile(resolve(workspace, '.env'), [
    'GATEWAY_PORT=' + env.GATEWAY_PORT, 'EMPLEADOS_ORIGEN_ID=' + env.EMPLEADOS_ORIGEN_ID,
    ...keyNames.map(key => key + '=' + keys[key]), '',
  ].join('\n'), { mode: 0o600 });
  await writeFile(resolve(workspace, 'compose.verificacion.yaml'), 'services:\n' +
    services.map(service => '  ' + service + ':\n    image: ' + project + '-' + service + ':latest\n').join(''));
  console.log('[1/5] Construyendo e iniciando el proyecto temporal ' + project + '...');
  started = true;
  await compose('up', '--build', '--detach', '--wait', '--wait-timeout', '180');
  await compose('exec', '-T', 'gateway', 'nginx', '-t');
  const initial = await replicas();
  assert.equal(initial.length, 2, 'La configuración debe iniciar dos instancias');
  const gatewayId = await compose('ps', '--quiet', 'gateway');
  const gatewayStartedAt = await run('docker', ['inspect', '--format', '{{.State.StartedAt}}', gatewayId]);
  console.log('[2/5] Verificando distribución en las dos instancias...');
  const normal = await sample();
  verifyReads(normal, initial.map(r => r.instancia));
  assert.equal(Object.keys(summary(normal).instancias).length, 2, 'Ambas instancias deben recibir tráfico');

  // Validar sesiones y consistencia compartida a través del balanceador real.
  const classStart = new Date(Date.now() + 86400000).toISOString();
  const classEnd = new Date(Date.parse(classStart) + 3600000).toISOString();
  await compose('exec', '-T', 'postgres', 'psql', '-U', 'postgres', '-d', 'clases', '-v', 'ON_ERROR_STOP=1', '-c',
    "INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad,publicada) VALUES('balanceo-cupo','Prueba ficticia','sede-demo-01','" + classStart + "','" + classEnd + "',1,true)");
  const tokens = [];
  for (const dni of ['11111111', '22222222', '33333333']) {
    const login = await request('/api/v1/auth/login', { body: { emailOrDni: dni, password: 'socio123' } });
    assert.equal(login.status, 200); tokens.push(login.data.token);
  }
  const writes = await Promise.all(Array.from({ length: 12 }, (_, i) => request('/api/v1/reservas', {
    token: tokens[i % tokens.length], body: { claseId: 'balanceo-cupo' },
  })));
  assert.equal(writes.filter(r => r.status === 201).length, 1);
  assert.equal(writes.filter(r => r.status === 409).length, 11);
  const occupied = await request('/api/v1/clases/balanceo-cupo');
  assert.equal(occupied.data.cuposDisponibles, 0);

  console.log('[3/5] Deteniendo solo una réplica temporal y manteniendo consultas...');
  const stopping = run('docker', ['stop', '--time', '5', initial[0].id]);
  const during = await sample(24);
  await stopping;
  console.log('Durante detención: ' + JSON.stringify(summary(during)));
  const survivor = initial[1];
  const detectionStarted = Date.now();
  const detection = await sample(24);
  let degraded;
  const detectionDeadline = detectionStarted + 30000;
  do {
    degraded = await sample();
    if (degraded.every(r => r.status === 200 && r.instancia === survivor.instancia)) break;
    detection.push(...degraded);
    await pause(500);
  } while (Date.now() < detectionDeadline);
  const detectionMs = Date.now() - detectionStarted;
  console.log('Detección tras parada: ' + JSON.stringify(summary(detection)));
  console.log('Una réplica: ' + JSON.stringify(summary(degraded)));
  verifyReads(degraded, [survivor.instancia]);
  const details = await request('/api/v1/clases/balanceo-cupo');
  assert.equal(details.data.cuposDisponibles, 0, 'La reserva debe conservarse al quedar una sola réplica');

  console.log('[4/5] Reemplazando la réplica detenida sin reiniciar NGINX...');
  await run('docker', ['rm', initial[0].id]);
  await compose('up', '--detach', '--no-deps', '--no-recreate', '--scale', 'clases-reservas=2', '--wait', '--wait-timeout', '60', 'clases-reservas');
  const restored = await replicas();
  assert.equal(restored.length, 2);
  assert.ok(restored.some(r => r.id === survivor.id));
  assert.ok(restored.some(r => !initial.some(old => old.id === r.id)));
  let recovered;
  const recoveryTransition = [];
  const recoveryDeadline = Date.now() + 30000;
  do {
    recovered = await sample();
    if (recovered.every(r => r.status === 200 && restored.some(replica => replica.instancia === r.instancia))
      && Object.keys(summary(recovered).instancias).length === 2) break;
    recoveryTransition.push(...recovered);
    await pause(1000);
  } while (Date.now() < recoveryDeadline);
  verifyReads(recovered, restored.map(r => r.instancia));
  assert.equal(Object.keys(summary(recovered).instancias).length, 2, 'La nueva réplica debe reincorporarse al tráfico');
  assert.equal(await compose('ps', '--quiet', 'gateway'), gatewayId);
  assert.equal(await run('docker', ['inspect', '--format', '{{.State.StartedAt}}', gatewayId]), gatewayStartedAt);
  const logs = await compose('logs', '--no-color', '--no-log-prefix', 'gateway');
  const entries = logs.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const proxied = entries.filter(entry => entry.uri?.startsWith('/api/v1/clases') && entry.upstream_addr);
  assert.ok(new Set(proxied.map(entry => entry.upstream_addr)).size >= 2, 'Los logs deben identificar los upstreams');
  const report = { ejecutadoEn: new Date().toISOString(), configuracion: 'NGINX least_conn; 2 réplicas; PostgreSQL',
    normal: summary(normal), duranteDetencion: summary(during), deteccion: summary(detection),
    tiempoDeteccionYMuestreoMs: detectionMs, unaReplica: summary(degraded),
    transicionRecuperacion: summary(recoveryTransition), recuperacion: summary(recovered),
    escrituras: { intentos: 12, confirmadas: 1, conflictos: 11 },
    gatewayReiniciado: false, registrosProxy: proxied.length,
    reintentosObservados: proxied.filter(entry => entry.upstream_status?.includes(',')).length };
  console.log(JSON.stringify(report, null, 2));
  console.log('Balanceo verificado. Los valores son evidencia de este ensayo local, no una garantía de disponibilidad ni capacidad.');
} catch (error) {
  if (started) {
    const diagnostic = await compose('logs', '--no-color', '--no-log-prefix', '--tail', '35', 'gateway', 'clases-reservas')
      .catch(() => 'No se pudieron consultar los logs temporales.');
    console.error('Diagnóstico del ensayo temporal:\n' + diagnostic);
  }
  throw error;
} finally {
  console.log('[5/5] Retirando exclusivamente los recursos temporales de la prueba...');
  assert.ok(workspace.startsWith(tempRoot + sep) && basename(workspace) === project);
  if (started) {
    const volumes = (await run('docker', ['volume', 'ls', '--filter', 'label=com.docker.compose.project=' + project, '--format', '{{.Name}}'])).split(/\r?\n/).filter(Boolean);
    assert.ok(volumes.every(name => ['postgres-data', 'mongodb-data', 'rabbitmq-data'].some(suffix => name === project + '_' + suffix)));
    await compose('down', '--volumes');
    for (const service of services) {
      const name = project + '-' + service + ':latest';
      const exists = await exec('docker', ['image', 'inspect', name], { env, windowsHide: true }).then(() => true, () => false);
      if (exists) await run('docker', ['image', 'rm', name]);
    }
  }
  await rm(workspace, { recursive: true, force: true });
  console.log('Recursos de prueba retirados; .env, contenedores y volúmenes del grupo conservados.');
}
