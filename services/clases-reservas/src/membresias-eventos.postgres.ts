import { Pool, PoolClient } from 'pg';
import { EventoInvalido, EventoSuspension, MembresiasEventosRepository } from './application/membresias-eventos.service';

export const CLASES_EVENTOS_DDL = `
CREATE TABLE IF NOT EXISTS membresias_suspendidas (
 membresia_id VARCHAR(50) PRIMARY KEY, socio_id VARCHAR(50) NOT NULL,
 fecha_inicio TIMESTAMPTZ NOT NULL, fecha_fin TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suspendidas_socio ON membresias_suspendidas(socio_id);
CREATE TABLE IF NOT EXISTS membresias_inbox (
 event_id UUID PRIMARY KEY, evento JSONB NOT NULL, canceladas INTEGER NOT NULL,
 procesado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

// El mismo orden socio → clase serializa eventos y escrituras con evaluación HTTP antigua.
export async function bloquearSocioReservas(c: PoolClient, socioId: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['reservas-socio',socioId])]);
}

export async function suspensionImpideReserva(c: PoolClient, socioId: string, ahora: string, inicio: Date) {
  const result = await c.query(`SELECT 1 FROM membresias_suspendidas WHERE socio_id=$1
    AND (($2::timestamptz BETWEEN fecha_inicio AND fecha_fin) OR ($3::timestamptz BETWEEN fecha_inicio AND fecha_fin)) LIMIT 1`,
    [socioId,ahora,inicio]);
  return !!result.rowCount;
}

export class PostgresMembresiasEventos implements MembresiasEventosRepository {
  constructor(private pool: Pool) {}
  async aplicarSuspension(evento: EventoSuspension) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await bloquearSocioReservas(c,evento.socioId);
      const anterior = (await c.query('SELECT evento=$2::jsonb AS igual,canceladas FROM membresias_inbox WHERE event_id=$1',
        [evento.eventId,JSON.stringify(evento)])).rows[0];
      if (anterior) {
        if (!anterior.igual) throw new EventoInvalido('EVENT_ID_REUTILIZADO');
        await c.query('COMMIT');
        return { repetido: true, canceladas: 0 };
      }
      const previa = (await c.query('SELECT * FROM membresias_suspendidas WHERE membresia_id=$1',[evento.membresiaId])).rows[0];
      if (previa && (previa.socio_id !== evento.socioId
        || previa.fecha_inicio.toISOString() !== new Date(evento.fechaInicio).toISOString()
        || previa.fecha_fin.toISOString() !== new Date(evento.fechaFin).toISOString())) throw new EventoInvalido('MEMBRESIA_EN_CONFLICTO');
      await c.query(`INSERT INTO membresias_suspendidas(membresia_id,socio_id,fecha_inicio,fecha_fin)
        VALUES($1,$2,$3,$4) ON CONFLICT(membresia_id) DO NOTHING`,
        [evento.membresiaId,evento.socioId,evento.fechaInicio,evento.fechaFin]);
      const clases = await c.query(`SELECT clase_id FROM clases WHERE inicio>clock_timestamp()
        AND clase_id IN (SELECT clase_id FROM reservas WHERE socio_id=$1 AND estado='CONFIRMADA') ORDER BY clase_id FOR UPDATE`,[evento.socioId]);
      let canceladas = 0;
      for (const clase of clases.rows) {
        // Se vuelve a evaluar el reloj después de obtener cada bloqueo.
        const result = await c.query(`UPDATE reservas r SET estado='CANCELADA',updated_at=clock_timestamp()
          FROM clases c WHERE r.clase_id=c.clase_id AND c.clase_id=$1 AND r.socio_id=$2
          AND r.estado='CONFIRMADA' AND c.inicio>clock_timestamp()
          AND EXISTS(SELECT 1 FROM membresias_suspendidas s WHERE s.socio_id=$2
            AND (clock_timestamp() BETWEEN s.fecha_inicio AND s.fecha_fin OR c.inicio BETWEEN s.fecha_inicio AND s.fecha_fin))`,
          [clase.clase_id,evento.socioId]);
        canceladas += result.rowCount ?? 0;
      }
      await c.query('INSERT INTO membresias_inbox(event_id,evento,canceladas) VALUES($1,$2,$3)',
        [evento.eventId,JSON.stringify(evento),canceladas]);
      await c.query('COMMIT');
      return { repetido: false, canceladas };
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally { c.release(); }
  }
}
