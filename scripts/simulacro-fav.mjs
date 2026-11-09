// Simulacro de caída del proveedor FAV (jornada de fallas, §2.8 y §4.2).
// Requiere el sistema en marcha apuntando al mock:
//   npm run mock:fav            (en otra terminal)
//   FAV_CATALOGO_BASE_URL=http://host.docker.internal:8090 FAV_CATALOGO_API_KEY=clave-fav-local npm run iniciar
// Luego: npm run simulacro:fav  → imprime la línea temporal y la guarda en docs/evidence/simulacro-fav/.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const G = process.env.GATEWAY_URL ?? 'http://localhost:8080';
const MOCK = process.env.MOCK_FAV_URL ?? 'http://localhost:8090';
const PROM = process.env.PROMETHEUS_URL ?? 'http://localhost:9090';
const env = Object.fromEntries(readFileSync(resolve(root, '.env'), 'utf8').split(/\r?\n/)
  .map(l => /^([A-Z0-9_]+)=(.*)$/.exec(l)).filter(Boolean).map(m => [m[1], m[2]]));
const linea = [];
const inicio = Date.now();
const pausa = ms => new Promise(r => setTimeout(r, ms));

function registrar(evento, datos = {}) {
  const fila = { t: `+${((Date.now() - inicio) / 1000).toFixed(1)}s`, hora: new Date().toISOString(), evento, ...datos };
  linea.push(fila);
  console.log(fila.t.padStart(8), evento.padEnd(46), JSON.stringify(datos));
}
async function json(url, opciones = {}) {
  const t = performance.now();
  const r = await fetch(url, opciones);
  let body; try { body = await r.json(); } catch { body = null; }
  return { status: r.status, body, ms: Math.round(performance.now() - t) };
}
const modo = m => fetch(`${MOCK}/__mock/modo`, { method: 'POST', body: JSON.stringify({ modo: m }) });
async function metricas() {
  const texto = await (await fetch(`${G}/metrics/tienda`)).text();
  const valor = re => Number((re.exec(texto) ?? [])[1] ?? NaN);
  return {
    circuito: ['CERRADO', 'ABIERTO', 'SEMIABIERTO'].find(e => valor(new RegExp(`tienda_fav_circuito_estado\\{[^}]*estado="${e}"\\} (\\d+)`)) === 1),
    consultasFav: valor(/tienda_fav_consultas_total\{[^}]*\} (\d+)/),
    fallosFav: valor(/tienda_fav_fallos_total\{[^}]*\} (\d+)/),
    rechazosCircuito: valor(/tienda_fav_rechazos_circuito_total\{[^}]*\} (\d+)/),
  };
}
async function alertas() {
  const r = await json(`${PROM}/api/v1/alerts`);
  return (r.body?.data?.alerts ?? []).map(a => `${a.labels.alertname}:${a.state}`);
}

const login = await json(`${G}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ emailOrDni: '22222222', password: 'socio123' }) });
if (login.status !== 200) throw new Error('No se pudo iniciar sesión con el socio de prueba.');
const auth = { Authorization: `Bearer ${login.body.token}` };
const catalogo = async () => {
  const r = await json(`${G}/api/v1/tienda/productos`, { headers: auth });
  return { status: r.status, ms: r.ms, origen: r.body?.origen ?? r.body?.codigo, productos: r.body?.items?.length };
};
const comprar = async clave => {
  const r = await json(`${G}/api/v1/tienda/compras`, { method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json', 'Idempotency-Key': clave },
    body: JSON.stringify({ items: [{ productoCodigo: 'var-remera-basica-blanca-m', unidades: 1 }] }) });
  return { status: r.status, ms: r.ms, resultado: r.body?.estado ?? r.body?.codigo, totalMinor: r.body?.totalMinor };
};

await modo('normal');
const repo = await json(`${G}/api/v1/consignaciones/reposiciones`, { method: 'POST',
  headers: { 'X-API-Key': env.FAV_API_KEY, 'Idempotency-Key': randomUUID(), 'Content-Type': 'application/json' },
  body: JSON.stringify({ proveedorId: 'fav', productoCodigo: 'var-remera-basica-blanca-m', unidades: 5, referencia: `simulacro-${randomUUID()}` }) });
registrar('Preparación: FAV repone 5 remeras', { status: repo.status });
registrar('1. FAV normal: catálogo', await catalogo());
registrar('   métricas', await metricas());

await modo('caido');
registrar('2. INYECCIÓN: FAV responde 503 a todo');
registrar('   catálogo dentro del TTL (60 s)', await catalogo());
registrar('   esperando que venza la caché fresca (65 s)…');
await pausa(65_000);
for (let i = 1; i <= 4; i++) registrar(`3. catálogo con FAV caído, intento ${i}`, await catalogo());
registrar('   métricas', await metricas());
const claveCompra = randomUUID();
registrar('4. compra durante la caída (precio de caché)', await comprar(claveCompra));
registrar('   reintento de la misma compra', await comprar(claveCompra));
// Detección: un scrape (10 s) más una evaluación de reglas (10 s) después de abrir el circuito.
let activas = [];
for (let i = 0; i < 12 && !activas.some(a => a.startsWith('CircuitoFavAbierto:firing')); i++) {
  await pausa(5_000);
  activas = await alertas();
}
registrar('5. alertas en Prometheus (detección)', { alertas: activas });

registrar('6. reinicio de Tienda sin caché con FAV caído');
spawnSync('docker', ['compose', 'restart', 'tienda'], { cwd: root, stdio: 'ignore' });
await pausa(6_000);
registrar('   catálogo sin copia válida', await catalogo());
registrar('   compra nueva sin catálogo', await comprar(randomUUID()));

await modo('lento');
registrar('7. INYECCIÓN: FAV lento (5 s > presupuesto de 3 s)');
await pausa(31_000);
registrar('   catálogo (corta por timeout)', await catalogo());

await modo('normal');
registrar('8. RECUPERACIÓN: FAV vuelve a responder');
registrar('   esperando la ventana del circuito (31 s)…');
await pausa(31_000);
registrar('   catálogo (prueba semiabierta)', await catalogo());
registrar('   métricas', await metricas());
await pausa(25_000);
registrar('9. alertas después de la recuperación', { alertas: await alertas() });

const dir = resolve(root, 'docs/evidence/simulacro-fav');
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'linea-temporal.json'), JSON.stringify(linea, null, 2) + '\n');
console.log('\nLínea temporal guardada en docs/evidence/simulacro-fav/linea-temporal.json');
