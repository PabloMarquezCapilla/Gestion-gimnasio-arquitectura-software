import assert from 'node:assert/strict';
import test from 'node:test';
import sociosModule from '../services/socios-membresias/dist/app.js';
import { MemorySociosRepository, SEED_SOCIOS, SEED_MEMBRESIAS } from '../services/socios-membresias/dist/repository.js';
import { hashPassword, verifyPassword } from '../services/socios-membresias/dist/security.js';
import { crearAdministrador } from '../services/socios-membresias/dist/crear-admin.js';

const { buildSociosApp } = sociosModule;
const jwtSecret = 'clave-jwt-ficticia-de-pruebas-de-socios-con-mas-de-32-caracteres';
const internalApiKey = 'clave-interna-ficticia-solo-pruebas';
const fechaActual = '2026-10-19T15:00:00.000Z';
const admin = {
  socioId: 'admin-prueba',
  dni: '90000001',
  nombre: 'Administración Ficticia',
  email: 'admin.prueba@example.com',
  passwordHash: hashPassword('clave-admin-prueba'),
  rol: 'ADMIN',
  estado: 'ACTIVO',
  createdAt: fechaActual,
};

function entorno(t, options = {}) {
  const repository = options.repository ?? new MemorySociosRepository([...SEED_SOCIOS, admin], SEED_MEMBRESIAS);
  const app = buildSociosApp({
    repository, jwtSecret, internalApiKey,
    clock: () => new Date(fechaActual),
    ...options,
  });
  t.after(() => app.close());
  return { app, repository };
}

async function login(app, emailOrDni = admin.email, password = 'clave-admin-prueba') {
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { emailOrDni, password },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

function bearer(token) {
  return { authorization: 'Bearer ' + token };
}

function alta(extra = {}) {
  return {
    dni: '40123456', nombre: 'Persona Nueva Ficticia',
    email: 'persona.nueva@example.com', password: 'clave-socio-nuevo',
    ...extra,
  };
}

test('Solo administración crea cuentas, sin iniciar sesión por el socio ni habilitar membresías', async (t) => {
  const { app, repository } = entorno(t);
  const sesion = await login(app);
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/registro',
    headers: bearer(sesion.token),
    payload: alta({ nombre: ' Persona Nueva Ficticia ', email: ' PERSONA.NUEVA@example.com ' }),
  });
  assert.equal(response.statusCode, 201, response.body);
  const data = response.json();
  assert.equal(data.socio.rol, 'SOCIO');
  assert.equal(data.socio.nombre, 'Persona Nueva Ficticia');
  assert.equal(data.socio.email, 'persona.nueva@example.com');
  assert.equal(data.socio.passwordHash, undefined);
  assert.equal(data.token, undefined);
  assert.equal(data.membresia, null);
  const guardado = await repository.obtenerSocio(data.socio.socioId);
  assert.ok(verifyPassword('clave-socio-nuevo', guardado.passwordHash));
  assert.notEqual(guardado.passwordHash, 'clave-socio-nuevo');
  assert.deepEqual(await repository.obtenerMembresias(data.socio.socioId), []);
  const nuevaSesion = await login(app, data.socio.email, 'clave-socio-nuevo');
  assert.equal(nuevaSesion.membresia, null);
  const habilitacion = await app.inject({
    url: '/api/v1/socios/' + data.socio.socioId + '/habilitacion',
    headers: bearer(nuevaSesion.token),
  });
  assert.equal(habilitacion.json().habilitado, false);
  assert.equal(habilitacion.json().motivo, 'SIN_MEMBRESIA');
  const actual = await app.inject({ url: '/api/v1/auth/me', headers: bearer(sesion.token) });
  assert.equal(actual.json().socio.socioId, admin.socioId);
});

test('Se rechaza el autorregistro y un socio no obtiene permisos administrativos', async (t) => {
  const { app } = entorno(t);
  const socio = await login(app, '11111111', 'socio123');
  for (const ruta of ['/api/v1/auth/registro', '/api/v1/socios']) {
    const anonimo = await app.inject({ method: 'POST', url: ruta, payload: alta() });
    assert.equal(anonimo.statusCode, 401);
    const prohibido = await app.inject({
      method: 'POST', url: ruta, headers: bearer(socio.token), payload: alta(),
    });
    assert.equal(prohibido.statusCode, 403);
  }
  const datos = await app.inject({ url: '/api/v1/socios/socio-demo-01' });
  assert.equal(datos.statusCode, 401);
});

test('Los campos de privilegios y de pago no se aceptan en el alta administrativa', async (t) => {
  const { app, repository } = entorno(t);
  const sesion = await login(app);
  for (const extra of [{ rol: 'ADMIN' }, { passwordHash: 'inyectado' }, { tipoPlan: 'FULL_ANUAL' }, { pagoConfirmado: true }]) {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/socios', headers: bearer(sesion.token), payload: alta(extra),
    });
    assert.equal(response.statusCode, 400, response.body);
  }
  assert.equal(await repository.buscarPorEmailODni('persona.nueva@example.com'), null);
});

test('Login verifica contraseña, estado de cuenta y token firmado de una hora', async (t) => {
  const inactivo = {
    ...SEED_SOCIOS[0], socioId: 'inactivo-prueba', dni: '90000002',
    email: 'inactivo@example.com', estado: 'INACTIVO',
  };
  const repository = new MemorySociosRepository([...SEED_SOCIOS, admin, inactivo], SEED_MEMBRESIAS);
  const { app } = entorno(t, { repository });
  const sesion = await login(app, '11111111', 'socio123');
  const claims = app.jwt.decode(sesion.token);
  assert.equal(claims.sub, 'socio-demo-01');
  assert.equal(claims.rol, 'SOCIO');
  assert.equal(claims.iss, 'gimnasio');
  assert.equal(claims.aud, 'gimnasio-web');
  assert.equal(claims.exp - claims.iat, 3600);
  assert.equal(sesion.socio.passwordHash, undefined);
  for (const emailOrDni of ['11111111', 'desconocido@example.com']) {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/auth/login', payload: { emailOrDni, password: 'incorrecta' },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().codigo, 'CREDENCIALES_INVALIDAS');
  }
  const response = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { emailOrDni: inactivo.email, password: 'socio123' },
  });
  assert.equal(response.statusCode, 403);
  const malformado = await app.inject({
    method: 'POST', url: '/api/v1/auth/login',
    payload: { emailOrDni: 11111111, password: {} },
  });
  assert.equal(malformado.statusCode, 400);
});

test('Se rechazan tokens alterados, de otro emisor/audiencia/algoritmo y Base64 sin firma', async (t) => {
  const { app } = entorno(t);
  const sesion = await login(app);
  const claims = app.jwt.decode(sesion.token);
  const payload = { sub: claims.sub, rol: claims.rol, iat: claims.iat, exp: claims.exp };
  const partes = sesion.token.split('.');
  partes[1] = Buffer.from(JSON.stringify({ ...claims, sub: 'socio-demo-01' })).toString('base64url');
  const tokens = [
    partes.join('.'),
    Buffer.from('admin-prueba:123').toString('base64'),
    app.jwt.sign(payload, { iss: 'otro-emisor' }),
    app.jwt.sign(payload, { aud: 'otro-destino' }),
    app.jwt.sign(payload, { algorithm: 'HS384' }),
    app.jwt.sign({ sub: claims.sub, rol: claims.rol, iat: claims.iat }),
  ];
  for (const token of tokens) {
    const response = await app.inject({ url: '/api/v1/auth/me', headers: bearer(token) });
    assert.equal(response.statusCode, 401, response.body);
  }
});

test('La expiración se verifica también después de haber utilizado el token', async (t) => {
  let instante = Date.parse(fechaActual);
  const { app } = entorno(t, { jwtTtlSeconds: 2, clock: () => new Date(instante) });
  const sesion = await login(app);
  assert.equal((await app.inject({ url: '/api/v1/auth/me', headers: bearer(sesion.token) })).statusCode, 200);
  instante += 2000;
  const vencido = await app.inject({ url: '/api/v1/auth/me', headers: bearer(sesion.token) });
  assert.equal(vencido.statusCode, 401);
});

test('Propiedad de datos: socio propio, administrador y credencial técnica limitada', async (t) => {
  const { app } = entorno(t);
  const socio = await login(app, '11111111', 'socio123');
  const sesionAdmin = await login(app);
  const propio = await app.inject({ url: '/api/v1/socios/socio-demo-01', headers: bearer(socio.token) });
  assert.equal(propio.statusCode, 200);
  assert.equal(propio.json().passwordHash, undefined);
  for (const suffix of ['', '/habilitacion']) {
    const ajeno = await app.inject({ url: '/api/v1/socios/socio-demo-02' + suffix, headers: bearer(socio.token) });
    assert.equal(ajeno.statusCode, 403);
    assert.equal((await app.inject({
      url: '/api/v1/socios/socio-demo-02' + suffix, headers: bearer(sesionAdmin.token),
    })).statusCode, 200);
  }
  const tecnico = await app.inject({
    url: '/api/v1/socios/socio-demo-02/habilitacion', headers: { 'x-service-key': internalApiKey },
  });
  assert.equal(tecnico.statusCode, 200);
  assert.equal(tecnico.json().habilitado, true);
  assert.equal((await app.inject({
    url: '/api/v1/socios/socio-demo-02', headers: { 'x-service-key': internalApiKey },
  })).statusCode, 401);
  assert.equal((await app.inject({
    url: '/api/v1/socios/socio-demo-02/habilitacion', headers: { 'x-api-key': internalApiKey },
  })).statusCode, 401);
  const claims = app.jwt.decode(socio.token);
  const rolIncompatible = app.jwt.sign({ ...claims, rol: 'ADMIN' });
  assert.equal((await app.inject({
    method: 'POST', url: '/api/v1/socios', headers: bearer(rolIncompatible), payload: alta(),
  })).statusCode, 403);
});

test('DNI y email normalizados son únicos incluso ante altas concurrentes', async (t) => {
  const { app } = entorno(t);
  const sesion = await login(app);
  const respuestas = await Promise.all([
    app.inject({ method: 'POST', url: '/api/v1/socios', headers: bearer(sesion.token), payload: alta() }),
    app.inject({
      method: 'POST', url: '/api/v1/socios', headers: bearer(sesion.token),
      payload: alta({ dni: '40123457', email: ' PERSONA.NUEVA@EXAMPLE.COM ' }),
    }),
  ]);
  assert.deepEqual(respuestas.map((r) => r.statusCode).sort(), [201, 409]);
  const duplicadoDni = await app.inject({
    method: 'POST', url: '/api/v1/socios', headers: bearer(sesion.token),
    payload: alta({ dni: ' 11111111 ', email: 'otro@example.com' }),
  });
  assert.equal(duplicadoDni.statusCode, 409);
});

test('Activar o renovar membresías devuelve pendiente real de pagos y no escribe cambios', async (t) => {
  const { app, repository } = entorno(t);
  const sesion = await login(app);
  const antes = await repository.obtenerMembresias('socio-demo-01');
  for (const estado of ['HABILITADA', 'SUSPENDIDA']) {
    const response = await app.inject({
      method: 'POST', url: '/api/v1/socios/socio-demo-01/membresias',
      headers: bearer(sesion.token),
      payload: { tipoPlan: 'FULL_ANUAL', estado, pagoConfirmado: true },
    });
    assert.equal(response.statusCode, 501);
    assert.equal(response.json().codigo, 'PAGOS_NO_IMPLEMENTADOS');
  }
  assert.deepEqual(await repository.obtenerMembresias('socio-demo-01'), antes);
});

test('La renovación futura no oculta la membresía vigente y las fechas inválidas no habilitan', async (t) => {
  const socio = {
    ...SEED_SOCIOS[0], socioId: 'socio-periodos', dni: '90000003', email: 'periodos@example.com',
  };
  const base = {
    socioId: socio.socioId, tipoPlan: 'MENSUAL', estado: 'HABILITADA',
    createdAt: fechaActual, updatedAt: fechaActual,
  };
  const actual = { ...base, membresiaId: 'periodo-actual', fechaInicio: '2026-10-01T00:00:00Z', fechaFin: '2026-10-31T23:59:59Z' };
  const futura = { ...base, membresiaId: 'periodo-futuro', createdAt: '2026-10-20T00:00:00Z', fechaInicio: '2026-11-01T00:00:00Z', fechaFin: '2026-11-30T23:59:59Z' };
  const repository = new MemorySociosRepository([socio], [actual, futura]);
  const { app } = entorno(t, { repository });
  const consultar = async (fecha) => app.inject({
    url: '/api/v1/socios/' + socio.socioId + '/habilitacion?fecha=' + encodeURIComponent(fecha),
    headers: { 'x-service-key': internalApiKey },
  });
  const hoy = (await consultar(fechaActual)).json();
  assert.equal(hoy.habilitado, true);
  assert.equal(hoy.membresia.membresiaId, actual.membresiaId);
  const despues = (await consultar('2026-11-12T15:00:00Z')).json();
  assert.equal(despues.habilitado, true);
  assert.equal(despues.membresia.membresiaId, futura.membresiaId);
  for (const fecha of ['2026', '2026-02-30T15:00:00Z', '2026-10-19T15:00:00']) {
    assert.equal((await consultar(fecha)).statusCode, 400);
  }
  await repository.crearMembresia({
    ...base, membresiaId: 'periodo-invalido', fechaInicio: 'no-fecha', fechaFin: 'no-fecha',
  });
  assert.equal((await consultar(fechaActual)).json().membresia.membresiaId, actual.membresiaId);
});

test('Una membresía solo futura o suspendida no habilita en la fecha actual', async (t) => {
  const socio = { ...SEED_SOCIOS[0], socioId: 'futuro-prueba', dni: '90000004', email: 'futuro@example.com' };
  const membresia = {
    ...SEED_MEMBRESIAS[0], socioId: socio.socioId, membresiaId: 'solo-futura',
    fechaInicio: '2026-11-01T00:00:00Z', fechaFin: '2026-11-30T23:59:59Z',
  };
  const repository = new MemorySociosRepository([socio], [membresia]);
  const { app } = entorno(t, { repository });
  const headers = { 'x-service-key': internalApiKey };
  const ruta = '/api/v1/socios/' + socio.socioId + '/habilitacion';
  assert.equal((await app.inject({ url: ruta, headers })).json().habilitado, false);
  assert.equal((await app.inject({ url: ruta + '?fecha=2026-11-12T15:00:00Z', headers })).json().habilitado, true);
  await repository.actualizarEstadoMembresia(membresia.membresiaId, 'SUSPENDIDA');
  assert.equal((await app.inject({ url: ruta + '?fecha=2026-11-12T15:00:00Z', headers })).json().habilitado, false);
});

test('Bootstrap local crea administrador explícito y nunca sobrescribe una cuenta existente', async () => {
  assert.equal(SEED_SOCIOS.some((s) => s.rol === 'ADMIN'), false);
  const repository = new MemorySociosRepository([], []);
  const datos = alta({ email: 'administracion@example.com' });
  const creado = await crearAdministrador(repository, datos, () => new Date(fechaActual));
  assert.equal(creado.rol, 'ADMIN');
  assert.equal(creado.passwordHash, undefined);
  const antes = await repository.obtenerSocio(creado.socioId);
  await assert.rejects(
    crearAdministrador(repository, { ...datos, password: 'otra-clave-distinta' }),
    (error) => error.statusCode === 409,
  );
  const despues = await repository.obtenerSocio(creado.socioId);
  assert.deepEqual(despues, antes);
  assert.ok(verifyPassword(datos.password, despues.passwordHash));
  await assert.rejects(
    crearAdministrador(repository, { ...datos, email: 'otro-email@example.com' }),
    (error) => error.statusCode === 409,
  );
});

test('La aplicación falla antes de iniciar cuando falta la configuración de autenticación', () => {
  assert.throws(() => buildSociosApp({ jwtSecret: 'corta', internalApiKey }), /AUTH_JWT_SECRET/);
  assert.throws(() => buildSociosApp({ jwtSecret, internalApiKey: '' }), /SERVICIOS_API_KEY/);
  assert.throws(() => buildSociosApp({ jwtSecret, internalApiKey, jwtTtlSeconds: 0 }), /AUTH_JWT_TTL_SECONDS/);
});
