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
const code = componente(await readFile(new URL('./MembresiasPanel.tsx', import.meta.url), 'utf8'), { './CajaTienda': cajaUrl });
const { MembresiasPanel, vigencia } = await import(moduleUrl(code));

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
