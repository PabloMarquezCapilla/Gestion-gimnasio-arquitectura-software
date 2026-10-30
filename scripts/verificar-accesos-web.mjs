// Verificación opcional con NGINX y navegador reales sobre el fixture aislado de verificar-accesos.
// No instala navegador ni lee credenciales del grupo. Requiere rutas explícitas de herramientas.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

export async function verificarAccesosWeb({ temporary, accesosUrl, sociosUrl, email, password }) {
  const { chromium } = await import(pathToFileURL(resolve(process.env.ACCESOS_PLAYWRIGHT_MODULE)).href);
  const socket = createServer(); await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  await mkdir(join(temporary, 'logs'), { recursive: true });
  let config = await readFile(resolve('infra/gateway/nginx.conf'), 'utf8');
  config = config.replace('include /etc/nginx/mime.types;', 'include ' + JSON.stringify(resolve(process.env.NGINX_MIME_TYPES)) + ';')
    .replace('listen 80;', 'listen ' + port + ';')
    .replace('root /usr/share/nginx/html;', 'root ' + JSON.stringify(resolve('frontend/dist')) + ';')
    .replace(/resolver 127\.0\.0\.11[^;]+;/, '').replace(/resolver_timeout 2s;/, '')
    .replace(/socios-membresias:3000/g, new URL(sociosUrl).host)
    .replace(/accesos-ocupacion:3000/g, new URL(accesosUrl).host)
    .replace(/clases-reservas:3000|tienda:3000/g, '127.0.0.1:9').replace(/ resolve;/g, ';');
  // macOS ARM usa páginas de 16 KiB: la zona de 64 KiB del entorno Linux no alcanza.
  // Solo se adapta la copia temporal del ensayo, nunca la configuración del proyecto.
  if (process.platform === 'darwin') config = config.replace(/(zone \w+ )64k;/g, (_match, prefix) => prefix + '256k;');
  const conf = join(temporary, 'nginx.conf'); await writeFile(conf, config);
  const bin = resolve(process.env.NGINX_BIN);
  const args = ['-p', temporary + '/', '-c', conf];
  const check = spawnSync(bin, [...args, '-t'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const nginx = spawn(bin, [...args, '-g', 'daemon off;'], { stdio: 'ignore' });
  let browser;
  try {
    const base = 'http://127.0.0.1:' + port;
    for (let n = 0; n < 60; n++) {
      try { if ((await fetch(base + '/health')).ok) break; } catch {} await pause(100);
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.ACCESOS_CHROME_BIN || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const login = async () => {
      await page.getByRole('button', { name: /Iniciar Sesión/ }).first().click();
      await page.getByPlaceholder('Email o DNI registrado').fill(email);
      await page.locator('input[type=password]').fill(password);
      await page.getByRole('button', { name: 'Ingresar al Club' }).click();
      await page.getByRole('button', { name: 'Recepción y Ocupación' }).click();
      await page.getByRole('heading', { name: 'Recepción y Ocupación' }).waitFor();
    };
    await page.goto(base); await login();
    await page.getByLabel('Sede', { exact: true }).selectOption('sede-2');
    await page.getByLabel('ID de socio', { exact: true }).fill('socio-demo-01');
    // El servidor confirma, pero el navegador pierde la respuesta. No se sustituye el backend.
    let lost = false;
    await page.route('**/api/v1/accesos/movimientos', async route => {
      if (!lost && route.request().method() === 'POST') { lost = true; await route.fetch(); await route.abort('failed'); }
      else await route.continue();
    });
    await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
    await page.getByRole('button', { name: 'Reintentar la misma operación' }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'No se pudo conectar' }).waitFor();
    await page.reload(); await login();
    await page.getByRole('button', { name: 'Reintentar la misma operación' }).click();
    await page.getByRole('status').filter({ hasText: 'Ingreso registrado.' }).waitFor();
    await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'ya tiene un ingreso abierto' }).waitFor();
    await page.getByLabel('Movimiento', { exact: true }).selectOption('EGRESO');
    await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Egreso registrado.' }).waitFor();
    await page.getByLabel('ID de socio', { exact: true }).fill('socio-suspendido-01');
    await page.getByLabel('Movimiento', { exact: true }).selectOption('INGRESO');
    await page.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'membresía no habilita' }).waitFor();
    assert.ok((await page.locator('tbody tr').count()) >= 4);
    assert.deepEqual(errors, []);
    if (process.env.ACCESOS_SCREENSHOT) await page.screenshot({ path: process.env.ACCESOS_SCREENSHOT, fullPage: true });
    console.log('Navegador + NGINX reales: login, ingreso, respuesta perdida, recarga/replay, duplicado, egreso, membresía suspendida e historial verificados.');
  } finally {
    await browser?.close();
    if (nginx.exitCode === null) {
      const exit = new Promise(resolve => nginx.once('exit', resolve)); nginx.kill('SIGTERM'); await exit;
    }
  }
}
