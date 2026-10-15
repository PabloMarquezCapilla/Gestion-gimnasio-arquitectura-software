import assert from 'node:assert/strict';
import test from 'node:test';
import clasesModule from '../services/clases-reservas/dist/app.js';
import sociosModule from '../services/socios-membresias/dist/app.js';
import { MemoryClaseRepository } from '../services/clases-reservas/dist/repository.js';
import { MemorySociosRepository } from '../services/socios-membresias/dist/repository.js';

const { buildApp: buildClasesApp } = clasesModule;
const { buildSociosApp } = sociosModule;
const apiKey = 'test-api-key-concurrencia';

class MockSociosAlwaysEnabled {
  async verificarHabilitacion(socioId) {
    return {
      socioId,
      habilitado: true,
      membresia: {
        membresiaId: `mem-${socioId}`,
        tipoPlan: 'FULL',
        estado: 'HABILITADA',
        fechaInicio: '2026-01-01T00:00:00.000Z',
        fechaFin: '2027-12-31T23:59:59.000Z',
      },
    };
  }
}

test('D4 / D13 Concurrencia extrema: 50 solicitudes simultaneas compitiendo por 1 solo cupo libre', async () => {
  // Clase de prueba con capacidad 10 y 9 cupos ya ocupados (exactamente 1 cupo disponible)
  const claseTest = {
    claseId: 'clase-concurrencia-01',
    nombre: 'Spinning Competitivo',
    sedeId: 'sede-demo-01',
    inicio: '2026-11-20T10:00:00-03:00',
    capacidad: 10,
    cuposDisponibles: 1,
    publicada: true,
  };

  const repository = new MemoryClaseRepository([claseTest], false);
  const sociosClient = new MockSociosAlwaysEnabled();

  const app = buildClasesApp({
    apiKey,
    repository,
    sociosClient,
    logger: false,
    clock: () => new Date('2026-10-15T12:00:00Z'),
  });

  try {
    // 50 socios distintos intentando reservar en el mismo instante
    const totalCompetidores = 50;
    const promesas = [];

    for (let i = 1; i <= totalCompetidores; i++) {
      const socioId = `socio-competidor-${String(i).padStart(3, '0')}`;
      promesas.push(
        app.inject({
          method: 'POST',
          url: '/api/v1/reservas',
          headers: { 'content-type': 'application/json' },
          payload: {
            claseId: 'clase-concurrencia-01',
            socioId,
          },
        })
      );
    }

    const respuestas = await Promise.all(promesas);

    const exitosas = respuestas.filter((r) => r.statusCode === 201);
    const rechazadas = respuestas.filter((r) => r.statusCode === 409);

    // Exactamente 1 reserva confirmada
    assert.equal(
      exitosas.length,
      1,
      `Debe existir exactamente 1 reserva confirmada (201), pero se obtuvieron ${exitosas.length}`
    );

    // Exactamente 49 solicitudes rechazadas con conflicto de cupos
    assert.equal(
      rechazadas.length,
      totalCompetidores - 1,
      `Deben existir 49 solicitudes rechazadas con 409, pero se obtuvieron ${rechazadas.length}`
    );

    // Verificar que todas las rechazadas informaron CLASE_SIN_CUPOS
    for (const r of rechazadas) {
      assert.equal(r.json().codigo, 'CLASE_SIN_CUPOS');
    }

    // Verificar en la consulta de detalle que ahora quedan 0 cupos disponibles
    const detalleRes = await app.inject({
      method: 'GET',
      url: '/api/v1/clases/clase-concurrencia-01',
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(detalleRes.statusCode, 200);
    assert.equal(detalleRes.json().cuposDisponibles, 0);

    // Verificar auditoria: exactamente 10 reservas confirmadas (9 iniciales + 1 nueva)
    const auditoriaRes = await app.inject({
      method: 'GET',
      url: '/api/v1/clases/clase-concurrencia-01/reservas',
      headers: { 'x-api-key': apiKey },
    });
    const confirmadas = auditoriaRes.json().reservas.filter((r) => r.estado === 'CONFIRMADA');
    assert.equal(confirmadas.length, 10, 'No debe existir sobreventa de cupos bajo concurrencia');
  } finally {
    await app.close();
  }
});
