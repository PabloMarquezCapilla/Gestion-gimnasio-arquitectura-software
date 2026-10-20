import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createSigner } from 'fast-jwt';
import appModule from '../dist/app.js';
import repositoryModule from '../dist/repository.js';
import serviceModule from '../dist/application/reservas.service.js';
import clientModule from '../dist/clients/socios.client.js';

const { buildApp } = appModule;
const { MemoryClaseRepository } = repositoryModule;
const { ReservasService } = serviceModule;
const { HttpSociosClient } = clientModule;
const configuration = {
  apiKey: 'clave-externa-ficticia',
  jwtSecret: 'secreto-ficticio-compartido-pruebas-mas-de-32-caracteres',
  internalApiKey: 'clave-interna-ficticia-pruebas',
};
const inicio = '2026-11-20T18:00:00Z';
const now = '2026-10-19T12:00:00Z';
const enabled = async (socioId) => ({ socioId, habilitado: true });

function environment(client = { verificarHabilitacion: enabled }, cupos = 1) {
  const time = { value: now };
  const clock = () => new Date(time.value);
  const repository = new MemoryClaseRepository([{
    claseId: 'clase-ficticia', nombre: 'Clase Ficticia', sedeId: 'sede-ficticia',
    inicio, capacidad: 1, cuposDisponibles: cupos, publicada: true,
  }], false);
  const service = new ReservasService(repository, client, { clock });
  return { time, clock, repository, service, client };
}

test('comprueba vigencia actual y al inicio; no admite cobertura solo futura ni solo actual', async () => {
  for (const fechaRechazada of [now, inicio]) {
    const checked = [];
    const { service, repository } = environment({
      verificarHabilitacion: async (socioId, fecha) => {
        checked.push(fecha);
        return { socioId, habilitado: Date.parse(fecha) !== Date.parse(fechaRechazada) };
      },
    });
    assert.equal((await service.reservar('clase-ficticia', 'socio-a')).codigo, 'MEMBRESIA_NO_HABILITADA');
    assert.deepEqual(checked.map(Date.parse).sort(), [now, inicio].map(Date.parse).sort());
    assert.equal((await repository.obtenerReservasPorClase('clase-ficticia')).length, 0);
  }
});

test('la espera es voluntaria y se registra atómicamente; no admite cola innecesaria', async () => {
  const { service, repository } = environment();
  assert.equal((await service.ingresarEspera('clase-ficticia', 'socio-b')).codigo, 'CLASE_CON_CUPOS');
  assert.equal((await service.reservar('clase-ficticia', 'socio-a')).exito, true);
  assert.equal((await service.reservar('clase-ficticia', 'socio-b')).codigo, 'CLASE_SIN_CUPOS');
  assert.equal((await repository.obtenerEsperaPorClase('clase-ficticia')).length, 0);
  const wait = await service.reservar('clase-ficticia', 'socio-b', true);
  assert.equal(wait.espera.estado, 'PENDIENTE');
  assert.equal((await service.reservar('clase-ficticia', 'socio-b', true)).codigo, 'YA_EN_ESPERA');
  assert.equal((await repository.obtenerEsperaPorClase('clase-ficticia')).length, 1);
});

test('cancelar con Socios caído conserva FIFO y la recuperación funciona con otra instancia del servicio', async () => {
  let down = false;
  const context = environment({
    verificarHabilitacion: async (socioId) => {
      if (down && socioId === 'socio-b') throw new Error('Falla ficticia.');
      return { socioId, habilitado: true };
    },
  });
  const { service, repository, clock, client } = context;
  const first = await service.reservar('clase-ficticia', 'socio-a');
  await service.ingresarEspera('clase-ficticia', 'socio-b');
  await service.ingresarEspera('clase-ficticia', 'socio-c');
  down = true;
  const cancellation = await service.cancelarReserva(first.reserva.reservaId);
  assert.equal(cancellation.exito, true);
  assert.equal(cancellation.reasignacionPendiente, true);
  assert.equal((await service.procesarPendientes()).pendientes, 1);
  assert.equal((await service.reservar('clase-ficticia', 'socio-d')).codigo, 'CLASE_SIN_CUPOS');
  assert.deepEqual((await repository.obtenerEsperaPorClase('clase-ficticia')).map((e) => e.estado), ['PENDIENTE', 'PENDIENTE']);
  down = false;
  const restarted = new ReservasService(repository, client, { clock });
  assert.equal((await restarted.procesarPendientes()).promovidas, 1);
  const confirmed = (await repository.obtenerReservasPorClase('clase-ficticia')).filter((r) => r.estado === 'CONFIRMADA');
  assert.deepEqual(confirmed.map((r) => r.socioId), ['socio-b']);
});

test('retira al primero realmente inhabilitado y promueve al siguiente sin duplicar entre procesadores', async () => {
  let invalid = false;
  const { service, repository, client, clock } = environment({
    verificarHabilitacion: async (socioId) => ({ socioId, habilitado: !(invalid && socioId === 'socio-b') }),
  });
  const first = await service.reservar('clase-ficticia', 'socio-a');
  await service.ingresarEspera('clase-ficticia', 'socio-b');
  await service.ingresarEspera('clase-ficticia', 'socio-c');
  await service.cancelarReserva(first.reserva.reservaId);
  invalid = true;
  await Promise.all([service.procesarPendientes(), new ReservasService(repository, client, { clock }).procesarPendientes()]);
  assert.deepEqual((await repository.obtenerEsperaPorClase('clase-ficticia')).map((e) => e.estado), ['CANCELADO', 'PROMOVIDO']);
  assert.equal((await repository.obtenerReservasPorClase('clase-ficticia')).filter((r) => r.estado === 'CONFIRMADA').length, 1);
});

test('una reserva nueva durante la validación de una promoción no toma su cupo ni produce sobreventa', async () => {
  let blocking = false;
  let release;
  let arrived;
  const gate = new Promise((resolve) => { release = resolve; });
  const observed = new Promise((resolve) => { arrived = resolve; });
  const { service, repository } = environment({
    verificarHabilitacion: async (socioId) => {
      if (blocking && socioId === 'socio-b') { arrived(); await gate; }
      return { socioId, habilitado: true };
    },
  });
  const first = await service.reservar('clase-ficticia', 'socio-a');
  await service.ingresarEspera('clase-ficticia', 'socio-b');
  await service.cancelarReserva(first.reserva.reservaId);
  blocking = true;
  const processing = service.procesarPendientes();
  await observed;
  assert.equal((await service.reservar('clase-ficticia', 'socio-c')).codigo, 'CLASE_SIN_CUPOS');
  // La cancelación repetida tampoco libera otro lugar ni espera la llamada remota.
  assert.equal((await service.cancelarReserva(first.reserva.reservaId)).exito, true);
  release();
  await processing;
  const confirmed = (await repository.obtenerReservasPorClase('clase-ficticia')).filter((r) => r.estado === 'CONFIRMADA');
  assert.deepEqual(confirmed.map((r) => r.socioId), ['socio-b']);
});

test('los cortes temporales se vuelven a evaluar después de esperar validaciones', async () => {
  const context = environment({
    verificarHabilitacion: async (socioId) => {
      context.time.value = inicio;
      return { socioId, habilitado: true };
    },
  });
  assert.equal((await context.service.reservar('clase-ficticia', 'socio-a')).codigo, 'CLASE_INICIADA');
  assert.equal((await context.service.ingresarEspera('clase-ficticia', 'socio-a')).codigo, 'CLASE_INICIADA');
  const other = environment();
  const first = await other.service.reservar('clase-ficticia', 'socio-a');
  await other.service.ingresarEspera('clase-ficticia', 'socio-b');
  other.time.value = inicio;
  assert.equal((await other.service.cancelarReserva(first.reserva.reservaId)).codigo, 'CLASE_INICIADA');
  assert.equal((await other.service.procesarPendientes()).promovidas, 0);
  let late = false;
  const promotion = environment({
    verificarHabilitacion: async (socioId) => {
      if (late) promotion.time.value = inicio;
      return { socioId, habilitado: true };
    },
  });
  const original = await promotion.service.reservar('clase-ficticia', 'socio-a');
  await promotion.service.ingresarEspera('clase-ficticia', 'socio-b');
  await promotion.service.cancelarReserva(original.reserva.reservaId);
  late = true;
  assert.equal((await promotion.service.procesarPendientes()).promovidas, 0);
  assert.equal((await promotion.repository.obtenerReservasPorClase('clase-ficticia')).filter((r) => r.estado === 'CONFIRMADA').length, 0);
});

test('JWT exige sesión propia o administrador; la clave externa no autoriza datos personales ni mutaciones', async () => {
  const state = environment();
  const { repository, client, clock } = state;
  const app = buildApp({ ...configuration, repository, sociosClient: client, clock });
  await app.ready();
  const token = (sub, rol = 'SOCIO') => 'Bearer ' + app.jwt.sign({ sub, rol });
  const request = (url, authorization, method = 'GET', payload) => app.inject({
    method, url, payload, headers: { ...(authorization ? { authorization } : {}), 'x-api-key': configuration.apiKey },
  });
  try {
    assert.equal((await request('/api/v1/reservas', undefined, 'POST', { claseId: 'clase-ficticia', socioId: 'socio-a' })).statusCode, 401);
    const created = await request('/api/v1/reservas', token('socio-a'), 'POST', { claseId: 'clase-ficticia' });
    assert.equal(created.statusCode, 201);
    assert.equal((await request('/api/v1/reservas', token('socio-b'), 'POST', { claseId: 'clase-ficticia', socioId: 'socio-a' })).statusCode, 403);
    const cancelUrl = '/api/v1/reservas/' + created.json().reservaId + '/cancelar';
    assert.equal((await request(cancelUrl, token('socio-b'), 'POST')).statusCode, 403);
    assert.equal((await request('/api/v1/reservas/clases?socioId=socio-a', token('socio-b'))).statusCode, 403);
    assert.equal((await request('/api/v1/reservas/clases', token('socio-a'))).json().reservasSocio.length, 1);
    assert.equal((await request('/api/v1/clases/clase-ficticia/reservas')).statusCode, 401);
    assert.equal((await request('/api/v1/clases/clase-ficticia/reservas', token('socio-a'))).statusCode, 403);
    assert.equal((await request('/api/v1/clases/clase-ficticia/reservas', token('admin-ficticio', 'ADMIN'))).statusCode, 200);
    const expired = createSigner({
      key: configuration.jwtSecret, algorithm: 'HS256', iss: 'gimnasio', aud: 'gimnasio-web',
      clockTimestamp: Date.parse(now) - 10000, expiresIn: '1s',
    })({ sub: 'socio-a', rol: 'SOCIO' });
    assert.equal((await request('/api/v1/reservas/clases', 'Bearer ' + expired)).statusCode, 401);
    const wrongSignature = createSigner({
      key: 'otro-secreto-ficticio-sin-permiso-mas-de-32-caracteres', algorithm: 'HS256',
      iss: 'gimnasio', aud: 'gimnasio-web', clockTimestamp: Date.parse(now), expiresIn: '1h',
    })({ sub: 'socio-a', rol: 'ADMIN' });
    assert.equal((await request('/api/v1/reservas/clases', 'Bearer ' + wrongSignature)).statusCode, 401);
    assert.equal((await request(cancelUrl, token('socio-a'), 'POST')).statusCode, 200);
    const atBoundary = token('socio-a');
    state.time.value = new Date(Date.parse(now) + 3600 * 1000).toISOString();
    assert.equal((await request('/api/v1/reservas/clases', atBoundary)).statusCode, 401);
  } finally { await app.close(); }
});

test('el cliente interno usa credencial y limita también cuerpos lentos; 401 y 503 nunca son inhabilitación', async () => {
  const server = createServer((request, response) => {
    assert.equal(request.headers['x-service-key'], configuration.internalApiKey);
    if (request.url.includes('/lento/')) {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.write('{"socioId":"lento","habilitado":');
      return;
    }
    response.writeHead(request.url.includes('/denegado/') ? 401 : 503);
    response.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const client = new HttpSociosClient('http://127.0.0.1:' + server.address().port, 100, configuration.internalApiKey);
  try {
    for (const socio of ['lento', 'denegado', 'indisponible']) {
      const start = Date.now();
      await assert.rejects(client.verificarHabilitacion(socio, now), { statusCode: 503 });
      assert.ok(Date.now() - start < 1500, 'El presupuesto debe limitar fetch, cuerpo y reintento.');
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
