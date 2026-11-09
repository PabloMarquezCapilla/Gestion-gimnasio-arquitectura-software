import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { ClaseAdministrada, ComandoClase, exigirInicioFuturo, GestionClasesError, GestionClasesRepository } from './application/gestion-clases.service';

export const GESTION_CLASES_DDL = `
  ALTER TABLE clases ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
  CREATE TABLE IF NOT EXISTS clases_operaciones (
    actor_id TEXT NOT NULL,
    clave VARCHAR(128) NOT NULL,
    entrada JSONB NOT NULL,
    respuesta JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(actor_id, clave)
  );
`;
function entrada(comando: ComandoClase) {
  return { claseId: comando.claseId, datos: comando.datos, versionEsperada: comando.versionEsperada };
}
function clase(row: Record<string, any>): ClaseAdministrada {
  return { claseId: row.clase_id, nombre: row.nombre, actividad: row.actividad, profesor: row.profesor,
    sedeId: row.sede_id, inicio: row.inicio.toISOString(), fin: row.fin.toISOString(),
    capacidad: row.capacidad, publicada: row.publicada, version: row.version };
}
function almacenamientoError(error: unknown): never {
  if (error instanceof GestionClasesError) throw error;
  throw new GestionClasesError(503, 'ALMACENAMIENTO_NO_DISPONIBLE', 'No se pudo confirmar la operación. Conservá sus datos para reintentar.');
}
export class PostgresGestionClases implements GestionClasesRepository {
  constructor(private pool: Pool) {}

  async obtener(claseId: string) {
    try {
      const result = await this.pool.query('SELECT * FROM clases WHERE clase_id=$1 AND publicada=TRUE', [claseId]);
      return result.rows[0] ? clase(result.rows[0]) : null;
    } catch (error) { return almacenamientoError(error); }
  }
  private async operacion(db: Pool | PoolClient, comando: ComandoClase): Promise<ClaseAdministrada | null> {
    const result = await db.query(`SELECT respuesta, entrada=$3::jsonb AS coincide
      FROM clases_operaciones WHERE actor_id=$1 AND clave=$2`, [comando.actorId, comando.clave, JSON.stringify(entrada(comando))]);
    if (!result.rows[0]) return null;
    if (!result.rows[0].coincide) throw new GestionClasesError(409, 'IDEMPOTENCIA_CONFLICTO', 'La clave ya identifica otra operación. Recuperá sus datos originales.');
    return result.rows[0].respuesta as ClaseAdministrada;
  }
  async recuperar(comando: ComandoClase) {
    try { return await this.operacion(this.pool, comando); }
    catch (error) { return almacenamientoError(error); }
  }
  async guardar(comando: ComandoClase, ahora: () => string) {
    let client: PoolClient | undefined;
    try {
      client = await this.pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify([comando.actorId, comando.clave])]);
      const anterior = await this.operacion(client, comando);
      if (anterior) { await client.query('COMMIT'); return anterior; }
      let version = 1;
      let inicioOriginal: string | undefined;
      if (comando.claseId !== null) {
        // Mismo bloqueo de fila que reserva, espera y promoción. La comprobación
        // de inscriptos se hace después de obtenerlo.
        const found = await client.query('SELECT * FROM clases WHERE clase_id=$1 FOR UPDATE', [comando.claseId]);
        const actual = found.rows[0];
        if (!actual?.publicada) throw new GestionClasesError(404, 'CLASE_NO_ENCONTRADA', 'No se encontró la clase solicitada.');
        if (actual.version !== comando.versionEsperada) throw new GestionClasesError(409, 'VERSION_CONFLICTO', 'Otra persona modificó la clase. Volvé a cargarla antes de editar.');
        inicioOriginal = actual.inicio.toISOString();
        const ocupada = await client.query(`SELECT
          EXISTS(SELECT 1 FROM reservas WHERE clase_id=$1 AND estado='CONFIRMADA') OR
          EXISTS(SELECT 1 FROM lista_espera WHERE clase_id=$1 AND estado='PENDIENTE') AS ocupada`, [comando.claseId]);
        if (ocupada.rows[0].ocupada) throw new GestionClasesError(409, 'CLASE_CON_INSCRIPTOS', 'La clase tiene reservas confirmadas o personas en espera y no admite edición.');
        if (actual.version === 2147483647) throw new GestionClasesError(409, 'VERSION_AGOTADA', 'La versión de la clase requiere revisión técnica.');
        version = actual.version + 1;
      }
      const instante = ahora();
      if (inicioOriginal) exigirInicioFuturo(inicioOriginal, instante);
      exigirInicioFuturo(comando.datos.inicio, instante);
      const id = comando.claseId ?? 'cla-' + randomUUID();
      const d = comando.datos;
      const values = [id, d.nombre, d.actividad, d.profesor, d.sedeId, d.inicio, d.fin, d.capacidad, version];
      const result = comando.claseId === null
        ? await client.query(`INSERT INTO clases(clase_id,nombre,actividad,profesor,sede_id,inicio,fin,capacidad,version,publicada,created_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING *`, [...values, instante])
        : await client.query(`UPDATE clases SET nombre=$2,actividad=$3,profesor=$4,sede_id=$5,inicio=$6,fin=$7,capacidad=$8,version=$9
            WHERE clase_id=$1 RETURNING *`, values);
      const respuesta = clase(result.rows[0]);
      await client.query(`INSERT INTO clases_operaciones(actor_id,clave,entrada,respuesta,created_at) VALUES($1,$2,$3,$4,$5)`,
        [comando.actorId, comando.clave, JSON.stringify(entrada(comando)), JSON.stringify(respuesta), instante]);
      await client.query('COMMIT');
      return respuesta;
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      return almacenamientoError(error);
    } finally { client?.release(); }
  }
}
