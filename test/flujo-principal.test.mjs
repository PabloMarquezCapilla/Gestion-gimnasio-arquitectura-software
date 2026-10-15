import assert from 'node:assert/strict';
import test from 'node:test';
import clasesModule from '../services/clases-reservas/dist/app.js';
import sociosModule from '../services/socios-membresias/dist/app.js';
import { MemoryClaseRepository } from '../services/clases-reservas/dist/repository.js';
import { MemorySociosRepository } from '../services/socios-membresias/dist/repository.js';

const { buildApp: buildClasesApp } = clasesModule;
const { buildSociosApp } = sociosModule;

const apiKey = 'test-api-key-flujo';

class IntegratedSociosClient {
  constructor(sociosApp) {
    this.sociosApp = sociosApp;
  }

  async verificarHabilitacion(socioId, fecha, traceContext) {
    const headers = { Accept: 'application/json' };
    if (traceContext) {
      headers.traceparent = `00-${traceContext.traceId}-${traceContext.spanId}-${traceContext.traceFlags}`;
      headers['x-correlation-id'] = traceContext.traceId;
    }
    const url = `/api/v1/socios/${encodeURIComponent(socioId)}/habilitacion${
      fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''
    }`;
    const response = await this.sociosApp.inject({ method: 'GET', url, headers });
    return response.json();
  }
}

async function setupTestEnvironment() {
  const sociosRepo = new MemorySociosRepository();
  const sociosLogs = [];
  const sociosApp = buildSociosApp({
    repository: sociosRepo,
    logger: false,
  });

  const clasesRepo = new MemoryClaseRepository(undefined, false);
  const clasesClient = new IntegratedSociosClient(sociosApp);
  const clasesLogs = [];
  const clasesApp = buildClasesApp({
    apiKey,
    repository: clasesRepo,
    sociosClient: clasesClient,
    logger: false,
  });

  return { sociosApp, clasesApp, sociosRepo, clasesRepo };
}

test('Flujo principal de punta a punta: consulta de clases, validacion de membresia y reserva exitosa', async () => {
  const { sociosApp, clasesApp } = await setupTestEnvironment();

  try {
    // 1. El socio consulta su membresia en Socios y Membresias
    const resSocio = await sociosApp.inject({
      method: 'GET',
      url: '/api/v1/socios/socio-demo-01/habilitacion',
    });
    assert.equal(resSocio.statusCode, 200);
    const bodySocio = resSocio.json();
    assert.equal(bodySocio.habilitado, true);

    // 2. Consulta de la capacidad compartida: listar clases y cupos disponibles
    const resCatalogo = await clasesApp.inject({
      method: 'GET',
      url: '/api/v1/clases?sedeId=sede-demo-01',
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(resCatalogo.statusCode, 200);
    const catalogo = resCatalogo.json();
    assert.ok(catalogo.items.length > 0);
    const claseYoga = catalogo.items.find((c) => c.claseId === 'clase-demo-001');
    assert.ok(claseYoga);
    const cuposIniciales = claseYoga.cuposDisponibles;
    assert.ok(cuposIniciales > 0);

    // 3. Socio solicita una reserva para la clase de Yoga
    // Enviamos una cabecera W3C traceparent inicial para correlacionar
    const clientTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const clientSpanId = '00f067aa0ba902b7';
    const traceparentHeader = `00-${clientTraceId}-${clientSpanId}-01`;

    const resReserva = await clasesApp.inject({
      method: 'POST',
      url: '/api/v1/reservas',
      headers: {
        'content-type': 'application/json',
        traceparent: traceparentHeader,
      },
      payload: {
        claseId: 'clase-demo-001',
        socioId: 'socio-demo-01',
      },
    });

    assert.equal(resReserva.statusCode, 201);
    const reserva = resReserva.json();
    assert.equal(reserva.estado, 'CONFIRMADA');
    assert.equal(reserva.claseId, 'clase-demo-001');
    assert.equal(reserva.socioId, 'socio-demo-01');

    // 4. Verificacion de propagacion de traza distribuida (W3C Trace Context)
    assert.ok(resReserva.headers['traceparent']);
    assert.ok(resReserva.headers['traceparent'].includes(clientTraceId));
    assert.equal(resReserva.headers['x-correlation-id'], clientTraceId);

    // 5. Verificacion de decremento de cupos disponibles en la capacidad compartida
    const resDetalle = await clasesApp.inject({
      method: 'GET',
      url: '/api/v1/clases/clase-demo-001',
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(resDetalle.statusCode, 200);
    const detalleActualizado = resDetalle.json();
    assert.equal(detalleActualizado.cuposDisponibles, cuposIniciales - 1);
  } finally {
    await sociosApp.close();
    await clasesApp.close();
  }
});

test('Garantias de consistencia: duplicados rechazados y membresia inactiva rechazada', async () => {
  const { sociosApp, clasesApp } = await setupTestEnvironment();

  try {
    // 1. Socio reserva por primera vez
    const res1 = await clasesApp.inject({
      method: 'POST',
      url: '/api/v1/reservas',
      headers: { 'content-type': 'application/json' },
      payload: { claseId: 'clase-demo-001', socioId: 'socio-demo-01' },
    });
    assert.equal(res1.statusCode, 201);

    // 2. Intento de reserva duplicada para el mismo socio y clase -> 409
    const resDuplicada = await clasesApp.inject({
      method: 'POST',
      url: '/api/v1/reservas',
      headers: { 'content-type': 'application/json' },
      payload: { claseId: 'clase-demo-001', socioId: 'socio-demo-01' },
    });
    assert.equal(resDuplicada.statusCode, 409);
    assert.equal(resDuplicada.json().codigo, 'RESERVA_DUPLICADA');

    // 3. Socio con membresia vencida intenta reservar -> 422 MEMBRESIA_NO_HABILITADA
    const resVencido = await clasesApp.inject({
      method: 'POST',
      url: '/api/v1/reservas',
      headers: { 'content-type': 'application/json' },
      payload: { claseId: 'clase-demo-001', socioId: 'socio-vencido-01' },
    });
    assert.equal(resVencido.statusCode, 422);
    assert.equal(resVencido.json().codigo, 'MEMBRESIA_NO_HABILITADA');

    // 4. Socio inexistente intenta reservar -> 422 MEMBRESIA_NO_HABILITADA
    const resInexistente = await clasesApp.inject({
      method: 'POST',
      url: '/api/v1/reservas',
      headers: { 'content-type': 'application/json' },
      payload: { claseId: 'clase-demo-001', socioId: 'socio-fantasma-999' },
    });
    assert.equal(resInexistente.statusCode, 422);
  } finally {
    await sociosApp.close();
    await clasesApp.close();
  }
});

test('Flujo de clase llena: ingreso a lista de espera, cancelacion y promocion automatica', async () => {
  const { sociosApp, clasesApp } = await setupTestEnvironment();

  try {
    // clase-demo-002 tiene 0 cupos disponibles inicialmente
    const resDetalleInicial = await clasesApp.inject({
      method: 'GET',
      url: '/api/v1/clases/clase-demo-002',
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(resDetalleInicial.json().cuposDisponibles, 0);

    // 1. Socio intenta reservar clase llena sin espera -> 409
    const resSinCupo = await clasesApp.inject({
      method: 'POST',
      url: '/api/v1/reservas',
      headers: { 'content-type': 'application/json' },
      payload: { claseId: 'clase-demo-002', socioId: 'socio-demo-01' },
    });
    assert.equal(resSinCupo.statusCode, 409);
    assert.equal(resSinCupo.json().codigo, 'CLASE_SIN_CUPOS');
    assert.equal(resSinCupo.json().puedeIngresarEspera, true);

    // 2. Socio ingresa a la lista de espera voluntariamente
    const resEspera = await clasesApp.inject({
      method: 'POST',
      url: '/api/v1/clases/clase-demo-002/espera',
      headers: { 'content-type': 'application/json' },
      payload: { socioId: 'socio-demo-01' },
    });
    assert.equal(resEspera.statusCode, 201);
    const entrada = resEspera.json();
    assert.equal(entrada.estado, 'PENDIENTE');
    assert.equal(entrada.socioId, 'socio-demo-01');

    // 3. Inspeccionar reservas existentes para cancelar una
    const resInspeccion = await clasesApp.inject({
      method: 'GET',
      url: '/api/v1/clases/clase-demo-002/reservas',
      headers: { 'x-api-key': apiKey },
    });
    const { reservas } = resInspeccion.json();
    assert.ok(reservas.length > 0);
    const reservaACancelar = reservas[0];

    // 4. Cancelar la reserva -> debe liberar el cupo y promover al socio en espera
    const resCanc = await clasesApp.inject({
      method: 'POST',
      url: `/api/v1/reservas/${reservaACancelar.reservaId}/cancelar`,
    });
    assert.equal(resCanc.statusCode, 200);
    const cancelacion = resCanc.json();
    assert.equal(cancelacion.exito, true);
    assert.ok(cancelacion.promocion);
    assert.equal(cancelacion.promocion.socioId, 'socio-demo-01');

    // 5. Verificar que el socio promovido ahora tiene reserva CONFIRMADA
    const resInspeccionPost = await clasesApp.inject({
      method: 'GET',
      url: '/api/v1/clases/clase-demo-002/reservas',
      headers: { 'x-api-key': apiKey },
    });
    const postReservas = resInspeccionPost.json().reservas;
    const reservaPromovida = postReservas.find((r) => r.socioId === 'socio-demo-01');
    assert.ok(reservaPromovida);
    assert.equal(reservaPromovida.estado, 'CONFIRMADA');
  } finally {
    await sociosApp.close();
    await clasesApp.close();
  }
});
