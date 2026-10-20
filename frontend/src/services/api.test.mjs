import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Ejecuta la capa HTTP real, sin navegador ni una dependencia de pruebas nueva.
const source = await readFile(new URL('./api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const api = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const originalFetch = globalThis.fetch;
const socio = { socioId: 'socio-prueba', nombre: 'Socio de prueba', rol: 'SOCIO' };
const registro = { dni: '12345678', nombre: 'Socio de prueba', email: 'socio@example.test', password: 'clave-de-prueba' };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
beforeEach(() => api.setApiSession(null));
afterEach(() => { globalThis.fetch = originalFetch; api.setApiSession(null); });

test('login conserva el error del servidor; nunca fabrica credenciales alternativas', async () => {
  for (const status of [401, 409, 503]) {
    globalThis.fetch = async () => json({ codigo: 'ERROR_PRUEBA', mensaje: 'Solicitud rechazada' }, status);
    await assert.rejects(api.apiLogin('admin@pulse.com', 'admin123'), error =>
      error instanceof api.ApiError && error.status === status && error.message === 'Solicitud rechazada');
  }
});

test('login y registro rechazan fallas de red sin crear cuentas ni tokens locales', async () => {
  globalThis.fetch = async () => { throw new TypeError('Network error'); };
  await assert.rejects(api.apiLogin('usuario@example.test', 'clave'), { codigo: 'ERROR_RED', status: 0 });
  api.setApiSession('jwt-administrador-prueba');
  await assert.rejects(api.apiRegistro(registro), { codigo: 'ERROR_RED', status: 0 });
});

test('login solo acepta la identidad y token provistos por el servidor', async () => {
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.has('Authorization'), false);
    return json({ token: 'jwt-login-prueba', socio, membresia: null });
  };
  const result = await api.apiLogin('usuario@example.test', 'clave');
  assert.equal(result.token, 'jwt-login-prueba');
  assert.deepEqual(result.socio, { ...socio, membresia: null });
  // La aplicación debe aceptar explícitamente la sesión; login no la reemplaza por su cuenta.
  await assert.rejects(api.apiObtenerClasesYReservas(socio.socioId), { codigo: 'SESION_REQUERIDA' });
  globalThis.fetch = async () => json({ socio });
  await assert.rejects(api.apiLogin('usuario@example.test', 'clave'), { codigo: 'RESPUESTA_INVALIDA' });
});

test('Bearer acompaña cada petición privada y logout impide reutilizarlo', async () => {
  const calls = [];
  api.setApiSession('jwt-privado-prueba');
  globalThis.fetch = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-privado-prueba');
    if (url.includes('/reservas/clases')) return json({ items: [], reservasSocio: [], esperaSocio: [] });
    if (url.endsWith('/cancelar')) return json({ exito: true, reasignacionPendiente: true });
    if (url.endsWith('/espera')) return json({ esperaId: 'cola-1', estado: 'PENDIENTE', orden: 5 }, 201);
    if (url.endsWith('/reservas')) {
      assert.equal(JSON.parse(options.body).ingresarEsperaSiLlena, false);
      return json({ reservaId: 'uuid-sin-prefijo-especial', estado: 'CONFIRMADA' }, 201);
    }
    return json({ ...socio, membresia: null });
  };
  await api.apiObtenerSocio(socio.socioId);
  await api.apiObtenerClasesYReservas(socio.socioId);
  await api.apiReservarClase('clase-1', socio.socioId);
  await api.apiUnirseEspera('clase-1', socio.socioId);
  const cancellation = await api.apiCancelarReserva('uuid-sin-prefijo-especial');
  assert.equal(cancellation.reasignacionPendiente, true);
  assert.equal(calls.length, 5);
  api.setApiSession(null);
  await assert.rejects(api.apiCancelarReserva('uuid-sin-prefijo-especial'), { codigo: 'SESION_REQUERIDA' });
  assert.equal(calls.length, 5);
});

test('401 privado elimina la sesión y avisa una vez; 403 conserva la sesión', async () => {
  let expired = 0;
  let calls = 0;
  api.setApiSession('jwt-prueba', () => { expired += 1; });
  globalThis.fetch = async () => { calls += 1; return json({ mensaje: 'Sin permiso' }, 403); };
  await assert.rejects(api.apiObtenerSocio(socio.socioId), { status: 403 });
  assert.equal(expired, 0);
  globalThis.fetch = async () => { calls += 1; return json({ mensaje: 'Sesión vencida' }, 401); };
  await assert.rejects(api.apiObtenerSocio(socio.socioId), { status: 401 });
  assert.equal(expired, 1);
  await assert.rejects(api.apiObtenerSocio(socio.socioId), { codigo: 'SESION_REQUERIDA' });
  assert.equal(calls, 2);
});

test('una respuesta 401 vieja no borra una sesión nueva', async () => {
  let respond;
  api.setApiSession('jwt-anterior');
  globalThis.fetch = () => new Promise(resolve => { respond = resolve; });
  const pending = api.apiObtenerSocio(socio.socioId);
  api.setApiSession('jwt-nuevo');
  respond(json({ mensaje: 'Token anterior vencido' }, 401));
  await assert.rejects(pending, { status: 401 });
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-nuevo');
    return json({ ...socio, membresia: null });
  };
  await api.apiObtenerSocio(socio.socioId);
});

test('alta administrativa conserva Bearer del administrador, sin sesión del socio creado', async () => {
  api.setApiSession('jwt-admin-prueba');
  globalThis.fetch = async (url, options) => {
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-admin-prueba');
    if (url.endsWith('/auth/registro')) {
      assert.deepEqual(JSON.parse(options.body), registro);
      return json({ socio, membresia: null }, 201);
    }
    return json({ items: [], reservasSocio: [], esperaSocio: [] });
  };
  const created = await api.apiRegistro(registro);
  assert.equal(created.socio.socioId, socio.socioId);
  assert.equal(created.membresia, null);
  assert.equal('token' in created, false);
  await api.apiObtenerClasesYReservas('admin-prueba');
});

test('409 de registro, reserva o cancelación permanece error y conserva la sesión', async () => {
  api.setApiSession('jwt-prueba');
  globalThis.fetch = async () => json({ codigo: 'CONFLICTO', mensaje: 'Conflicto de dominio' }, 409);
  for (const operation of [
    () => api.apiRegistro(registro),
    () => api.apiReservarClase('clase-1', socio.socioId),
    () => api.apiCancelarReserva('reserva-1'),
  ]) {
    await assert.rejects(operation(), { status: 409, codigo: 'CONFLICTO', message: 'Conflicto de dominio' });
  }
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-prueba');
    return json({ ...socio, membresia: null });
  };
  await api.apiObtenerSocio(socio.socioId);
});

test('consulta vacía se devuelve vacía; respuesta inválida y fallas de red no son listas vacías', async () => {
  api.setApiSession('jwt-prueba');
  globalThis.fetch = async () => json({ items: [], reservasSocio: [], esperaSocio: [] });
  assert.deepEqual(await api.apiObtenerClasesYReservas(socio.socioId), { items: [], reservasSocio: [], esperaSocio: [] });
  globalThis.fetch = async () => json({ items: [] });
  await assert.rejects(api.apiObtenerClasesYReservas(socio.socioId), { codigo: 'RESPUESTA_INVALIDA' });
  globalThis.fetch = async () => { throw new TypeError('Network error'); };
  await assert.rejects(api.apiObtenerClasesYReservas(socio.socioId), { codigo: 'ERROR_RED' });
  await assert.rejects(api.apiReservarClase('clase-1', socio.socioId), { codigo: 'ERROR_RED' });
  await assert.rejects(api.apiCancelarReserva('reserva-1'), { codigo: 'ERROR_RED' });
});

test('respuestas sin confirmación de reserva o espera no producen éxito', async () => {
  api.setApiSession('jwt-prueba');
  globalThis.fetch = async () => json({});
  await assert.rejects(api.apiReservarClase('clase-1', socio.socioId), { codigo: 'RESPUESTA_INVALIDA' });
  await assert.rejects(api.apiUnirseEspera('clase-1', socio.socioId), { codigo: 'RESPUESTA_INVALIDA' });
  globalThis.fetch = async () => new Response('<html>Error del proxy</html>', { status: 502 });
  await assert.rejects(api.apiCancelarReserva('reserva-1'), { status: 502 });
});

test('Tienda conserva el error de integración pendiente y la sesión; nunca inventa productos', async () => {
  api.setApiSession('jwt-tienda-ficticio');
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, '/api/v1/tienda/productos');
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-tienda-ficticio');
    return json({ codigo: 'INTEGRACION_PENDIENTE', mensaje: 'La consulta todavía no está habilitada.' }, 503);
  };
  await assert.rejects(api.apiConsultarTienda(), { status: 503, codigo: 'INTEGRACION_PENDIENTE' });
  await assert.rejects(api.apiConsultarTienda(), { status: 503 });
  assert.equal(calls, 2);
  globalThis.fetch = async () => { throw new TypeError('Red caída'); };
  await assert.rejects(api.apiConsultarTienda(), { codigo: 'ERROR_RED' });
  globalThis.fetch = async () => json({ items: [] });
  await assert.rejects(api.apiConsultarTienda(), { codigo: 'RESPUESTA_INVALIDA' });
});

test('Tienda participa del cierre de sesión ante un JWT rechazado', async () => {
  let expired = 0;
  api.setApiSession('jwt-tienda-ficticio', () => { expired++; });
  globalThis.fetch = async () => json({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión vencida' }, 401);
  await assert.rejects(api.apiConsultarTienda(), { status: 401 });
  assert.equal(expired, 1);
  await assert.rejects(api.apiConsultarTienda(), { codigo: 'SESION_REQUERIDA' });
});
