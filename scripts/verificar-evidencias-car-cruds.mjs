// Parte del ensayo con PostgreSQL temporal: no lee .env ni inicia servicios.
import assert from 'node:assert/strict';
import repositoryModule from '../services/socios-membresias/dist/repository.js';

const { PostgresSociosRepository } = repositoryModule;
const fecha = '2026-10-23T15:00:00.000Z';

export async function verificarEvidenciasCarCruds({ repositoryA, repositoryB, pool, administradorId }) {
  const employeeId = 'car-evidencias-pg-empleado';
  const employeeFallo = 'car-evidencias-pg-fallo';
  const socioIds = ['car-evidencias-socio-1', 'car-evidencias-socio-2', 'car-evidencias-socio-3'];
  for (const [index, socioId] of socioIds.entries()) {
    await repositoryA.crearSocio({
      socioId, dni: '8800900' + index, nombre: 'Persona Ficticia Evidencias ' + index,
      email: 'car-evidencias-pg-' + index + '@example.invalid', estado: 'ACTIVO', rol: 'SOCIO', createdAt: fecha,
    });
  }
  await repositoryA.crearMembresia({
    membresiaId: 'car-evidencias-membresia', socioId: socioIds[0], tipoPlan: 'MENSUAL',
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
  const antesPersonas = await snapshotPersonas();
  const codigo = (esperado) => (error) => error?.codigo === esperado;
  const cambiar = (id, socioId, versionEsperada) => repositoryA.cambiarVinculoCarCruds({
    employeeId: id, socioId, versionEsperada, administradorId, fecha,
  });
  await cambiar(employeeId, socioIds[0], 0);
  await cambiar(employeeFallo, socioIds[2], 0);
  const preparar = (repo, versionAnteriorEsperada, versionVinculoEsperada = 1, extra = {}) => repo.prepararFotografia({
    employeeId, period: '2026-10', versionAnteriorEsperada, versionVinculoEsperada,
    administradorId, fecha, confirmarCambioVinculo: false,
    generar: (fuente, sourceReference, version) => ({
      employeeId: fuente.vinculo.employeeId, period: extra.period ?? '2026-10', sourceReference, version,
      observedAt: fecha, member: null, used: null, costMinor: null, spendingMinor: null,
    }), ...extra,
  });
  const reclamar = (repo, fotografiaId, versionVinculoEsperada = 1, confirmarRevision = false) => repo.reclamarFotografia({
    fotografiaId, versionVinculoEsperada, administradorId, confirmarRevision,
  });
  const terminar = (repo, reclamo, estado = 'RECIBIDA', extra = {}) => repo.finalizarFotografia({
    fotografiaId: reclamo.fotografia.fotografiaId, leaseId: reclamo.leaseId,
    estado, codigoError: null, applied: estado === 'RECIBIDA' ? true : null, ...extra,
  });

  // Dos réplicas no pueden consumir la misma versión esperada.
  const preparaciones = await Promise.allSettled([preparar(repositoryA, 0), preparar(repositoryB, 0)]);
  assert.equal(preparaciones.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(preparaciones.find((r) => r.status === 'rejected').reason.codigo, 'CAR_CRUDS_FOTOGRAFIA_DESACTUALIZADA');
  const primera = preparaciones.find((r) => r.status === 'fulfilled').value;
  const cuerpoPrimero = JSON.stringify(primera.payload);
  assert.equal(primera.payload.version, 1);
  const durable = new PostgresSociosRepository(pool);
  assert.deepEqual(await durable.obtenerFotografias(employeeId, '2026-10'), [primera]);

  // Los reclamos también se serializan, con un lease independiente de cada proceso.
  const reclamos = await Promise.allSettled([
    reclamar(repositoryA, primera.fotografiaId), reclamar(repositoryB, primera.fotografiaId),
  ]);
  assert.equal(reclamos.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(reclamos.find((r) => r.status === 'rejected').reason.codigo, 'CAR_CRUDS_ENVIO_EN_CURSO');
  const intentoViejo = reclamos.find((r) => r.status === 'fulfilled').value;
  await assert.rejects(preparar(repositoryB, 1), codigo('CAR_CRUDS_ENVIO_EN_CURSO'));

  // Simular caída y paso del tiempo sin sleeps: no toca el payload inmutable.
  await pool.query("UPDATE car_cruds_evidencias SET lease_hasta = clock_timestamp() - interval '1 second' WHERE fotografia_id = $1", [primera.fotografiaId]);
  await assert.rejects(preparar(repositoryA, 1), codigo('CAR_CRUDS_ENVIO_PENDIENTE'));
  const intentoNuevo = await reclamar(repositoryB, primera.fotografiaId);
  assert.notEqual(intentoNuevo.leaseId, intentoViejo.leaseId);
  assert.equal(intentoNuevo.fotografia.intentos, 2);
  assert.equal(JSON.stringify(intentoNuevo.fotografia.payload), cuerpoPrimero);
  const respuestaTardia = await terminar(repositoryA, intentoViejo);
  assert.equal(respuestaTardia.estado, 'ENVIANDO');
  assert.equal(respuestaTardia.leaseId, intentoNuevo.leaseId, 'Un intento vencido no completa el de otra réplica');
  const recibida = await terminar(repositoryB, intentoNuevo);
  assert.equal(recibida.estado, 'RECIBIDA');
  assert.ok(recibida.recibidaEn);
  assert.equal(recibida.applied, true);
  assert.equal((await reclamar(durable, primera.fotografiaId)).leaseId, null, 'Una recepción persistida no se reenvía');
  assert.equal(JSON.stringify((await durable.obtenerFotografias(employeeId, '2026-10'))[0].payload), cuerpoPrimero);

  // La base también protege el cuerpo contra cambios accidentales por SQL.
  await assert.rejects(pool.query(
    `UPDATE car_cruds_evidencias SET payload = jsonb_set(payload::jsonb, '{member}', 'true'::jsonb)::text WHERE fotografia_id = $1`,
    [primera.fotografiaId],
  ), /inmutable/);
  assert.deepEqual((await durable.obtenerFotografias(employeeId, '2026-10'))[0], recibida);

  const segunda = await preparar(repositoryA, 1);
  assert.equal(segunda.payload.sourceReference, primera.payload.sourceReference);
  assert.equal(segunda.payload.version, 2);
  const reclamoConflicto = await reclamar(repositoryB, segunda.fotografiaId);
  await terminar(repositoryB, reclamoConflicto, 'REQUIERE_REVISION', { codigoError: 'CAR_CRUDS_EVIDENCIA_CONFLICTO' });
  await assert.rejects(preparar(repositoryA, 2), codigo('CAR_CRUDS_REVISION_REQUERIDA'));
  await assert.rejects(reclamar(repositoryA, segunda.fotografiaId), codigo('CAR_CRUDS_REVISION_REQUERIDA'));
  const confirmadoExplicitamente = await reclamar(repositoryB, segunda.fotografiaId, 1, true);
  assert.equal(JSON.stringify(confirmadoExplicitamente.fotografia.payload), JSON.stringify(segunda.payload));
  const segundaRecibida = await terminar(repositoryA, confirmadoExplicitamente, 'RECIBIDA', { applied: false });
  assert.equal(segundaRecibida.applied, false);

  // Corregir el vínculo exige nueva revisión y conserva las recepciones anteriores.
  await cambiar(employeeId, socioIds[1], 1);
  await assert.rejects(preparar(repositoryA, 2, 2), codigo('CAR_CRUDS_REVISION_REQUERIDA'));
  const tercera = await preparar(repositoryB, 2, 2, { confirmarCambioVinculo: true });
  assert.equal(tercera.socioId, socioIds[1]);
  assert.equal(tercera.payload.sourceReference, primera.payload.sourceReference);
  assert.deepEqual((await durable.obtenerFotografias(employeeId, '2026-10')).slice(0, 2), [recibida, segundaRecibida]);
  await cambiar(employeeId, null, 2);
  await assert.rejects(reclamar(repositoryA, tercera.fotografiaId, 3), codigo('VINCULO_DESACTUALIZADO'));
  await assert.rejects(preparar(repositoryA, 3, 3, { confirmarCambioVinculo: true }), codigo('VINCULO_DESACTUALIZADO'));
  await cambiar(employeeId, socioIds[0], 3);
  await assert.rejects(preparar(repositoryA, 3, 4), codigo('CAR_CRUDS_REVISION_REQUERIDA'));
  const cuarta = await preparar(repositoryB, 3, 4, { confirmarCambioVinculo: true });
  const cuartoReclamo = await reclamar(repositoryA, cuarta.fotografiaId, 4);
  await terminar(repositoryA, cuartoReclamo, 'PENDIENTE', { codigoError: 'CAR_CRUDS_EVIDENCIA_INCIERTA' });
  await assert.rejects(preparar(repositoryB, 4, 4), codigo('CAR_CRUDS_ENVIO_PENDIENTE'));
  await cambiar(employeeId, socioIds[1], 4);
  await assert.rejects(preparar(repositoryA, 4, 5), codigo('CAR_CRUDS_REVISION_REQUERIDA'));
  const quinta = await preparar(repositoryA, 4, 5, { confirmarCambioVinculo: true });
  const historial = await durable.obtenerFotografias(employeeId, '2026-10');
  assert.deepEqual(historial.map((f) => f.payload.version), [1, 2, 3, 4, 5]);
  assert.equal(historial[3].estado, 'REQUIERE_REVISION');
  assert.equal(historial[3].codigoError, 'VINCULO_CAMBIADO');
  assert.deepEqual(historial[3].payload, cuarta.payload);
  assert.equal(new Set(historial.map((f) => f.payload.sourceReference)).size, 1);
  assert.deepEqual(historial.slice(0, 2), [recibida, segundaRecibida]);
  await assert.rejects(reclamar(repositoryA, cuarta.fotografiaId, 5), codigo('CAR_CRUDS_FOTOGRAFIA_DESACTUALIZADA'));
  assert.deepEqual(historial.at(-1), quinta);

  // El generador y un fallo real del INSERT revierten cabecera + fotografía.
  await assert.rejects(preparar(repositoryA, 5, 5, { generar: () => { throw new Error('generador ficticio'); } }), /generador ficticio/);
  assert.deepEqual(await durable.obtenerFotografias(employeeId, '2026-10'), historial);
  assert.equal((await pool.query('SELECT ultima_version FROM car_cruds_evidencias_series WHERE employee_id = $1', [employeeId])).rows[0].ultima_version, '5');
  const falloBase = await preparar(repositoryA, 0, 1, { employeeId: employeeFallo });
  await pool.query(`CREATE FUNCTION car_evidencias_pg_fallo_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF NEW.employee_id = 'car-evidencias-pg-fallo' THEN RAISE EXCEPTION 'fallo ficticio de fotografía'; END IF; RETURN NEW; END $$`);
  try {
    await pool.query(`CREATE TRIGGER car_evidencias_pg_fallo_insert BEFORE INSERT ON car_cruds_evidencias
      FOR EACH ROW EXECUTE FUNCTION car_evidencias_pg_fallo_insert()`);
    await assert.rejects(preparar(repositoryB, 1, 1, { employeeId: employeeFallo }), /fallo ficticio/);
    await assert.rejects(preparar(repositoryA, 0, 1, { employeeId: employeeFallo, period: '2026-09' }), /fallo ficticio/);
    assert.deepEqual(await durable.obtenerFotografias(employeeFallo, '2026-10'), [falloBase]);
    const cabeceras = (await pool.query('SELECT period, ultima_version FROM car_cruds_evidencias_series WHERE employee_id = $1 ORDER BY period', [employeeFallo])).rows;
    assert.deepEqual(cabeceras, [{ period: '2026-10', ultima_version: '1' }]);
  } finally {
    await pool.query('DROP TRIGGER IF EXISTS car_evidencias_pg_fallo_insert ON car_cruds_evidencias');
    await pool.query('DROP FUNCTION car_evidencias_pg_fallo_insert()');
  }
  const recuperada = await preparar(repositoryB, 1, 1, { employeeId: employeeFallo });
  assert.equal(recuperada.payload.version, 2, 'Un rollback no consume versión');
  assert.equal(recuperada.payload.sourceReference, falloBase.payload.sourceReference);

  // Una observación positiva previa prueba vigencia en algún tramo del mes.
  // No se infiere false de su ausencia ni se transfiere la prueba a otro socio.
  const generarMiembro = (esperado, member) => (fuente, sourceReference, version) => {
    assert.equal(fuente.miembroObservadoEnPeriodo, esperado);
    return {
      employeeId: employeeFallo, period: '2026-08', sourceReference, version,
      observedAt: fecha, member, used: null, costMinor: null, spendingMinor: null,
    };
  };
  const positiva = await preparar(repositoryA, 0, 1, {
    employeeId: employeeFallo, period: '2026-08', generar: generarMiembro(false, true),
  });
  const retenida = await preparar(repositoryB, 1, 1, {
    employeeId: employeeFallo, period: '2026-08', generar: generarMiembro(true, true),
  });
  assert.equal(retenida.payload.member, true);
  assert.equal(retenida.payload.sourceReference, positiva.payload.sourceReference);
  await cambiar(employeeFallo, socioIds[0], 1);
  const otraPersona = await preparar(repositoryA, 2, 2, {
    employeeId: employeeFallo, period: '2026-08', confirmarCambioVinculo: true,
    generar: generarMiembro(false, null),
  });
  assert.equal(otraPersona.payload.member, null);
  assert.deepEqual(await snapshotPersonas(), antesPersonas, 'Las fotografías y correcciones no alteran cuentas, membresías ni la integración anterior');
  console.log('Car Cruds evidencias PostgreSQL: CAS y claims entre dos pools, durabilidad, cuerpo inmutable, lease/fencing, recepción, revisión de conflictos/vínculos y rollback real de serie + fotografía verificados.');
}
