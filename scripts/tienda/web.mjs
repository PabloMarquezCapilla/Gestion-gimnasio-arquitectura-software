import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import appModule from '../../services/tienda/dist/app.js';
import repositoryModule from '../../services/tienda/dist/stock.postgres.js';
import { postgresTiendaPrueba } from './entorno.mjs';

// Fixture manual de navegador, no un servidor desplegable del gimnasio.
// Solo el login es sintético: Tienda, sus rutas y PostgreSQL son reales.
// No lee .env, crea cuentas productivas ni llama a FAV/Socios.
export async function iniciarTiendaWebPrueba({ perderPrimeraVenta = true } = {}) {
  const frontendRoot = fileURLToPath(new URL('../../frontend/dist/', import.meta.url));
  await stat(resolve(frontendRoot, 'index.html'));
  const environment = await postgresTiendaPrueba();
  const jwtSecret = randomBytes(32).toString('hex');
  const favApiKey = randomBytes(32).toString('hex');
  const account = {
    socioId: 'admin-tienda-navegador-sintetico', dni: '90000999',
    nombre: 'ADMIN de fixture Tienda', email: 'admin-tienda-web@example.invalid',
    rol: 'ADMIN', estado: 'ACTIVO', createdAt: new Date().toISOString(), membresia: null,
  };
  const password = 'clave-sintetica-solo-fixture-tienda';
  const productoCodigo = 'var-tienda-web-sintetica';
  const pool = environment.pool();
  const repository = new repositoryModule.PostgresTiendaStockRepository(pool);
  let app, proxy, closePromise;
  let responseLost = false;
  const sales = [];

  const close = () => closePromise ??= (async () => {
    if (proxy?.listening) {
      const stopped = new Promise(done => proxy.close(done));
      proxy.closeAllConnections();
      await stopped;
    }
    await app?.close();
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
      if (size > 1024 * 1024) throw new Error('Cuerpo del fixture demasiado grande.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  };

  try {
    await repository.inicializarEsquema();
    app = appModule.buildTiendaApp({ jwtSecret, favApiKey, stockRepository: repository });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const upstreamBase = 'http://127.0.0.1:' + app.server.address().port;
    const seeded = await fetch(upstreamBase + '/api/v1/consignaciones/reposiciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': favApiKey, 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ proveedorId: 'fav', productoCodigo, unidades: 5, referencia: 'entrega-web-' + randomUUID() }),
      signal: AbortSignal.timeout(10000),
    });
    if (seeded.status !== 201) throw new Error('No se pudo preparar el stock real del fixture.');
    await seeded.arrayBuffer();

    proxy = createServer((request, response) => {
      void (async () => {
        const url = new URL(request.url, 'http://fixture.invalid');
        if (url.pathname === '/__fixture/estado' && request.method === 'GET') {
          return json(response, 200, {
            fixture: 'Tienda aislada: login sintético, PostgreSQL y movimientos reales',
            responseLost, sales,
            stock: await repository.listarStock(),
            movimientos: (await pool.query('SELECT (SELECT count(*)::int FROM tienda_ventas) AS ventas, (SELECT count(*)::int FROM tienda_reposiciones) AS reposiciones')).rows[0],
          });
        }
        if (url.pathname === '/__fixture/cerrar' && request.method === 'POST') {
          json(response, 200, { fixture: true, cerrando: true });
          setImmediate(() => { void close().catch(error => { console.error(error.message); process.exitCode = 1; }); });
          return;
        }
        if (url.pathname === '/api/v1/auth/login' && request.method === 'POST') {
          let body;
          try { body = JSON.parse((await readBody(request)).toString('utf8')); }
          catch { return json(response, 400, { codigo: 'SOLICITUD_INVALIDA', mensaje: 'JSON inválido en login del fixture.' }); }
          if (![account.email, account.dni].includes(body?.emailOrDni) || body?.password !== password) {
            return json(response, 401, { codigo: 'NO_AUTENTICADO', mensaje: 'Usar únicamente la cuenta sintética de este fixture.' });
          }
          const iat = Math.floor(Date.now() / 1000);
          const token = app.jwt.sign({ sub: account.socioId, rol: account.rol, iss: 'gimnasio', aud: 'gimnasio-web', iat, exp: iat + 3600 });
          return json(response, 200, { token, socio: account, membresia: null });
        }
        if (url.pathname.startsWith('/api/v1/tienda/') || url.pathname.startsWith('/api/v1/consignaciones/')) {
          const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await readBody(request);
          const headers = new Headers();
          for (const name of ['authorization', 'content-type', 'x-api-key', 'idempotency-key', 'traceparent']) {
            if (typeof request.headers[name] === 'string') headers.set(name, request.headers[name]);
          }
          const upstream = await fetch(upstreamBase + url.pathname + url.search, {
            method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(15000),
          });
          const data = Buffer.from(await upstream.arrayBuffer());
          const sale = url.pathname === '/api/v1/tienda/ventas' && request.method === 'POST';
          if (sale) {
            sales.push({
              key: request.headers['idempotency-key'], body: JSON.parse(body.toString('utf8')),
              upstreamStatus: upstream.status, result: JSON.parse(data.toString('utf8')),
            });
          }
          if (sale && upstream.status === 201 && perderPrimeraVenta && !responseLost) {
            // El movimiento ya fue confirmado en PostgreSQL antes de perder la respuesta.
            responseLost = true;
            response.destroy();
            return;
          }
          const copiedHeaders = {};
          for (const name of ['content-type', 'cache-control', 'traceparent', 'x-correlation-id', 'www-authenticate']) {
            if (upstream.headers.has(name)) copiedHeaders[name] = upstream.headers.get(name);
          }
          response.writeHead(upstream.status, copiedHeaders);
          response.end(data);
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          return json(response, 503, { codigo: 'FIXTURE_FUERA_DE_ALCANCE', mensaje: 'Este fixture solo verifica Tienda; no simula otras operaciones de negocio.' });
        }
        if (!['GET', 'HEAD'].includes(request.method)) return json(response, 405, { codigo: 'METODO_NO_ADMITIDO', mensaje: 'Método fuera del fixture.' });
        const route = decodeURIComponent(url.pathname);
        let target = resolve(frontendRoot, '.' + route);
        const child = relative(frontendRoot, target);
        if (child.startsWith('..') || isAbsolute(child)) return json(response, 404, { codigo: 'NO_ENCONTRADO', mensaje: 'Archivo fuera del frontend.' });
        try { if (!(await stat(target)).isFile()) target = resolve(frontendRoot, 'index.html'); }
        catch { target = resolve(frontendRoot, 'index.html'); }
        const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
        response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : await readFile(target));
      })().catch(() => {
        if (!response.headersSent && !response.destroyed) json(response, 503, { codigo: 'FIXTURE_NO_DISPONIBLE', mensaje: 'El fixture no pudo completar la solicitud.' });
        else response.destroy();
      });
    });
    await new Promise((done, reject) => { proxy.once('error', reject); proxy.listen(0, '127.0.0.1', done); });
    return {
      url: 'http://127.0.0.1:' + proxy.address().port, close, productoCodigo,
      login: { emailOrDni: account.email, password },
      fixture: true, perderPrimeraVenta,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await iniciarTiendaWebPrueba();
  console.log(JSON.stringify({ ...fixture, close: undefined }));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    void fixture.close().catch(error => { console.error(error.message); process.exitCode = 1; });
  });
}
