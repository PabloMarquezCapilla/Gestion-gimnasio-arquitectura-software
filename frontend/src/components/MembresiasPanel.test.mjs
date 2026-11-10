import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const react = await import(pathToFileURL(require.resolve('react')).href);
const { renderToStaticMarkup } = await import(pathToFileURL(require.resolve('react-dom/server')).href);
const compile = source => ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const moduleUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const apiUrl = moduleUrl(compile(await readFile(new URL('../services/api.ts', import.meta.url), 'utf8')));
// React y la API reales; los componentes hermanos se cargan también como data: URLs.
const componente = (fuente, hermanos = {}) => {
  let salida = compile(fuente)
    .replace(/from ["']react["']/g, 'from ' + JSON.stringify(pathToFileURL(require.resolve('react')).href))
    .replace(/from ["']react\/jsx-runtime["']/g, 'from ' + JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
    .replace(/from ["']\.\.\/services\/api["']/g, 'from ' + JSON.stringify(apiUrl));
  for (const [ruta, url] of Object.entries(hermanos)) {
    salida = salida.replace(new RegExp(`from ["']${ruta.replace(/[./]/g, '\\$&')}["']`, 'g'), 'from ' + JSON.stringify(url));
  }
  return salida;
};
const cajaUrl = moduleUrl(componente(await readFile(new URL('./CajaTienda.tsx', import.meta.url), 'utf8')));
const headerUrl = moduleUrl(componente(await readFile(new URL('./PageHeader.tsx', import.meta.url), 'utf8')));
const membresiasUrl = moduleUrl(componente(await readFile(new URL('./MembresiasPanel.tsx', import.meta.url), 'utf8'), {
  './CajaTienda': cajaUrl, './PageHeader': headerUrl,
}));
const { MembresiasPanel, vigencia } = await import(membresiasUrl);
const { AuthModal } = await import(moduleUrl(componente(await readFile(new URL('./AuthModal.tsx', import.meta.url), 'utf8'))));

const fechaLocal = fecha => [fecha.getFullYear(), String(fecha.getMonth() + 1).padStart(2, '0'),
  String(fecha.getDate()).padStart(2, '0')].join('-');

test('Vigencia incluye el último día del mes de destino cuando falta el día original', () => {
  for (const [inicio, meses, fin] of [
    ['2026-01-31', 1, '2026-02-28'], ['2024-01-31', 1, '2024-02-29'],
    ['2026-01-31', 3, '2026-04-30'], ['2026-12-31', 2, '2027-02-28'],
    ['2024-02-29', 12, '2025-02-28'],
  ]) {
    const periodo = vigencia(inicio, meses);
    assert.equal(fechaLocal(periodo.desde), inicio);
    assert.equal(fechaLocal(periodo.hasta), fin);
    assert.deepEqual([periodo.hasta.getHours(), periodo.hasta.getMinutes(), periodo.hasta.getSeconds(),
      periodo.hasta.getMilliseconds()], [23, 59, 59, 999]);
  }
});

test('Vigencia termina el día anterior cuando el día original existe en el mes de destino', () => {
  for (const [inicio, meses, fin] of [
    ['2026-01-15', 1, '2026-02-14'], ['2026-01-01', 1, '2026-01-31'],
    ['2026-02-28', 1, '2026-03-27'], ['2026-12-01', 12, '2027-11-30'],
  ]) {
    const periodo = vigencia(inicio, meses);
    assert.equal(fechaLocal(periodo.hasta), fin);
    assert.equal(periodo.desde.getHours(), 0);
    assert.equal(periodo.hasta.getMilliseconds(), 999);
  }
});

test('Vigencia rechaza fechas inexistentes, duraciones inválidas y años fuera de RFC3339', () => {
  for (const fecha of ['', '2026-02-30', '2026-13-01', '2026-00-10', '2026-01-00', '31/01/2026']) {
    assert.equal(vigencia(fecha, 1), null);
  }
  for (const meses of [0, -1, 1.5, 37, NaN, Infinity]) assert.equal(vigencia('2026-01-01', meses), null);
  assert.equal(vigencia('9999-12-31', 1), null);
});

test('Al recuperar una suspensión pendiente se muestran el reintento y las consultas disponibles', () => {
  const previousStorage = globalThis.sessionStorage;
  const operation = { path: '/api/v1/membresias/mem-pendiente/suspender', method: 'POST', body: {}, clave: 'clave-original' };
  globalThis.sessionStorage = { getItem: key => {
    assert.equal(key, 'pulse.membresias.pendiente.admin-prueba');
    return JSON.stringify(operation);
  } };
  try {
    const html = renderToStaticMarkup(react.createElement(MembresiasPanel, {
      actorId: 'admin-prueba', onNuevoSocio: () => {},
    }));
    assert.match(html, /role="alert"/);
    assert.match(html, /Hay una operación pendiente de confirmación/);
    const selector = html.match(/<select[^>]*aria-label="Socio de la solicitud"[^>]*>/)?.[0];
    assert.ok(selector);
    assert.doesNotMatch(selector, /\sdisabled(?:=|\s|>)/);
    const retry = html.match(/<button[^>]*>Reintentar la misma operación de membresía<\/button>/)?.[0];
    assert.ok(retry);
    assert.doesNotMatch(retry, /\sdisabled(?:=|\s|>)/);
    // La operación pendiente también bloquea las altas en la sección de planes.
    const planes = renderToStaticMarkup(react.createElement(MembresiasPanel, {
      actorId: 'admin-prueba', onNuevoSocio: () => {}, seccion: 'planes',
    }));
    assert.match(planes, /Hay una operación pendiente de confirmación/);
    assert.match(planes, /<button[^>]*disabled=""[^>]*>Crear plan<\/button>/);
  } finally {
    if (previousStorage === undefined) delete globalThis.sessionStorage;
    else globalThis.sessionStorage = previousStorage;
  }
});

test('El listado de socios conserva sus indicadores y no muestra una confirmación ficticia pendiente', () => {
  const props = { actorId: 'admin-piloto', onNuevoSocio: () => {} };
  const html = renderToStaticMarkup(react.createElement(MembresiasPanel, props));
  assert.match(html, /class="app-page members-panel"/);
  assert.match(html, /Socios consultados/);
  assert.match(html, /Página 1 de solicitudes/);
  assert.match(html, /aria-label="Filtrar por estado de cuenta"/);
  assert.match(html, /Nuevo socio/);
  assert.doesNotMatch(html, /Reintentar la misma operación de membresía/);
  for (const seccion of ['planes', 'cobros']) {
    const otraSeccion = renderToStaticMarkup(react.createElement(MembresiasPanel, { ...props, seccion }));
    assert.match(otraSeccion, /class="app-page"/);
    assert.match(otraSeccion, /class="page-heading"/);
    assert.doesNotMatch(otraSeccion, /class="members-stats"/);
  }
});

test('Las secciones administrativas comparten el encabezado y conservan sus controles', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { protocol: 'http:', hostname: 'localhost', host: 'localhost:3000' } };
  const fotografiasUrl = moduleUrl(componente(await readFile(new URL('./CarCrudsFotografias.tsx', import.meta.url), 'utf8')));
  try {
    for (const [nombre, titulo, control, props] of [
      ['PanelPrincipal', 'Panel principal', 'Actualizar', { onIr: () => {} }],
      ['ClasesPanel', 'Clases y turnos', 'Publicar clase', { actorId: 'admin-prueba' }],
      ['AccesosPanel', 'Recepción y Ocupación', 'Registrar movimiento', { actorId: 'admin-prueba' }],
      ['TiendaStockPanel', 'Tienda y stock', 'Confirmar registro de venta', { actorId: 'admin-prueba' }],
      ['CarCrudsPanel', 'Empleados Car Cruds', 'Vínculos existentes', { onNuevoSocio: () => {} }],
      ['ReportesPanel', 'Reportes', 'Actualizar', {}],
      ['ConfiguracionPanel', 'Configuración y estado del sistema', 'Verificar ahora', { usuario: { nombre: 'Admin', rol: 'ADMIN', socioId: 'admin-prueba' } }],
    ]) {
      const fuente = await readFile(new URL('./' + nombre + '.tsx', import.meta.url), 'utf8');
      const modulo = await import(moduleUrl(componente(fuente, {
        './PageHeader': headerUrl, './CarCrudsFotografias': fotografiasUrl,
      })));
      const html = renderToStaticMarkup(react.createElement(modulo[nombre], props));
      assert.match(html, /class="page-heading"/, nombre);
      assert.ok(html.includes(titulo), nombre);
      assert.ok(html.includes(control), nombre);
    }
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('El portal conserva las pestañas, la credencial y los filtros de reservas con el diseño compartido', async () => {
  const tiendaUrl = moduleUrl(componente(await readFile(new URL('./TiendaPanel.tsx', import.meta.url), 'utf8')));
  const fuente = await readFile(new URL('./UserPanel.tsx', import.meta.url), 'utf8');
  const { UserPanel } = await import(moduleUrl(componente(fuente, {
    './MembresiasPanel': membresiasUrl, './TiendaPanel': tiendaUrl,
  })));
  const props = {
    user: { socioId: 'socio-prueba', nombre: 'Socio de prueba', dni: '90000000', email: 'socio@example.invalid', rol: 'SOCIO', estado: 'ACTIVO', createdAt: new Date().toISOString() },
    onLogout: () => {}, showToast: () => {}, onOpenAuth: () => {},
  };
  const html = renderToStaticMarkup(react.createElement(UserPanel, props));
  assert.match(html, /class="member-topbar"/);
  assert.match(html, /aria-label="Secciones del socio"/);
  assert.match(html, /aria-current="page"/);
  for (const texto of ['Clases y Reservas', 'Mis Reservas', 'Membresía y Pagos', 'Tienda', 'Mi credencial', 'Texto de búsqueda']) {
    assert.ok(html.includes(texto), texto);
  }
  assert.match(html, /aria-label="Cerrar sesión"/);
  assert.match(html, /bg-warning-container text-warning/);
  for (const [estado, tono] of [['HABILITADA', 'bg-secondary-container text-secondary'], ['SUSPENDIDA', 'bg-error-container text-error'], ['VENCIDA', 'bg-error-container text-error']]) {
    const membresia = { membresiaId: 'membresia-prueba', socioId: props.user.socioId, tipoPlan: 'Plan de prueba',
      fechaInicio: '2026-01-01T00:00:00Z', fechaFin: '2026-12-31T23:59:59Z', estado };
    const vista = renderToStaticMarkup(react.createElement(UserPanel, { ...props, user: { ...props.user, membresia } }));
    assert.ok(vista.includes(tono), estado);
    assert.ok(vista.includes(estado), estado);
  }
});

test('El acceso público presenta el formulario con etiquetas y conserva el alta exclusiva de ADMIN', () => {
  const html = renderToStaticMarkup(react.createElement(AuthModal, {
    isOpen: true, presentation: 'page', initialMode: 'register',
    onSuccess: () => {}, showToast: () => {},
  }));
  assert.match(html, /class="auth-inline"/);
  assert.match(html, /Ingresá a tu cuenta/);
  assert.match(html, /name="username"[^>]*autoComplete="username"/);
  assert.match(html, /name="password"[^>]*autoComplete="current-password"/);
  assert.match(html, /Mostrar contraseña/);
  assert.doesNotMatch(html, /Crear socio sin membresía/);
  assert.doesNotMatch(html, /role="dialog"/);
  const labels = [...html.matchAll(/<label for="([^"]+)"/g)];
  assert.equal(labels.length, 2);
  for (const [, id] of labels) assert.ok(html.includes('id="' + id + '"'));
});

test('El alta administrativa reutiliza el formulario accesible como diálogo', () => {
  const html = renderToStaticMarkup(react.createElement(AuthModal, {
    isOpen: true, initialMode: 'register', allowRegistration: true,
    onClose: () => {}, onSuccess: () => {}, showToast: () => {},
  }));
  assert.match(html, /role="dialog" aria-modal="true"/);
  assert.match(html, /Cerrar formulario de acceso/);
  assert.match(html, /Crear socio sin membresía/);
  assert.match(html, /minLength="6"/);
  assert.doesNotMatch(html, /Ese flujo está pendiente/i);
});
