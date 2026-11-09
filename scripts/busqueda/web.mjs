import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { postgresPrueba } from '../membresias/entorno.mjs';
import sociosModule from '../../services/socios-membresias/dist/app.js';
import sociosRepository from '../../services/socios-membresias/dist/repository.js';
import security from '../../services/socios-membresias/dist/security.js';
import clasesModule from '../../services/clases-reservas/dist/app.js';
import clasesRepository from '../../services/clases-reservas/dist/repository.js';
import busquedaModule from '../../services/clases-reservas/dist/busqueda-clases.postgres.js';
import sociosClient from '../../services/clases-reservas/dist/clients/socios.client.js';
import gestionModule from '../../services/clases-reservas/dist/gestion-clases.postgres.js';
import sedesClientModule from '../../services/clases-reservas/dist/clients/sedes.client.js';
import accesosModule from '../../services/accesos-ocupacion/dist/app.js';
import accesosRepos from '../../services/accesos-ocupacion/dist/repository.js';
import { entornoMongo } from '../cache/entorno.mjs';

// Recorrido manual aislado. Login, membresía, búsqueda y reservas usan sus APIs
// reales y bases temporales. Los fallos y demoras del proxy son deliberados.
const frontendRoot = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
await stat(resolve(frontendRoot, 'index.html'));
const environment = await postgresPrueba();
let mongo;
const apps = [];
let proxy, closePromise;
const close = () => closePromise ??= (async () => {
  if (proxy?.listening) {
    const stopped = new Promise(done => proxy.close(done));
    proxy.closeAllConnections();
    await stopped;
  }
  for (const app of apps) await app.close();
  await mongo?.close();
  await environment.close();
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
  mongo = await entornoMongo();
  const sociosPool = environment.pool('socios'), clasesPool = environment.pool('clases');
  const sociosRepo = new sociosRepository.PostgresSociosRepository(sociosPool);
  const clasesRepo = new clasesRepository.PostgresClaseRepository(clasesPool);
  await sociosRepo.inicializarEsquema();
  await clasesRepo.inicializarEsquema();
  const now = Date.now(), at = hours => new Date(now + hours * 3600000).toISOString();
  const login = { emailOrDni: 'socio-busqueda@example.invalid', password: 'clave-ficticia-busqueda-local' };
  const socioId = 'socio-busqueda-web';
  const adminLogin = { emailOrDni: 'admin-clases@example.invalid', password: 'clave-ficticia-admin-clases' };
  await sociosRepo.crearSocio({ socioId: 'admin-clases-web', dni: '90000889', nombre: 'ADMIN ficticio de clases',
    email: adminLogin.emailOrDni, passwordHash: security.hashPassword(adminLogin.password), rol: 'ADMIN',
    estado: 'ACTIVO', createdAt: at(0) });
  await sociosRepo.crearSocio({ socioId, dni: '90000888', nombre: 'Socio de prueba búsqueda',
    email: login.emailOrDni, passwordHash: security.hashPassword(login.password), rol: 'SOCIO',
    estado: 'ACTIVO', createdAt: at(0) });
  await sociosRepo.crearMembresia({ membresiaId: 'membresia-busqueda-web', socioId, tipoPlan: 'PRUEBA',
    fechaInicio: at(-1), fechaFin: at(24 * 40), estado: 'HABILITADA', createdAt: at(0), updatedAt: at(0) });
  await clasesPool.query('TRUNCATE lista_espera, reservas, clases CASCADE');
  for (let n = 1; n <= 121; n++) {
    const special = { 1: 'Yoga protegida', 2: 'Yoga completa', 117: 'Yoga recuperada fallo',
      119: 'Yoga respuesta lenta', 120: 'Pilates respuesta rápida', 121: 'Yoga frontera' };
    await clasesPool.query(`INSERT INTO clases(clase_id,nombre,actividad,profesor,sede_id,inicio,fin,capacidad,publicada)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)`, [
      'web-'+n, special[n] ?? 'Entrenamiento general '+n, n === 120 ? 'PILATES' : 'YOGA',
      n % 2 ? 'Ana Prueba' : 'Bruno Prueba', n % 2 ? 'sede-prueba' : 'sede-otra',
      at(24 + n / 60), at(25 + n / 60), n === 2 ? 1 : 3,
    ]);
  }
  await clasesPool.query("INSERT INTO reservas(reserva_id,clase_id,socio_id,estado) VALUES('web-ocupada','web-2','otra-persona','CONFIRMADA')");
  await clasesPool.query("INSERT INTO lista_espera(espera_id,clase_id,socio_id,orden,estado) VALUES('web-protegida','web-1','otra-persona',1,'PENDIENTE')");
  const auth = { jwtSecret: randomBytes(32).toString('hex'), internalApiKey: randomBytes(24).toString('hex') };
  const socios = sociosModule.buildSociosApp({ ...auth, repository: sociosRepo });
  apps.push(socios);
  await socios.listen({ host: '127.0.0.1', port: 0 });
  const sociosUrl = 'http://127.0.0.1:' + socios.server.address().port;
  const accesosRepo = new accesosRepos.MongoAccesosRepository(mongo.client);
  await accesosRepo.inicializar([{ sedeId: 'sede-prueba', nombre: 'Sede de prueba' }, { sedeId: 'sede-otra', nombre: 'Otra sede de prueba' }]);
  const accesos = accesosModule.buildAccesosApp({ ...auth, repository: accesosRepo,
    socios: { verificarHabilitacion: async () => { throw new Error('Movimientos fuera del fixture de clases.'); } } });
  apps.push(accesos);
  await accesos.listen({ host: '127.0.0.1', port: 0 });
  const accesosUrl = 'http://127.0.0.1:' + accesos.server.address().port;
  const clases = clasesModule.buildApp({ ...auth, apiKey: randomBytes(24).toString('hex'), repository: clasesRepo,
    buscador: new busquedaModule.PostgresBuscadorClases(clasesPool),
    gestionClases: new gestionModule.PostgresGestionClases(clasesPool),
    sedesClient: new sedesClientModule.HttpSedesClient(accesosUrl),
    sociosClient: new sociosClient.HttpSociosClient(sociosUrl, 2000, auth.internalApiKey) });
  apps.push(clases);
  await clases.listen({ host: '127.0.0.1', port: 0 });
  const clasesUrl = 'http://127.0.0.1:' + clases.server.address().port;
  let falloEmitido = false;
  let respuestaAltaPerdida = false;
  let carreraRetiroEjecutada = false;
  let respuestaRetiroPerdida = false;
  const retiros = [];
  const queries = [];
  proxy = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, 'http://fixture.invalid');
      if (url.pathname === '/__fixture/estado' && request.method === 'GET') {
        return json(response, 200, { fixture: true, falloEmitido, respuestaAltaPerdida, carreraRetiroEjecutada, respuestaRetiroPerdida, retiros, queries,
          clasesPublicadas: (await clasesPool.query("SELECT clase_id,nombre,version,inicio,fin FROM clases WHERE clase_id LIKE 'cla-%' ORDER BY clase_id")).rows,
          operaciones: (await clasesPool.query('SELECT clave,entrada,respuesta FROM clases_operaciones ORDER BY created_at')).rows,
          reservas: (await clasesPool.query('SELECT clase_id,estado FROM reservas WHERE socio_id=$1', [socioId])).rows,
          espera: (await clasesPool.query('SELECT espera_id,clase_id,estado,orden FROM lista_espera WHERE socio_id=$1 ORDER BY clase_id,orden', [socioId])).rows });
      }
      if (url.pathname === '/__fixture/cerrar' && request.method === 'POST') {
        json(response, 200, { cerrando: true });
        setImmediate(() => { void close().catch(error => { console.error(error.message); process.exitCode = 1; }); });
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        const catalogo = url.pathname === '/api/v1/catalogo/clases';
        const retiro = request.method === 'POST' && /^\/api\/v1\/clases\/[^/]+\/espera\/[^/]+\/retirar$/.test(url.pathname);
        if (retiro && url.pathname.startsWith('/api/v1/clases/web-1/') && !carreraRetiroEjecutada) {
          // Provoca el orden promoción -> retiro con el trabajador y APIs reales.
          carreraRetiroEjecutada = true;
          await clases.reservasService.procesarPendientes();
        }
        if (catalogo) {
          queries.push(Object.fromEntries(url.searchParams));
          if (url.searchParams.get('texto') === 'fallo' && !falloEmitido) {
            falloEmitido = true;
            return json(response, 503, { codigo: 'BUSQUEDA_NO_DISPONIBLE', mensaje: 'Fallo temporal deliberado del fixture.' });
          }
        }
        const clasesRoute = catalogo || url.pathname.startsWith('/api/v1/admin/clases') || url.pathname.startsWith('/api/v1/reservas') || url.pathname.startsWith('/api/v1/clases/');
        const accesosRoute = url.pathname.startsWith('/api/v1/accesos/');
        const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
        const headers = new Headers();
        for (const name of ['authorization', 'content-type', 'idempotency-key', 'traceparent']) {
          if (typeof request.headers[name] === 'string') headers.set(name, request.headers[name]);
        }
        const upstream = await fetch((clasesRoute ? clasesUrl : accesosRoute ? accesosUrl : sociosUrl) + url.pathname + url.search, {
          method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000),
        });
        const data = Buffer.from(await upstream.arrayBuffer());
        if (retiro) retiros.push({ ruta: url.pathname, status: upstream.status, resultado: JSON.parse(data.toString('utf8')) });
        if (retiro && url.pathname.startsWith('/api/v1/clases/web-2/') && upstream.status === 200 && !respuestaRetiroPerdida) {
          respuestaRetiroPerdida = true;
          response.destroy();
          return;
        }
        if (request.method === 'POST' && url.pathname === '/api/v1/admin/clases' && upstream.status === 201 && !respuestaAltaPerdida) {
          respuestaAltaPerdida = true;
          response.destroy();
          return;
        }
        if (catalogo && url.searchParams.get('texto') === 'lenta') await pause(2000);
        if (response.destroyed) return;
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
    })().catch(() => {
      if (!response.headersSent && !response.destroyed) json(response, 503, { codigo: 'FIXTURE_NO_DISPONIBLE', mensaje: 'El fixture no pudo completar la solicitud.' });
      else response.destroy();
    });
  });
  await new Promise((done, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', done); });
  console.log(JSON.stringify({ fixture: true, url: 'http://127.0.0.1:' + proxy.address().port, login, adminLogin,
    clases: 121, primeraClase: at(24 + 1 / 60), ultimaClase: at(24 + 121 / 60) }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void close().catch(error => { console.error(error.message); process.exitCode = 1; });
  });
} catch (error) {
  await close();
  throw error;
}
