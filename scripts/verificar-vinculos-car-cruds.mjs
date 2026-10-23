// Complemento del ensayo PostgreSQL temporal. No inicia Docker ni lee .env.
import assert from 'node:assert/strict';
import repositoryModule from '../services/socios-membresias/dist/repository.js';

const { PostgresSociosRepository } = repositoryModule;
const fecha = '2026-10-23T15:00:00.000Z';

export async function verificarVinculosCarCruds({ repositoryA, repositoryB, pool, administradorId }) {
  const ids = Array.from({ length: 6 }, (_, i) => 'car-pg-socio-' + (i + 1));
  for (const [index, socioId] of ids.entries()) {
    await repositoryA.crearSocio({
      socioId, dni: '9700010' + index, nombre: 'Persona Ficticia Car Cruds ' + index,
      email: 'car-pg-' + index + '@example.invalid', estado: 'ACTIVO', rol: 'SOCIO', createdAt: fecha,
    });
  }
  await repositoryA.crearMembresia({
    membresiaId: 'car-pg-membresia-no-modificar', socioId: ids[0], tipoPlan: 'MENSUAL',
    fechaInicio: '2026-10-01T00:00:00.000Z', fechaFin: '2026-10-31T23:59:59.000Z',
    estado: 'SUSPENDIDA', createdAt: fecha, updatedAt: fecha,
  });
  const snapshotPersonas = async () => ({
    socios: (await pool.query('SELECT * FROM socios ORDER BY socio_id')).rows,
    membresias: (await pool.query('SELECT * FROM membresias ORDER BY membresia_id')).rows,
    solicitudes: (await pool.query('SELECT * FROM solicitudes_membresia ORDER BY solicitud_id')).rows,
    empleadosAnteriores: (await pool.query('SELECT * FROM empleados_externos ORDER BY origen,empleado_externo_id')).rows,
    reintentosAnteriores: (await pool.query('SELECT * FROM altas_empleados_idempotencia ORDER BY origen,clave')).rows,
  });
  const personasAntes = await snapshotPersonas();
  const cambio = (employeeId, socioId, versionEsperada = 0) => ({ employeeId, socioId, versionEsperada, administradorId, fecha });
  const errorCodigo = (codigo) => (error) => error?.codigo === codigo;

  // Dos pools independientes compiten por el mismo socio: solo un vínculo puede existir.
  const carreraSocio = await Promise.allSettled([
    repositoryA.cambiarVinculoCarCruds(cambio('car-pg-carrera-a', ids[0])),
    repositoryB.cambiarVinculoCarCruds(cambio('car-pg-carrera-b', ids[0])),
  ]);
  assert.equal(carreraSocio.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(carreraSocio.find(({ status }) => status === 'rejected').reason.codigo, 'SOCIO_YA_VINCULADO');
  assert.equal((await pool.query('SELECT count(*)::int n FROM car_cruds_vinculos WHERE socio_id=$1', [ids[0]])).rows[0].n, 1);
  const ganador = carreraSocio.find(({ status }) => status === 'fulfilled').value;
  const perdedorId = ganador.employeeId === 'car-pg-carrera-a' ? 'car-pg-carrera-b' : 'car-pg-carrera-a';
  assert.equal((await repositoryB.obtenerVinculoCarCruds(perdedorId)).version, 0);
  assert.deepEqual(await repositoryB.getHistorialVinculoCarCruds(perdedorId), []);

  // El bloqueo por empleado y la revisión impiden que dos administradores se sobrescriban.
  const carreraEmpleado = await Promise.allSettled([
    repositoryA.cambiarVinculoCarCruds(cambio('car-pg-mismo-empleado', ids[1])),
    repositoryB.cambiarVinculoCarCruds(cambio('car-pg-mismo-empleado', ids[2])),
  ]);
  assert.equal(carreraEmpleado.filter(({ status }) => status === 'fulfilled').length, 1);
  assert.equal(carreraEmpleado.find(({ status }) => status === 'rejected').reason.codigo, 'VINCULO_DESACTUALIZADO');
  assert.equal((await repositoryB.getHistorialVinculoCarCruds('car-pg-mismo-empleado')).length, 1);

  const antesReintento = await repositoryA.obtenerVinculoCarCruds('car-pg-mismo-empleado');
  const reintentos = await Promise.all(Array.from({ length: 12 }, (_, index) =>
    (index % 2 ? repositoryA : repositoryB).cambiarVinculoCarCruds(cambio('car-pg-mismo-empleado', antesReintento.socioId))));
  for (const response of reintentos) assert.deepEqual(response, antesReintento);
  assert.equal((await repositoryA.getHistorialVinculoCarCruds('car-pg-mismo-empleado')).length, 1);

  // Una corrección libera al socio anterior, mantiene versiones al desvincular y es durable.
  await repositoryB.cambiarVinculoCarCruds(cambio(ganador.employeeId, ids[3], 1));
  await assert.rejects(repositoryA.cambiarVinculoCarCruds(cambio(ganador.employeeId, null, 1)), errorCodigo('VINCULO_DESACTUALIZADO'));
  await repositoryA.cambiarVinculoCarCruds(cambio(perdedorId, ids[0]));
  const quitado = await repositoryA.cambiarVinculoCarCruds(cambio(ganador.employeeId, null, 2));
  assert.equal(quitado.version, 3);
  assert.deepEqual(await repositoryB.cambiarVinculoCarCruds(cambio(ganador.employeeId, null, 0)), quitado);
  const durable = new PostgresSociosRepository(pool);
  assert.deepEqual(await durable.obtenerVinculoCarCruds(ganador.employeeId), quitado);
  const historial = await durable.getHistorialVinculoCarCruds(ganador.employeeId);
  assert.deepEqual(historial.map(({ version, socioAnteriorId, socioNuevoId, administradorId: actor, createdAt }) =>
    ({ version, socioAnteriorId, socioNuevoId, actor, createdAt })), [
    { version: 1, socioAnteriorId: null, socioNuevoId: ids[0], actor: administradorId, createdAt: fecha },
    { version: 2, socioAnteriorId: ids[0], socioNuevoId: ids[3], actor: administradorId, createdAt: fecha },
    { version: 3, socioAnteriorId: ids[3], socioNuevoId: null, actor: administradorId, createdAt: fecha },
  ]);
  assert.equal(new Set(historial.map(({ historialId }) => historialId)).size, 3);
  const relink = await repositoryB.cambiarVinculoCarCruds(cambio(ganador.employeeId, ids[3], 3));
  assert.equal(relink.version, 4);
  const listado = await durable.listarVinculosCarCruds(1, 100);
  assert.equal(listado.total, 3);
  assert.equal(listado.items.length, 3);
  const paginaLejana = await durable.listarVinculosCarCruds(Number.MAX_SAFE_INTEGER, 100);
  assert.equal(paginaLejana.total, 3);
  assert.deepEqual(paginaLejana.items, []);
  assert.equal((await durable.buscarSociosParaVincular('  CAR-PG-0@EXAMPLE.INVALID  '))[0].socioId, ids[0]);
  assert.deepEqual(await durable.buscarSociosParaVincular('Persona Ficticia'), []);
  await assert.rejects(repositoryB.cambiarVinculoCarCruds(cambio('car-pg-sin-socio', 'car-pg-inexistente')), errorCodigo('SOCIO_NO_ENCONTRADO'));
  assert.equal((await durable.obtenerVinculoCarCruds('car-pg-sin-socio')).version, 0);

  // Fallar la auditoría al final debe revertir vínculo y revisión, tanto alta como corrección.
  const existenteId = 'car-pg-fallo-existente';
  await repositoryA.cambiarVinculoCarCruds(cambio(existenteId, ids[4]));
  const antesFallo = await repositoryA.obtenerVinculoCarCruds(existenteId);
  const historialAntesFallo = await repositoryA.getHistorialVinculoCarCruds(existenteId);
  await pool.query(`CREATE FUNCTION car_pg_fallo_auditoria() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.employee_id LIKE 'car-pg-fallo-%' THEN RAISE EXCEPTION 'fallo ficticio de auditoría'; END IF; RETURN NEW; END $$`);
  try {
    await pool.query(`CREATE TRIGGER car_pg_fallo_auditoria BEFORE INSERT ON car_cruds_vinculos_historial
      FOR EACH ROW EXECUTE FUNCTION car_pg_fallo_auditoria()`);
    await assert.rejects(repositoryB.cambiarVinculoCarCruds(cambio('car-pg-fallo-nuevo', ids[5])));
    assert.deepEqual(await durable.obtenerVinculoCarCruds('car-pg-fallo-nuevo'), {
      employeeId: 'car-pg-fallo-nuevo', socioId: null, version: 0, actualizadoEn: null,
    });
    assert.equal((await pool.query('SELECT 1 FROM car_cruds_vinculos WHERE employee_id=$1', ['car-pg-fallo-nuevo'])).rowCount, 0);
    assert.deepEqual(await durable.getHistorialVinculoCarCruds('car-pg-fallo-nuevo'), []);
    await assert.rejects(repositoryA.cambiarVinculoCarCruds(cambio(existenteId, ids[5], 1)));
    await assert.rejects(repositoryB.cambiarVinculoCarCruds(cambio(existenteId, null, 1)));
    assert.deepEqual(await durable.obtenerVinculoCarCruds(existenteId), antesFallo);
    assert.deepEqual(await durable.getHistorialVinculoCarCruds(existenteId), historialAntesFallo);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS car_pg_fallo_auditoria ON car_cruds_vinculos_historial');
    await pool.query('DROP FUNCTION car_pg_fallo_auditoria()');
  }
  const recuperado = await repositoryB.cambiarVinculoCarCruds(cambio(existenteId, ids[5], 1));
  assert.equal(recuperado.version, 2, 'El fallo no debe consumir revisión');
  assert.deepEqual(await snapshotPersonas(), personasAntes, 'Vincular, corregir y quitar no cambia socios, membresías ni el flujo anterior');
  console.log('Car Cruds PostgreSQL: unicidad entre dos pools, revisión concurrente, reintentos sin doble auditoría, corrección/desvinculación durables y rollback real de vínculo + historial verificados.');
}
