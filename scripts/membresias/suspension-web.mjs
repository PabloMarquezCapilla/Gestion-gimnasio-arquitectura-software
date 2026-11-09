import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { connect } from 'amqplib';
import { postgresPrueba } from './entorno.mjs';
import sociosApps from '../../services/socios-membresias/dist/app.js';
import sociosRepos from '../../services/socios-membresias/dist/repository.js';
import gestion from '../../services/socios-membresias/dist/membresias.postgres.js';
import administradores from '../../services/socios-membresias/dist/crear-admin.js';
import eventos from '../../services/socios-membresias/dist/membresias.eventos.js';
import publicadores from '../../services/socios-membresias/dist/membresias.rabbit.js';
import clasesApps from '../../services/clases-reservas/dist/app.js';
import clasesRepos from '../../services/clases-reservas/dist/repository.js';
import buscadores from '../../services/clases-reservas/dist/busqueda-clases.postgres.js';
import clientes from '../../services/clases-reservas/dist/clients/socios.client.js';
import receptores from '../../services/clases-reservas/dist/membresias-eventos.postgres.js';
import serviciosEventos from '../../services/clases-reservas/dist/application/membresias-eventos.service.js';
import consumidores from '../../services/clases-reservas/dist/membresias-eventos.rabbit.js';

// Recorrido manual aislado con las aplicaciones, Outbox, RabbitMQ, Inbox y FIFO reales.
// Sólo el proxy interrumpe deliberadamente una respuesta después del commit.
const frontendRoot = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
await stat(resolve(frontendRoot, 'index.html'));
const environment = await postgresPrueba();
const rabbitId = 'pulse-eventos-web-' + randomUUID();
const apps = [], suspensiones = [];
let rabbitCreated = false, proxy, publisher, consumer, timer, active, closePromise;
let respuestaPerdida = false;
const docker = (args, env = {}) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true,
    timeout: 60000, env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Docker falló.');
  return result.stdout.trim();
};
const close = () => closePromise ??= (async () => {
  clearInterval(timer);
  await active;
  if (proxy?.listening) {
    const stopped = new Promise(done => proxy.close(done));
    proxy.closeAllConnections();
    await stopped;
  }
  await publisher?.cerrar();
  await consumer?.cerrar();
  for (const app of apps) await app.close();
  await environment.close();
  if (rabbitCreated) {
    assert.equal(docker(['inspect', '--format', '{{index .Config.Labels "pulse.eventos.test"}}', rabbitId]), rabbitId);
    docker(['rm', '--force', rabbitId]);
  }
})();
const json = (response, status, body) => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
};
const readBody = async request => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Cuerpo demasiado grande en el fixture.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};
try {
  const rabbitPassword = randomBytes(24).toString('hex');
  docker(['run', '--detach', '--name', rabbitId, '--label', 'pulse.eventos.test=' + rabbitId,
    '--publish', '127.0.0.1::5672', '--env', 'RABBITMQ_DEFAULT_USER=prueba',
    '--env', 'RABBITMQ_DEFAULT_PASS', 'rabbitmq:4.1-alpine'], { RABBITMQ_DEFAULT_PASS: rabbitPassword });
  rabbitCreated = true;
  const rabbitPort = Number(docker(['port', rabbitId, '5672/tcp']).split(':').at(-1));
  const rabbitUrl = 'amqp://prueba:' + rabbitPassword + '@127.0.0.1:' + rabbitPort;
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const connection = await connect(rabbitUrl, { timeout: 1000 });
      connection.on('error', () => {});
      await connection.close();
      ready = true;
      break;
    } catch { await pause(500); }
  }
  assert.ok(ready, 'RabbitMQ de prueba no inició.');
  const sociosPool = environment.pool('socios'), clasesPool = environment.pool('clases');
  const sociosRepo = new sociosRepos.PostgresSociosRepository(sociosPool);
  const clasesRepo = new clasesRepos.PostgresClaseRepository(clasesPool);
  await sociosRepo.inicializarEsquema();
  await clasesRepo.inicializarEsquema();
  const adminLogin = { emailOrDni: 'admin-suspension@example.invalid', password: 'clave-ficticia-suspension' };
  const admin = await administradores.crearAdministrador(sociosRepo, { dni: '90000900',
    nombre: 'ADMIN ficticio de suspensión', email: adminLogin.emailOrDni, password: adminLogin.password });
  const auth = { jwtSecret: randomBytes(32).toString('hex'), internalApiKey: randomBytes(24).toString('hex') };
  const socios = sociosApps.buildSociosApp({ ...auth, repository: sociosRepo,
    gestion: new gestion.PostgresGestionMembresias(sociosPool) });
  apps.push(socios);
  await socios.listen({ host: '127.0.0.1', port: 0 });
  const sociosUrl = 'http://127.0.0.1:' + socios.server.address().port;
  const api = async (path, body, token, method = 'POST') => {
    const response = await fetch(sociosUrl + path, { method, headers: {
      ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const token = (await api('/api/v1/auth/login', adminLogin)).token;
  const plan = await api('/api/v1/planes', { nombre: 'Plan ficticio suspensión', importeMinor: 150000, moneda: 'ARS' }, token);
  const at = hours => new Date(Date.now() + hours * 3600000).toISOString();
  const personas = [];
  for (const [index, nombre] of ['Suspensión normal', 'Suspensión incierta', 'Espera habilitada'].entries()) {
    const login = { emailOrDni: 'suspension-' + index + '@example.invalid', password: 'clave-ficticia-socio' };
    const persona = (await api('/api/v1/socios', { dni: '9000091' + index, nombre,
      email: login.emailOrDni, password: login.password }, token)).socio;
    const solicitud = await api('/api/v1/socios/' + persona.socioId + '/solicitudes', {
      planId: plan.planId, fechaInicio: at(-24), fechaFin: at(24 * 30),
    }, token);
    const registrado = await api('/api/v1/solicitudes/' + solicitud.solicitudId + '/pagos', {
      referencia: 'fixture-suspension-' + index, importeMinor: plan.importeMinor, moneda: plan.moneda,
    }, token);
    const confirmado = await api('/api/v1/pagos/' + registrado.pago.pagoId + '/confirmar', {}, token);
    personas.push({ ...persona, login, membresiaId: confirmado.comprobante.membresiaId });
  }
  await sociosRepo.crearMembresia({ membresiaId: 'mem-historica-web', socioId: personas[0].socioId,
    tipoPlan: 'Período histórico ficticio', fechaInicio: at(-24 * 60), fechaFin: at(-24 * 30),
    estado: 'VENCIDA', createdAt: at(-24 * 60), updatedAt: at(-24 * 30) });
  await clasesPool.query('TRUNCATE lista_espera, reservas, clases CASCADE');
  const clases = clasesApps.buildApp({ ...auth, apiKey: randomBytes(24).toString('hex'), repository: clasesRepo,
    buscador: new buscadores.PostgresBuscadorClases(clasesPool),
    sociosClient: new clientes.HttpSociosClient(sociosUrl, 3000, auth.internalApiKey) });
  apps.push(clases);
  await clases.listen({ host: '127.0.0.1', port: 0 });
  const clasesUrl = 'http://127.0.0.1:' + clases.server.address().port;
  for (const [index, nombre] of ['Suspensión panel', 'Suspensión respuesta incierta'].entries()) {
    const claseId = 'suspension-web-' + index;
    await clasesPool.query(`INSERT INTO clases(clase_id,nombre,actividad,profesor,sede_id,inicio,fin,capacidad,publicada)
      VALUES($1,$2,'YOGA','Docente ficticio','sede-demo-01',$3,$4,1,true)`, [claseId, nombre, at(24), at(25)]);
    assert.ok((await clases.reservasService.reservar(claseId, personas[index].socioId)).exito);
    assert.ok((await clases.reservasService.ingresarEspera(claseId, personas[2].socioId)).exito);
  }
  const logger = { info: () => {}, warn: () => {} };
  publisher = new publicadores.PublicadorMembresias(rabbitUrl, new eventos.PostgresMembresiasOutbox(sociosPool), logger);
  consumer = new consumidores.ConsumidorMembresias(rabbitUrl,
    new serviciosEventos.MembresiasEventosService(new receptores.PostgresMembresiasEventos(clasesPool)), logger);
  publisher.iniciar();
  consumer.iniciar();
  timer = setInterval(() => {
    if (!active) active = clases.reservasService.procesarPendientes()
      .catch(error => console.error('FIFO de prueba falló', error.message)).finally(() => { active = undefined; });
  }, 500);
  proxy = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, 'http://fixture.invalid');
      if (url.pathname === '/__fixture/estado' && request.method === 'GET') {
        return json(response, 200, { fixture: true, respuestaPerdida, suspensiones,
          membresias: (await sociosPool.query('SELECT membresia_id,socio_id,estado,fecha_inicio,fecha_fin FROM membresias WHERE socio_id=ANY($1) ORDER BY membresia_id', [personas.map(p => p.socioId)])).rows,
          outbox: (await sociosPool.query('SELECT event_id,membresia_id,publicado_en FROM membresias_outbox')).rows,
          inbox: (await clasesPool.query('SELECT event_id,canceladas FROM membresias_inbox')).rows,
          reservas: (await clasesPool.query('SELECT clase_id,socio_id,estado FROM reservas ORDER BY clase_id,created_at')).rows,
          espera: (await clasesPool.query('SELECT clase_id,socio_id,orden,estado FROM lista_espera')).rows,
          comprobantes: (await sociosPool.query('SELECT comprobante_id,membresia_id FROM comprobantes_membresia')).rows,
        });
      }
      if (url.pathname === '/__fixture/cerrar' && request.method === 'POST') {
        json(response, 200, { cerrando: true });
        setImmediate(() => { void close().catch(error => { console.error(error.message); process.exitCode = 1; }); });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const headers = new Headers();
        for (const name of ['authorization', 'content-type', 'idempotency-key', 'traceparent']) {
          if (typeof request.headers[name] === 'string') headers.set(name, request.headers[name]);
        }
        const clasesRoute = /^\/api\/v1\/(catalogo\/clases|reservas|clases)/.test(url.pathname);
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
        const upstream = await fetch((clasesRoute ? clasesUrl : sociosUrl) + url.pathname + url.search,
          { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000) });
        const data = Buffer.from(await upstream.arrayBuffer());
        if (request.method === 'POST' && url.pathname.endsWith('/suspender')) {
          suspensiones.push({ ruta: url.pathname, clave: request.headers['idempotency-key'],
            status: upstream.status, resultado: JSON.parse(data.toString('utf8')) });
          if (url.pathname.includes(personas[1].membresiaId) && upstream.status === 200 && !respuestaPerdida) {
            respuestaPerdida = true;
            response.destroy();
            return;
          }
        }
        response.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(data);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { codigo: 'METODO_NO_ADMITIDO' });
      let target = resolve(frontendRoot, '.' + decodeURIComponent(url.pathname));
      const child = relative(frontendRoot, target);
      if (child.startsWith('..') || isAbsolute(child)) return json(response, 404, { codigo: 'NO_ENCONTRADO' });
      try { if (!(await stat(target)).isFile()) target = resolve(frontendRoot, 'index.html'); }
      catch { target = resolve(frontendRoot, 'index.html'); }
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
      response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(target));
    })().catch(error => {
      console.error('Solicitud del fixture falló', error.message);
      if (!response.headersSent && !response.destroyed) json(response, 503, { codigo: 'FIXTURE_NO_DISPONIBLE' });
      else response.destroy();
    });
  });
  await new Promise((done, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', done); });
  console.log(JSON.stringify({ fixture: true, url: 'http://127.0.0.1:' + proxy.address().port,
    adminLogin, adminId: admin.socioId, personas: personas.map(p => ({ nombre: p.nombre, socioId: p.socioId,
      membresiaId: p.membresiaId, login: p.login })) }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void close().catch(error => { console.error(error.message); process.exitCode = 1; });
  });
} catch (error) {
  await close();
  throw error;
}
