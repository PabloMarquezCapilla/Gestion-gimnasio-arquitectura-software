import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';

export const MEMBRESIAS_EVENTOS_DDL = `
CREATE TABLE IF NOT EXISTS membresias_outbox (
 event_id UUID PRIMARY KEY, membresia_id VARCHAR(50) NOT NULL UNIQUE REFERENCES membresias(membresia_id),
 evento JSONB NOT NULL, publicado_en TIMESTAMPTZ, reclamo UUID, reclamar_hasta TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_membresias_outbox_pendientes ON membresias_outbox(created_at) WHERE publicado_en IS NULL;
`;

// Sólo se publica la transición de suspensión confirmada. No incluye datos personales.
export async function guardarSuspension(c: PoolClient, membresia: {
  membresia_id: string; socio_id: string; fecha_inicio: Date; fecha_fin: Date;
}, actorId: string, traceparent?: string) {
  const eventId = randomUUID();
  const evento = {
    eventId, tipo: 'MembresiaActualizada', schemaVersion: 1, cambio: 'SUSPENSION',
    ocurridoEn: new Date().toISOString(), socioId: membresia.socio_id,
    membresiaId: membresia.membresia_id, estado: 'SUSPENDIDA',
    fechaInicio: membresia.fecha_inicio.toISOString(), fechaFin: membresia.fecha_fin.toISOString(),
    actorId, ...(traceparent ? { traceparent } : {}),
  };
  await c.query('INSERT INTO membresias_outbox(event_id,membresia_id,evento) VALUES($1,$2,$3)',
    [eventId, membresia.membresia_id, JSON.stringify(evento)]);
  return evento;
}

export class PostgresMembresiasOutbox {
  constructor(private pool: Pool) {}

  async reclamar() {
    const reclamo = randomUUID();
    const result = await this.pool.query(`
      UPDATE membresias_outbox SET reclamo=$1,reclamar_hasta=clock_timestamp()+interval '30 seconds'
      WHERE event_id=(SELECT event_id FROM membresias_outbox
        WHERE publicado_en IS NULL AND (reclamar_hasta IS NULL OR reclamar_hasta<clock_timestamp())
        ORDER BY created_at,event_id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING event_id,evento`, [reclamo]);
    const row = result.rows[0];
    return row ? { eventId: row.event_id as string, evento: row.evento, reclamo } : null;
  }

  async confirmar(eventId: string, reclamo: string) {
    await this.pool.query('UPDATE membresias_outbox SET publicado_en=clock_timestamp(),reclamo=NULL,reclamar_hasta=NULL WHERE event_id=$1 AND reclamo=$2', [eventId, reclamo]);
  }
}
