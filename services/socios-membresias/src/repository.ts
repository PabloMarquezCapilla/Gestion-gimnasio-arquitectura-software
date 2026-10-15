import { Pool } from 'pg';
import { Socio, Membresia, ResultadoHabilitacion } from './types';

export interface ISociosRepository {
  obtenerSocio(socioId: string): Promise<Socio | null>;
  obtenerMembresia(socioId: string): Promise<Membresia | null>;
  crearSocio(socio: Socio): Promise<Socio>;
  crearMembresia(membresia: Membresia): Promise<Membresia>;
  actualizarEstadoMembresia(membresiaId: string, nuevoEstado: Membresia['estado']): Promise<void>;
  evaluarHabilitacion(socioId: string, fechaReferencia: Date): Promise<ResultadoHabilitacion>;
  inicializarEsquema(): Promise<void>;
  verificarSalud(): Promise<{ ok: boolean; detalle?: string }>;
}

export const SEED_SOCIOS: Socio[] = [
  {
    socioId: 'socio-demo-01',
    dni: '11111111',
    nombre: 'Juan Pérez',
    email: 'juan.perez@example.com',
    estado: 'ACTIVO',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-demo-02',
    dni: '22222222',
    nombre: 'María Gómez',
    email: 'maria.gomez@example.com',
    estado: 'ACTIVO',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-demo-03',
    dni: '33333333',
    nombre: 'Lucas Silva',
    email: 'lucas.silva@example.com',
    estado: 'ACTIVO',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-vencido-01',
    dni: '44444444',
    nombre: 'Pedro Vencido',
    email: 'pedro.vencido@example.com',
    estado: 'ACTIVO',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-suspendido-01',
    dni: '55555555',
    nombre: 'Ana Suspendida',
    email: 'ana.suspendida@example.com',
    estado: 'ACTIVO',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

export const SEED_MEMBRESIAS: Membresia[] = [
  {
    membresiaId: 'mem-001',
    socioId: 'socio-demo-01',
    tipoPlan: 'FULL_ANUAL',
    fechaInicio: '2026-01-01T00:00:00.000Z',
    fechaFin: '2027-12-31T23:59:59.000Z',
    estado: 'HABILITADA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    membresiaId: 'mem-002',
    socioId: 'socio-demo-02',
    tipoPlan: 'STANDARD_SEMESTRAL',
    fechaInicio: '2026-01-01T00:00:00.000Z',
    fechaFin: '2027-12-31T23:59:59.000Z',
    estado: 'HABILITADA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    membresiaId: 'mem-003',
    socioId: 'socio-demo-03',
    tipoPlan: 'FULL_ANUAL',
    fechaInicio: '2026-01-01T00:00:00.000Z',
    fechaFin: '2027-12-31T23:59:59.000Z',
    estado: 'HABILITADA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    membresiaId: 'mem-004',
    socioId: 'socio-vencido-01',
    tipoPlan: 'MENSUAL',
    fechaInicio: '2025-01-01T00:00:00.000Z',
    fechaFin: '2025-06-01T23:59:59.000Z',
    estado: 'VENCIDA',
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-06-02T00:00:00.000Z',
  },
  {
    membresiaId: 'mem-005',
    socioId: 'socio-suspendido-01',
    tipoPlan: 'FULL_ANUAL',
    fechaInicio: '2026-01-01T00:00:00.000Z',
    fechaFin: '2027-12-31T23:59:59.000Z',
    estado: 'SUSPENDIDA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  },
];

export class MemorySociosRepository implements ISociosRepository {
  private socios: Map<string, Socio> = new Map();
  private membresias: Map<string, Membresia> = new Map();

  constructor() {
    for (const s of SEED_SOCIOS) {
      this.socios.set(s.socioId, { ...s });
    }
    for (const m of SEED_MEMBRESIAS) {
      this.membresias.set(m.socioId, { ...m });
    }
  }

  async inicializarEsquema(): Promise<void> {
    // No-op for in-memory
  }

  async verificarSalud(): Promise<{ ok: boolean; detalle?: string }> {
    return { ok: true };
  }

  async obtenerSocio(socioId: string): Promise<Socio | null> {
    return this.socios.get(socioId) ?? null;
  }

  async obtenerMembresia(socioId: string): Promise<Membresia | null> {
    return this.membresias.get(socioId) ?? null;
  }

  async crearSocio(socio: Socio): Promise<Socio> {
    this.socios.set(socio.socioId, { ...socio });
    return socio;
  }

  async crearMembresia(membresia: Membresia): Promise<Membresia> {
    this.membresias.set(membresia.socioId, { ...membresia });
    return membresia;
  }

  async actualizarEstadoMembresia(membresiaId: string, nuevoEstado: Membresia['estado']): Promise<void> {
    for (const m of this.membresias.values()) {
      if (m.membresiaId === membresiaId) {
        m.estado = nuevoEstado;
        m.updatedAt = new Date().toISOString();
        break;
      }
    }
  }

  async evaluarHabilitacion(socioId: string, fechaReferencia: Date): Promise<ResultadoHabilitacion> {
    const socio = await this.obtenerSocio(socioId);
    if (!socio) {
      return { socioId, habilitado: false, motivo: 'SOCIO_NO_EXISTE' };
    }
    if (socio.estado !== 'ACTIVO') {
      return { socioId, habilitado: false, motivo: 'SOCIO_INACTIVO' };
    }

    const membresia = await this.obtenerMembresia(socioId);
    if (!membresia) {
      return { socioId, habilitado: false, motivo: 'SIN_MEMBRESIA' };
    }

    if (membresia.estado === 'SUSPENDIDA') {
      return {
        socioId,
        habilitado: false,
        motivo: 'MEMBRESIA_SUSPENDIDA',
        membresia: {
          membresiaId: membresia.membresiaId,
          tipoPlan: membresia.tipoPlan,
          estado: membresia.estado,
          fechaInicio: membresia.fechaInicio,
          fechaFin: membresia.fechaFin,
        },
      };
    }

    const fechaRefTime = fechaReferencia.getTime();
    const inicioTime = new Date(membresia.fechaInicio).getTime();
    const finTime = new Date(membresia.fechaFin).getTime();

    if (fechaRefTime < inicioTime || fechaRefTime > finTime || membresia.estado === 'VENCIDA') {
      return {
        socioId,
        habilitado: false,
        motivo: 'MEMBRESIA_VENCIDA',
        membresia: {
          membresiaId: membresia.membresiaId,
          tipoPlan: membresia.tipoPlan,
          estado: 'VENCIDA',
          fechaInicio: membresia.fechaInicio,
          fechaFin: membresia.fechaFin,
        },
      };
    }

    return {
      socioId,
      habilitado: true,
      membresia: {
        membresiaId: membresia.membresiaId,
        tipoPlan: membresia.tipoPlan,
        estado: membresia.estado,
        fechaInicio: membresia.fechaInicio,
        fechaFin: membresia.fechaFin,
      },
    };
  }
}

export class PostgresSociosRepository implements ISociosRepository {
  constructor(private pool: Pool) {}

  async verificarSalud(): Promise<{ ok: boolean; detalle?: string }> {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true };
    } catch (err) {
      return { ok: false, detalle: err instanceof Error ? err.message : String(err) };
    }
  }

  async inicializarEsquema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TABLE IF NOT EXISTS socios (
          socio_id VARCHAR(50) PRIMARY KEY,
          dni VARCHAR(20) NOT NULL UNIQUE,
          nombre VARCHAR(100) NOT NULL,
          email VARCHAR(100) NOT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS membresias (
          membresia_id VARCHAR(50) PRIMARY KEY,
          socio_id VARCHAR(50) NOT NULL REFERENCES socios(socio_id),
          tipo_plan VARCHAR(50) NOT NULL,
          fecha_inicio TIMESTAMPTZ NOT NULL,
          fecha_fin TIMESTAMPTZ NOT NULL,
          estado VARCHAR(20) NOT NULL CHECK (estado IN ('HABILITADA', 'SUSPENDIDA', 'VENCIDA')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_membresias_socio ON membresias(socio_id);
      `);

      // Seed if empty
      const countRes = await client.query('SELECT count(*)::int AS count FROM socios');
      if (countRes.rows[0].count === 0) {
        for (const s of SEED_SOCIOS) {
          await client.query(
            `INSERT INTO socios (socio_id, dni, nombre, email, estado, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (socio_id) DO NOTHING`,
            [s.socioId, s.dni, s.nombre, s.email, s.estado, s.createdAt]
          );
        }
        for (const m of SEED_MEMBRESIAS) {
          await client.query(
            `INSERT INTO membresias (membresia_id, socio_id, tipo_plan, fecha_inicio, fecha_fin, estado, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (membresia_id) DO NOTHING`,
            [m.membresiaId, m.socioId, m.tipoPlan, m.fechaInicio, m.fechaFin, m.estado, m.createdAt, m.updatedAt]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async obtenerSocio(socioId: string): Promise<Socio | null> {
    const res = await this.pool.query(
      'SELECT socio_id, dni, nombre, email, estado, created_at FROM socios WHERE socio_id = $1',
      [socioId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      socioId: row.socio_id,
      dni: row.dni,
      nombre: row.nombre,
      email: row.email,
      estado: row.estado,
      createdAt: row.created_at.toISOString(),
    };
  }

  async obtenerMembresia(socioId: string): Promise<Membresia | null> {
    const res = await this.pool.query(
      `SELECT membresia_id, socio_id, tipo_plan, fecha_inicio, fecha_fin, estado, created_at, updated_at
       FROM membresias WHERE socio_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [socioId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      membresiaId: row.membresia_id,
      socioId: row.socio_id,
      tipoPlan: row.tipo_plan,
      fechaInicio: row.fecha_inicio.toISOString(),
      fechaFin: row.fecha_fin.toISOString(),
      estado: row.estado,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async crearSocio(socio: Socio): Promise<Socio> {
    await this.pool.query(
      `INSERT INTO socios (socio_id, dni, nombre, email, estado, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [socio.socioId, socio.dni, socio.nombre, socio.email, socio.estado, socio.createdAt]
    );
    return socio;
  }

  async crearMembresia(membresia: Membresia): Promise<Membresia> {
    await this.pool.query(
      `INSERT INTO membresias (membresia_id, socio_id, tipo_plan, fecha_inicio, fecha_fin, estado, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        membresia.membresiaId,
        membresia.socioId,
        membresia.tipoPlan,
        membresia.fechaInicio,
        membresia.fechaFin,
        membresia.estado,
        membresia.createdAt,
        membresia.updatedAt,
      ]
    );
    return membresia;
  }

  async actualizarEstadoMembresia(membresiaId: string, nuevoEstado: Membresia['estado']): Promise<void> {
    await this.pool.query(
      'UPDATE membresias SET estado = $1, updated_at = NOW() WHERE membresia_id = $2',
      [nuevoEstado, membresiaId]
    );
  }

  async evaluarHabilitacion(socioId: string, fechaReferencia: Date): Promise<ResultadoHabilitacion> {
    const socio = await this.obtenerSocio(socioId);
    if (!socio) {
      return { socioId, habilitado: false, motivo: 'SOCIO_NO_EXISTE' };
    }
    if (socio.estado !== 'ACTIVO') {
      return { socioId, habilitado: false, motivo: 'SOCIO_INACTIVO' };
    }

    const membresia = await this.obtenerMembresia(socioId);
    if (!membresia) {
      return { socioId, habilitado: false, motivo: 'SIN_MEMBRESIA' };
    }

    if (membresia.estado === 'SUSPENDIDA') {
      return {
        socioId,
        habilitado: false,
        motivo: 'MEMBRESIA_SUSPENDIDA',
        membresia: {
          membresiaId: membresia.membresiaId,
          tipoPlan: membresia.tipoPlan,
          estado: membresia.estado,
          fechaInicio: membresia.fechaInicio,
          fechaFin: membresia.fechaFin,
        },
      };
    }

    const fechaRefTime = fechaReferencia.getTime();
    const inicioTime = new Date(membresia.fechaInicio).getTime();
    const finTime = new Date(membresia.fechaFin).getTime();

    if (fechaRefTime < inicioTime || fechaRefTime > finTime || membresia.estado === 'VENCIDA') {
      return {
        socioId,
        habilitado: false,
        motivo: 'MEMBRESIA_VENCIDA',
        membresia: {
          membresiaId: membresia.membresiaId,
          tipoPlan: membresia.tipoPlan,
          estado: 'VENCIDA',
          fechaInicio: membresia.fechaInicio,
          fechaFin: membresia.fechaFin,
        },
      };
    }

    return {
      socioId,
      habilitado: true,
      membresia: {
        membresiaId: membresia.membresiaId,
        tipoPlan: membresia.tipoPlan,
        estado: membresia.estado,
        fechaInicio: membresia.fechaInicio,
        fechaFin: membresia.fechaFin,
      },
    };
  }
}
