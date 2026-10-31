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

test('Accesos envía JWT, clave idempotente y cuerpo sin modificar al gateway', async () => {
  api.setApiSession('jwt-ficticio');
  const body = { sedeId: 'sede-1', socioId: 'socio-1', tipo: 'INGRESO' };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/v1/accesos/movimientos'); assert.equal(options.headers.get('Authorization'), 'Bearer jwt-ficticio');
    assert.equal(options.headers.get('Idempotency-Key'), 'clave-estable'); assert.deepEqual(JSON.parse(options.body), body);
    return json({ movimiento: { ...body, movimientoId: 'm-1', aceptado: true } }, 201);
  };
  assert.equal((await api.apiAccesosRegistrar(body, 'clave-estable')).movimiento.movimientoId, 'm-1');
});
test('Accesos no interpreta error de red ni un cuerpo ajeno como éxito', async () => {
  api.setApiSession('jwt-ficticio');
  const body = { sedeId: 'sede-1', socioId: 'socio-1', tipo: 'EGRESO' };
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(api.apiAccesosRegistrar(body, 'clave-estable'), { status: 0 });
  globalThis.fetch = async () => json({ movimiento: { ...body, socioId: 'otro', movimientoId: 'm-1', aceptado: true } });
  await assert.rejects(api.apiAccesosRegistrar(body, 'clave-estable'), { status: 502 });
});
test('Accesos muestra rechazo de membresía y conserva sesión ante falla de dependencia', async () => {
  api.setApiSession('jwt-ficticio');
  globalThis.fetch = async () => json({ movimiento: { codigo: 'MEMBRESIA_NO_HABILITADA' } }, 422);
  await assert.rejects(api.apiAccesosRegistrar({ sedeId: 'sede-1', socioId: 'socio-1', tipo: 'INGRESO' }, 'clave'), { codigo: 'MEMBRESIA_NO_HABILITADA', status: 422 });
  globalThis.fetch = async () => json({ codigo: 'SOCIOS_NO_DISPONIBLE', mensaje: 'Dependencia caída' }, 503);
  await assert.rejects(api.apiAccesosRegistrar({ sedeId: 'sede-1', socioId: 'socio-1', tipo: 'INGRESO' }, 'clave'), { status: 503 });
  globalThis.fetch = async (_url, options) => { assert.equal(options.headers.get('Authorization'), 'Bearer jwt-ficticio'); return json({ items: [] }); };
  await api.apiAccesosSedes();
});
test('Accesos pagina historial con filtros enviados al backend', async () => {
  api.setApiSession('jwt-ficticio');
  globalThis.fetch = async (url) => {
    const u = new URL(url, 'http://prueba.local'); assert.equal(u.searchParams.get('sedeId'), 'sede-1');
    assert.equal(u.searchParams.get('pagina'), '2'); assert.equal(u.searchParams.get('socioId'), 'socio-1');
    return json({ items: [], pagina: 2, tamanio: 20 });
  };
  await api.apiAccesosHistorial('sede-1', 2, 'socio-1');
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

const employeeId = 'empleado / con?caracteres';
const carCrudsPath = '/api/v1/integraciones/car-cruds';
const employeePath = `${carCrudsPath}/empleados/${encodeURIComponent(employeeId)}`;
const link = { employeeId, socioId: 'socio-real', version: 1, actualizadoEn: '2026-10-23T12:30:00.000Z' };
const publicSocio = {
  socioId: 'socio-real', dni: '12345678', nombre: 'Socio real', email: 'socio@example.test',
  rol: 'SOCIO', estado: 'ACTIVO', createdAt: '2026-10-23T12:00:00.000Z',
};
const historyItem = {
  historialId: 'historial-1', employeeId, version: 1, socioAnteriorId: null,
  socioNuevoId: publicSocio.socioId, administradorId: 'admin-real', createdAt: link.actualizadoEn,
};

test('Car Cruds usa solo JWT propio y codifica IDs al consultar lista, estado, vínculo e historial', async () => {
  api.setApiSession('jwt-admin-car-cruds');
  const paths = [];
  globalThis.fetch = async (url, options) => {
    paths.push(url);
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-admin-car-cruds');
    assert.equal(options.headers.has('X-API-Key'), false);
    if (url.endsWith('/estado')) return json({ employeeId, active: false });
    if (url.endsWith('/historial')) return json({ items: [historyItem] });
    if (url.endsWith('/vinculo')) return json(link);
    if (url.startsWith(`${carCrudsPath}/vinculos?`)) return json({ items: [link], page: 2, pageSize: 5, total: 8 });
    return json({ items: [{ employeeId, displayName: 'Nombre provisto por Car Cruds' }], page: 2, pageSize: 5, total: 8 });
  };
  assert.equal((await api.apiCarCrudsEmpleados(2, 5)).items[0].displayName, 'Nombre provisto por Car Cruds');
  assert.deepEqual(await api.apiCarCrudsEstado(employeeId), { employeeId, active: false });
  assert.deepEqual(await api.apiCarCrudsVinculos(2, 5), { items: [link], page: 2, pageSize: 5, total: 8 });
  assert.deepEqual(await api.apiCarCrudsVinculo(employeeId), link);
  assert.deepEqual(await api.apiCarCrudsHistorial(employeeId), { items: [historyItem] });
  assert.deepEqual(paths, [
    `${carCrudsPath}/empleados?page=2&pageSize=5`, `${employeePath}/estado`,
    `${carCrudsPath}/vinculos?page=2&pageSize=5`, `${employeePath}/vinculo`, `${employeePath}/vinculo/historial`,
  ]);
});

test('Car Cruds busca por cuerpo privado y conserva solo campos públicos del socio', async () => {
  api.setApiSession('jwt-admin-car-cruds');
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${carCrudsPath}/socios/buscar`);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(options.body), { identificador: 'socio@example.test' });
    return json({ items: [{ ...publicSocio, passwordHash: 'no-debe-propagarse', membresia: { estado: 'HABILITADA' } }] });
  };
  assert.deepEqual(await api.apiCarCrudsBuscarSocios('  socio@example.test  '), { items: [publicSocio] });
});

test('Car Cruds confirma vínculo y desvinculación con la versión leída, sin modificar membresías', async () => {
  api.setApiSession('jwt-admin-car-cruds');
  for (const socioId of [publicSocio.socioId, null]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${employeePath}/vinculo`);
      assert.equal(options.method, 'PUT');
      assert.deepEqual(JSON.parse(options.body), { socioId, versionEsperada: 3 });
      return json({ ...link, socioId, version: 4 });
    };
    assert.deepEqual(await api.apiCarCrudsGuardarVinculo(employeeId, socioId, 3), { ...link, socioId, version: 4 });
  }
  globalThis.fetch = async () => json({ employeeId, socioId: null, version: 0, actualizadoEn: null });
  assert.deepEqual(await api.apiCarCrudsVinculo(employeeId), { employeeId, socioId: null, version: 0, actualizadoEn: null });
});

test('Car Cruds conserva conflicto de versión e indisponibilidad sin cerrar la sesión ni fingir éxito', async () => {
  api.setApiSession('jwt-admin-car-cruds');
  const operations = [
    () => api.apiCarCrudsEmpleados(), () => api.apiCarCrudsEstado(employeeId),
    () => api.apiCarCrudsVinculos(), () => api.apiCarCrudsVinculo(employeeId),
    () => api.apiCarCrudsHistorial(employeeId), () => api.apiCarCrudsBuscarSocios('12345678'),
    () => api.apiCarCrudsGuardarVinculo(employeeId, publicSocio.socioId, 1),
  ];
  for (const status of [409, 503]) {
    const codigo = status === 409 ? 'VINCULO_DESACTUALIZADO' : 'CAR_CRUDS_NO_DISPONIBLE';
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.get('Authorization'), 'Bearer jwt-admin-car-cruds');
      return json({ codigo, mensaje: 'Error informado por backend' }, status);
    };
    for (const operation of operations) await assert.rejects(operation(), { codigo, status, message: 'Error informado por backend' });
  }
  globalThis.fetch = async () => json({ items: [], page: 1, pageSize: 20, total: 0 });
  assert.deepEqual(await api.apiCarCrudsVinculos(), { items: [], page: 1, pageSize: 20, total: 0 });
});

test('Car Cruds cierra la sesión ante 401 propio y no vuelve a enviar el JWT', async () => {
  let expired = 0;
  let calls = 0;
  api.setApiSession('jwt-admin-car-cruds', () => { expired++; });
  globalThis.fetch = async () => { calls++; return json({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión vencida' }, 401); };
  await assert.rejects(api.apiCarCrudsBuscarSocios('12345678'), { status: 401 });
  assert.equal(expired, 1);
  await assert.rejects(api.apiCarCrudsGuardarVinculo(employeeId, null, 1), { codigo: 'SESION_REQUERIDA' });
  assert.equal(calls, 1);
});

test('Car Cruds no convierte respuestas incompletas, de otro empleado o fallas de red en datos válidos', async () => {
  api.setApiSession('jwt-admin-car-cruds');
  const cases = [
    [() => api.apiCarCrudsEmpleados(), { items: [{ employeeId }], page: 1, pageSize: 20, total: 1 }],
    [() => api.apiCarCrudsEmpleados(), { items: [], page: 0, pageSize: 20, total: 0 }],
    [() => api.apiCarCrudsVinculos(), { items: [link], page: 1, pageSize: 20, total: 0 }],
    [() => api.apiCarCrudsEstado(employeeId), { employeeId, active: 'false' }],
    [() => api.apiCarCrudsEstado(employeeId), { employeeId: 'otra-persona', active: true }],
    [() => api.apiCarCrudsVinculo(employeeId), { ...link, version: -1 }],
    [() => api.apiCarCrudsVinculo(employeeId), { ...link, employeeId: 'otra-persona' }],
    [() => api.apiCarCrudsVinculo(employeeId), { ...link, version: 0 }],
    [() => api.apiCarCrudsHistorial(employeeId), { items: [{ ...historyItem, administradorId: null }] }],
    [() => api.apiCarCrudsBuscarSocios('12345678'), { items: [{ ...publicSocio, dni: null }] }],
    [() => api.apiCarCrudsGuardarVinculo(employeeId, publicSocio.socioId, 1), {}],
    [() => api.apiCarCrudsGuardarVinculo(employeeId, publicSocio.socioId, 1), { ...link, socioId: 'socio-distinto' }],
  ];
  for (const [operation, payload] of cases) {
    globalThis.fetch = async () => json(payload);
    await assert.rejects(operation(), { codigo: 'RESPUESTA_INVALIDA' });
  }
  globalThis.fetch = async () => { throw new TypeError('Network error'); };
  for (const operation of [() => api.apiCarCrudsEmpleados(), () => api.apiCarCrudsGuardarVinculo(employeeId, null, 1)]) {
    await assert.rejects(operation(), { codigo: 'ERROR_RED' });
  }
});

const photograph = {
  fotografiaId: 'fotografia / guardada', socioId: publicSocio.socioId, versionVinculo: 3,
  administradorId: 'admin-real', creadaEn: '2026-10-23T13:00:00.000Z',
  payload: {
    employeeId, period: '2026-10', sourceReference: 'referencia-estable', version: 1,
    observedAt: '2026-10-23T13:00:00.000Z', member: null, used: null, costMinor: null, spendingMinor: null,
  },
  estado: 'PREPARADA', intentos: 0, ultimoIntentoEn: null, recibidaEn: null,
  applied: null, codigoError: null, leaseId: null, leaseHasta: null,
};
const prepareOptions = { period: '2026-10', versionVinculoEsperada: 3, versionAnteriorEsperada: 0 };

test('fotografías usa JWT propio y consulta el mes con ID opaco sin exponer token de Car Cruds', async () => {
  api.setApiSession('jwt-admin-fotografias');
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `${employeePath}/fotografias?period=2026-10`);
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-admin-fotografias');
    assert.equal(options.headers.has('X-API-Key'), false);
    assert.equal(options.body, undefined);
    return json({ items: [photograph] });
  };
  assert.deepEqual(await api.apiCarCrudsFotografias(employeeId, '2026-10'), { items: [photograph] });
});

test('preparación envía solo mes, revisiones esperadas y confirmación del cambio; nunca hechos del cliente', async () => {
  api.setApiSession('jwt-admin-fotografias');
  for (const confirmation of [undefined, false, true]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${employeePath}/fotografias`);
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.get('Content-Type'), 'application/json');
      assert.deepEqual(JSON.parse(options.body), {
        ...prepareOptions, ...(confirmation === undefined ? {} : { confirmarCambioVinculo: confirmation }),
      });
      return json(photograph, 201);
    };
    assert.deepEqual(await api.apiCarCrudsPrepararFotografia(employeeId, {
      ...prepareOptions, confirmarCambioVinculo: confirmation, member: true, costMinor: 100,
      administradorId: 'actor-inventado', sourceReference: 'referencia-cliente', observedAt: 'fecha-cliente',
    }), photograph);
  }
});

test('enviar o reintentar identifica la fotografía guardada y no vuelve a calcular ni transmite sus hechos', async () => {
  api.setApiSession('jwt-admin-fotografias');
  for (const confirmation of [undefined, false, true]) {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `${carCrudsPath}/fotografias/${encodeURIComponent(photograph.fotografiaId)}/enviar`);
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), {
        versionVinculoEsperada: 3, ...(confirmation === undefined ? {} : { confirmarRevision: confirmation }),
      });
      return json({ ...photograph, estado: 'PENDIENTE', intentos: 1, codigoError: 'CAR_CRUDS_NO_DISPONIBLE', ultimoIntentoEn: photograph.creadaEn });
    };
    const result = await api.apiCarCrudsEnviarFotografia(photograph.fotografiaId, {
      versionVinculoEsperada: 3, confirmarRevision: confirmation, payload: { ...photograph.payload, member: true },
      period: '2020-01', fotografiaId: 'otra-fotografia', version: 5,
    });
    assert.equal(result.estado, 'PENDIENTE');
    assert.deepEqual(result.payload, photograph.payload);
  }
});

test('fotografías conserva null, cero y applied false sin inferir hechos ni vigencia remota', async () => {
  api.setApiSession('jwt-admin-fotografias');
  const received = {
    ...photograph, estado: 'RECIBIDA', intentos: 1, ultimoIntentoEn: photograph.creadaEn,
    recibidaEn: photograph.creadaEn, applied: false,
    payload: { ...photograph.payload, member: false, used: null, costMinor: 0, currency: 'ARS' },
  };
  globalThis.fetch = async () => json({ ...received, token: 'no-propagar', payload: { ...received.payload, password: 'no-propagar' } });
  const result = await api.apiCarCrudsEnviarFotografia(photograph.fotografiaId, { versionVinculoEsperada: 3 });
  assert.deepEqual(result, received);
  assert.equal(result.applied, false);
  assert.equal(result.payload.used, null);
  assert.equal(result.payload.costMinor, 0);
});

test('fotografías rechaza datos incompletos, cantidades inseguras y respuesta de otro empleado, mes o registro', async () => {
  api.setApiSession('jwt-admin-fotografias');
  const invalidRecords = [
    { ...photograph, intentos: -1 }, { ...photograph, versionVinculo: 0 },
    { ...photograph, leaseHasta: 'fecha-invalida' }, { ...photograph, estado: 'EXITO' },
    { ...photograph, applied: 'false' }, { ...photograph, administradorId: null },
    { ...photograph, payload: { ...photograph.payload, used: undefined } },
    { ...photograph, payload: { ...photograph.payload, costMinor: -1 } },
    { ...photograph, payload: { ...photograph.payload, spendingMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'ARS' } },
    { ...photograph, payload: { ...photograph.payload, costMinor: 1 } },
    { ...photograph, payload: { ...photograph.payload, currency: 'USD' } },
    { ...photograph, payload: { ...photograph.payload, period: '2026-13' } },
    { ...photograph, payload: { ...photograph.payload, employeeId: 'otra-persona' } },
    { ...photograph, payload: { ...photograph.payload, period: '2026-09' } },
  ];
  for (const record of invalidRecords) {
    globalThis.fetch = async () => json({ items: [record] });
    await assert.rejects(api.apiCarCrudsFotografias(employeeId, '2026-10'), { codigo: 'RESPUESTA_INVALIDA' });
  }
  for (const items of [[photograph, photograph], [photograph, { ...photograph, fotografiaId: 'otra' }]]) {
    globalThis.fetch = async () => json({ items });
    await assert.rejects(api.apiCarCrudsFotografias(employeeId, '2026-10'), { codigo: 'RESPUESTA_INVALIDA' });
  }
  globalThis.fetch = async () => json({ items: [photograph, {
    ...photograph, fotografiaId: 'otra', payload: { ...photograph.payload, version: 2, sourceReference: 'referencia-distinta' },
  }] });
  await assert.rejects(api.apiCarCrudsFotografias(employeeId, '2026-10'), { codigo: 'RESPUESTA_INVALIDA' });
  globalThis.fetch = async () => json({ ...photograph, versionVinculo: 4 });
  await assert.rejects(api.apiCarCrudsPrepararFotografia(employeeId, prepareOptions), { codigo: 'RESPUESTA_INVALIDA' });
  globalThis.fetch = async () => json({ ...photograph, estado: 'RECIBIDA' });
  await assert.rejects(api.apiCarCrudsPrepararFotografia(employeeId, prepareOptions), { codigo: 'RESPUESTA_INVALIDA' });
  globalThis.fetch = async () => json({ ...photograph, payload: { ...photograph.payload, version: 4 } });
  await assert.rejects(api.apiCarCrudsPrepararFotografia(employeeId, prepareOptions), { codigo: 'RESPUESTA_INVALIDA' });
  globalThis.fetch = async () => json({ ...photograph, fotografiaId: 'otra' });
  await assert.rejects(api.apiCarCrudsEnviarFotografia(photograph.fotografiaId, { versionVinculoEsperada: 3 }), { codigo: 'RESPUESTA_INVALIDA' });
});

test('fotografías conserva conflictos y fallas de red; no repite POST ni cierra sesión por errores de integración', async () => {
  api.setApiSession('jwt-admin-fotografias');
  const operations = [
    () => api.apiCarCrudsFotografias(employeeId, '2026-10'),
    () => api.apiCarCrudsPrepararFotografia(employeeId, prepareOptions),
    () => api.apiCarCrudsEnviarFotografia(photograph.fotografiaId, { versionVinculoEsperada: 3 }),
  ];
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.headers.get('Authorization'), 'Bearer jwt-admin-fotografias');
    return json({ codigo: 'VINCULO_DESACTUALIZADO', mensaje: 'Revisar el vínculo' }, 409);
  };
  for (const operation of operations) await assert.rejects(operation(), { status: 409, codigo: 'VINCULO_DESACTUALIZADO' });
  assert.equal(calls, 3);
  globalThis.fetch = async () => { calls++; throw new TypeError('Sin red'); };
  for (const operation of operations) await assert.rejects(operation(), { status: 0, codigo: 'ERROR_RED' });
  assert.equal(calls, 6);
  globalThis.fetch = async () => json({ items: [] });
  assert.deepEqual(await api.apiCarCrudsFotografias(employeeId, '2026-10'), { items: [] });
});

test('fotografías usa el manejo central de 401 propio sin volver a enviar la sesión vencida', async () => {
  let expired = 0;
  let calls = 0;
  api.setApiSession('jwt-admin-fotografias', () => { expired++; });
  globalThis.fetch = async () => { calls++; return json({ codigo: 'NO_AUTENTICADO', mensaje: 'Sesión vencida' }, 401); };
  await assert.rejects(api.apiCarCrudsFotografias(employeeId, '2026-10'), { status: 401 });
  await assert.rejects(api.apiCarCrudsPrepararFotografia(employeeId, prepareOptions), { codigo: 'SESION_REQUERIDA' });
  await assert.rejects(api.apiCarCrudsEnviarFotografia(photograph.fotografiaId, { versionVinculoEsperada: 3 }), { codigo: 'SESION_REQUERIDA' });
  assert.equal(expired, 1);
  assert.equal(calls, 1);
});

test('Membresías: conserva JWT, contenido y clave de la confirmación sin inventar estado',async()=>{
 api.setApiSession('jwt-ficticio');
 const result={solicitudId:'sol-1',socioId:'socio-1',planId:'plan-1',nombrePlan:'Prueba',importeMinor:123,moneda:'ARS',fechaInicio:'2040-01-01T00:00:00Z',fechaFin:'2040-02-01T00:00:00Z',estado:'CONFIRMADA',pago:{pagoId:'pago-1',referencia:'ref-prueba',estado:'CONFIRMADO'},comprobante:{comprobanteId:'comp-1',pagoId:'pago-1',membresiaId:'mem-1',confirmadoEn:'2040-01-01T00:00:00Z'}};
 globalThis.fetch=async(url,options)=>{assert.equal(url,'/api/v1/pagos/pago-1/confirmar');assert.equal(options.headers.get('Authorization'),'Bearer jwt-ficticio');assert.equal(options.headers.get('Idempotency-Key'),'misma-clave');assert.deepEqual(JSON.parse(options.body),{});return json(result);};
 assert.equal((await api.apiOperacionMembresia('/api/v1/pagos/pago-1/confirmar','POST',{},'misma-clave')).comprobante.comprobanteId,'comp-1');
 for(const value of [undefined,{}, {...result,comprobante:null},{...result,pago:{...result.pago,pagoId:'otro'}}]){
  globalThis.fetch=async()=>json(value);await assert.rejects(api.apiOperacionMembresia('/api/v1/pagos/pago-1/confirmar','POST',{},'misma-clave'),{status:502});
 }
});
test('Membresías: ni errores de red ni consultas ajenas se convierten en éxito o historial vacío',async()=>{
 api.setApiSession('jwt-ficticio');globalThis.fetch=async()=>{throw new TypeError('offline');};await assert.rejects(api.apiOperacionMembresia('/api/v1/pagos/pago-1/confirmar','POST',{},'clave'),{status:0});
 globalThis.fetch=async()=>json({items:[{solicitudId:'ajena'}]});await assert.rejects(api.apiSolicitudesMembresia(1,'socio-1'),{status:502});
 globalThis.fetch=async()=>json({});await assert.rejects(api.apiPlanesMembresia(),{status:502});
});
