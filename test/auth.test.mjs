import assert from 'node:assert/strict';
import test from 'node:test';
import sociosModule from '../services/socios-membresias/dist/app.js';
import { MemorySociosRepository } from '../services/socios-membresias/dist/repository.js';
import { verifyPassword } from '../services/socios-membresias/dist/security.js';

const { buildSociosApp } = sociosModule;

test('Auth: Registro con hash de contraseña, persistencia y membresía inicial', async () => {
  const repository = new MemorySociosRepository();
  const app = buildSociosApp({ repository, logger: false });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/registro',
    payload: {
      dni: '40123456',
      nombre: 'Carlos Fitness',
      email: 'carlos.fitness@pulse.com',
      password: 'passwordSeguro123',
      telefono: '+54 9 11 1234-5678',
      tipoPlan: 'FULL_ANUAL',
    },
  });

  assert.equal(res.statusCode, 201);
  const data = res.json();
  assert.ok(data.token, 'Debe devolver un token de autenticación');
  assert.equal(data.socio.nombre, 'Carlos Fitness');
  assert.equal(data.socio.dni, '40123456');
  assert.equal(data.socio.email, 'carlos.fitness@pulse.com');
  assert.equal(data.socio.rol, 'SOCIO');
  assert.equal(data.socio.passwordHash, undefined, 'No debe filtrar el passwordHash en la respuesta');
  assert.ok(data.membresia, 'Debe crear la membresía inicial');
  assert.equal(data.membresia.tipoPlan, 'FULL_ANUAL');
  assert.equal(data.membresia.estado, 'HABILITADA');

  // Verificar que en la base de datos la clave está hasheada
  const socioEnBD = await repository.buscarPorEmailODni('carlos.fitness@pulse.com');
  assert.ok(socioEnBD?.passwordHash, 'Debe existir hash en base de datos');
  assert.notEqual(socioEnBD?.passwordHash, 'passwordSeguro123', 'No debe estar en texto plano');
  assert.ok(socioEnBD?.passwordHash?.includes(':'), 'Formato scrypt salt:hash');
  assert.ok(verifyPassword('passwordSeguro123', socioEnBD.passwordHash));
});

test('Auth: Rechazo de duplicados por DNI y correo', async () => {
  const repository = new MemorySociosRepository();
  const app = buildSociosApp({ repository, logger: false });

  // Intento registrar con el email de Juan Pérez (socio sembrado)
  const resDupEmail = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/registro',
    payload: {
      dni: '99887766',
      nombre: 'Otro Juan',
      email: 'juan.perez@example.com',
      password: 'claveValida123',
    },
  });
  assert.equal(resDupEmail.statusCode, 409);
  assert.equal(resDupEmail.json().codigo, 'EMAIL_EN_USO');

  // Intento registrar con el DNI de Juan Pérez
  const resDupDni = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/registro',
    payload: {
      dni: '11111111',
      nombre: 'Otro Juan 2',
      email: 'otro.email@example.com',
      password: 'claveValida123',
    },
  });
  assert.equal(resDupDni.statusCode, 409);
  assert.equal(resDupDni.json().codigo, 'DNI_EN_USO');
});

test('Auth: Login con email o DNI, verificación de hash y rechazo de contraseña incorrecta', async () => {
  const repository = new MemorySociosRepository();
  const app = buildSociosApp({ repository, logger: false });

  // Login con email válido de Juan Pérez
  const resLoginEmail = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      emailOrDni: 'juan.perez@example.com',
      password: 'socio123',
    },
  });
  assert.equal(resLoginEmail.statusCode, 200);
  const dataEmail = resLoginEmail.json();
  assert.equal(dataEmail.socio.nombre, 'Juan Pérez');
  assert.equal(dataEmail.socio.rol, 'SOCIO');
  assert.ok(dataEmail.token);
  assert.equal(dataEmail.membresia?.estado, 'HABILITADA');

  // Login con DNI válido de Juan Pérez
  const resLoginDni = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      emailOrDni: '11111111',
      password: 'socio123',
    },
  });
  assert.equal(resLoginDni.statusCode, 200);

  // Login de Admin (Valeria Méndez)
  const resAdmin = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      emailOrDni: 'admin@pulse.com',
      password: 'admin123',
    },
  });
  assert.equal(resAdmin.statusCode, 200);
  assert.equal(resAdmin.json().socio.rol, 'ADMIN');

  // Login con contraseña incorrecta
  const resFailClave = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: {
      emailOrDni: 'juan.perez@example.com',
      password: 'clave-incorrecta',
    },
  });
  assert.equal(resFailClave.statusCode, 401);
  assert.equal(resFailClave.json().codigo, 'CREDENCIALES_INVALIDAS');
});
