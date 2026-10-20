import { Pool } from 'pg';
import { Socio, Membresia } from './types';
import { IdentidadDuplicadaError, SociosError } from './errors';
import type { AltaEmpleado, EmpleadosRepository, RegistroEmpleado } from './empleados.service';
import { hashPassword } from './security';

export interface ISociosRepository extends EmpleadosRepository {
  obtenerSocio(socioId: string): Promise<Socio | null>;
  buscarPorEmailODni(identificador: string): Promise<Socio | null>;
  obtenerMembresias(socioId: string): Promise<Membresia[]>;
  crearSocio(socio: Socio): Promise<Socio>;
  crearMembresia(membresia: Membresia): Promise<Membresia>;
  actualizarEstadoMembresia(membresiaId: string, nuevoEstado: Membresia['estado']): Promise<void>;
  inicializarEsquema(): Promise<void>;
  verificarSalud(): Promise<{ ok: boolean; detalle?: string }>;
  conexionesActivas(): number;
}

export const SEED_SOCIOS: Socio[] = [
  {
    socioId: 'socio-demo-01',
    dni: '11111111',
    nombre: 'Juan Pérez',
    email: 'juan.perez@example.com',
    passwordHash: hashPassword('socio123'),
    rol: 'SOCIO',
    telefono: '+54 9 11 3914-2201',
    estado: 'ACTIVO',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-demo-02',
    dni: '22222222',
    nombre: 'María Gómez',
    email: 'maria.gomez@example.com',
    passwordHash: hashPassword('socio123'),
    rol: 'SOCIO',
    telefono: '+54 9 11 4829-1102',
    estado: 'ACTIVO',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-demo-03',
    dni: '33333333',
    nombre: 'Lucas Silva',
    email: 'lucas.silva@example.com',
    passwordHash: hashPassword('socio123'),
    rol: 'SOCIO',
    telefono: '+54 9 11 5509-8833',
    estado: 'ACTIVO',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-vencido-01',
    dni: '44444444',
    nombre: 'Pedro Vencido',
    email: 'pedro.vencido@example.com',
    passwordHash: hashPassword('socio123'),
    rol: 'SOCIO',
    telefono: '+54 9 11 6021-9988',
    estado: 'ACTIVO',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    socioId: 'socio-suspendido-01',
    dni: '55555555',
    nombre: 'Ana Suspendida',
    email: 'ana.suspendida@example.com',
    passwordHash: hashPassword('socio123'),
    rol: 'SOCIO',
    telefono: '+54 9 11 4110-3329',
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
  private altasEmpleados = new Map<string, { contenido: string; respuesta: AltaEmpleado }>();
  private empleadosExternos = new Map<string, string>();
  private solicitudes = new Map<string, { socioId: string; estado: 'PENDIENTE'; createdAt: string }>();

  constructor(socios: readonly Socio[] = SEED_SOCIOS, membresias: readonly Membresia[] = SEED_MEMBRESIAS) {
    for (const s of socios) {
      this.socios.set(s.socioId, { ...s });
    }
    for (const m of membresias) {
      this.membresias.set(m.membresiaId, { ...m });
    }
  }

  async inicializarEsquema(): Promise<void> {
    // No-op for in-memory
  }

  async verificarSalud(): Promise<{ ok: boolean; detalle?: string }> {
    return { ok: true };
  }

  conexionesActivas(): number {
    return 0;
  }

  async obtenerSocio(socioId: string): Promise<Socio | null> {
    const s = this.socios.get(socioId);
    return s ? { ...s } : null;
  }

  async buscarPorEmailODni(identificador: string): Promise<Socio | null> {
    const clean = identificador.trim().toLowerCase();
    for (const socio of this.socios.values()) {
      if (socio.email.toLowerCase() === clean || socio.dni.trim() === identificador.trim()) {
        return { ...socio };
      }
    }
    return null;
  }

  async obtenerMembresias(socioId: string): Promise<Membresia[]> {
    return [...this.membresias.values()].filter((m) => m.socioId === socioId).map((m) => ({ ...m }));
  }

  async crearSocio(socio: Socio): Promise<Socio> {
    return this.guardarSocio(socio);
  }

  private guardarSocio(socio: Socio): Socio {
    if (this.socios.has(socio.socioId)) throw new IdentidadDuplicadaError('socioId');
    const normalizado = { ...socio, dni: socio.dni.trim(), email: socio.email.trim().toLowerCase() };
    for (const anterior of this.socios.values()) {
      if (anterior.dni.trim() === normalizado.dni) throw new IdentidadDuplicadaError('dni');
      if (anterior.email.trim().toLowerCase() === normalizado.email) throw new IdentidadDuplicadaError('email');
    }
    this.socios.set(socio.socioId, normalizado);
    return { ...normalizado };
  }

  async registrarEmpleado(registro: RegistroEmpleado): Promise<AltaEmpleado> {
    const { origen, clave, contenido, empleado, socio, respuesta } = registro;
    const idempotencia = JSON.stringify([origen, clave]);
    const anterior = this.altasEmpleados.get(idempotencia);
    if (anterior) {
      if (anterior.contenido !== contenido) throw conflictoEmpleado('IDEMPOTENCIA_EN_CONFLICTO');
      return { ...anterior.respuesta };
    }
    const externo = JSON.stringify([origen, empleado.empleadoExternoId]);
    const dniAnterior = this.empleadosExternos.get(externo);
    if (dniAnterior !== undefined && dniAnterior !== empleado.dni) throw conflictoEmpleado('EMPLEADO_EXTERNO_EN_CONFLICTO');
    const existentes = [...this.socios.values()];
    if (existentes.some((s) => s.dni.trim() === empleado.dni)) throw conflictoEmpleado('DNI_EXISTENTE');
    if (existentes.some((s) => s.email.trim().toLowerCase() === empleado.email)) throw conflictoEmpleado('EMAIL_EXISTENTE');
    // Sin await entre comprobación y escritura: exclusión de un solo proceso.
    this.guardarSocio(socio);
    this.solicitudes.set(respuesta.solicitudId, { socioId: socio.socioId, estado: 'PENDIENTE', createdAt: socio.createdAt });
    this.empleadosExternos.set(externo, empleado.dni);
    this.altasEmpleados.set(idempotencia, { contenido, respuesta: { ...respuesta } });
    return { ...respuesta };
  }

  async crearMembresia(membresia: Membresia): Promise<Membresia> {
    this.membresias.set(membresia.membresiaId, { ...membresia });
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


}

export class PostgresSociosRepository implements ISociosRepository {
  constructor(private pool: Pool) {}

  conexionesActivas(): number {
    return this.pool.totalCount - this.pool.idleCount;
  }

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
      await client.query('SELECT pg_advisory_xact_lock(1002)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS socios (
          socio_id VARCHAR(50) PRIMARY KEY,
          dni VARCHAR(20) NOT NULL UNIQUE,
          nombre VARCHAR(100) NOT NULL,
          email VARCHAR(100) NOT NULL,
          password_hash VARCHAR(255),
          rol VARCHAR(20) NOT NULL DEFAULT 'SOCIO',
          telefono VARCHAR(50),
          estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE socios ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
        ALTER TABLE socios ADD COLUMN IF NOT EXISTS rol VARCHAR(20) DEFAULT 'SOCIO';
        ALTER TABLE socios ADD COLUMN IF NOT EXISTS telefono VARCHAR(50);

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
        CREATE UNIQUE INDEX IF NOT EXISTS uq_socios_email_normalizado ON socios (LOWER(BTRIM(email)));
        CREATE UNIQUE INDEX IF NOT EXISTS uq_socios_dni_normalizado ON socios (BTRIM(dni));

        CREATE TABLE IF NOT EXISTS solicitudes_membresia (
          solicitud_id VARCHAR(50) PRIMARY KEY,
          socio_id VARCHAR(50) NOT NULL UNIQUE REFERENCES socios(socio_id),
          estado VARCHAR(20) NOT NULL CHECK (estado = 'PENDIENTE'),
          created_at TIMESTAMPTZ NOT NULL
        );
        CREATE TABLE IF NOT EXISTS empleados_externos (
          origen VARCHAR(100) NOT NULL,
          empleado_externo_id VARCHAR(100) NOT NULL,
          socio_id VARCHAR(50) NOT NULL UNIQUE REFERENCES socios(socio_id),
          PRIMARY KEY (origen, empleado_externo_id)
        );
        CREATE TABLE IF NOT EXISTS altas_empleados_idempotencia (
          origen VARCHAR(100) NOT NULL,
          clave VARCHAR(128) NOT NULL,
          contenido TEXT NOT NULL,
          respuesta JSONB NOT NULL,
          solicitud_id VARCHAR(50) NOT NULL REFERENCES solicitudes_membresia(solicitud_id),
          created_at TIMESTAMPTZ NOT NULL,
          PRIMARY KEY (origen, clave)
        );
      `);

      // Seed if empty or upsert seeded users
      for (const s of SEED_SOCIOS) {
        await client.query(
          `INSERT INTO socios (socio_id, dni, nombre, email, password_hash, rol, telefono, estado, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (socio_id) DO UPDATE SET
             password_hash = COALESCE(socios.password_hash, EXCLUDED.password_hash),
             rol = COALESCE(socios.rol, EXCLUDED.rol),
             telefono = COALESCE(socios.telefono, EXCLUDED.telefono)`,
          [s.socioId, s.dni, s.nombre, s.email, s.passwordHash ?? null, s.rol ?? 'SOCIO', s.telefono ?? null, s.estado, s.createdAt]
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
      'SELECT socio_id, dni, nombre, email, password_hash, rol, telefono, estado, created_at FROM socios WHERE socio_id = $1',
      [socioId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      socioId: row.socio_id,
      dni: row.dni,
      nombre: row.nombre,
      email: row.email,
      passwordHash: row.password_hash ?? undefined,
      rol: (row.rol as 'ADMIN' | 'SOCIO') ?? 'SOCIO',
      telefono: row.telefono ?? undefined,
      estado: row.estado,
      createdAt: row.created_at.toISOString(),
    };
  }

  async buscarPorEmailODni(identificador: string): Promise<Socio | null> {
    const clean = identificador.trim();
    const res = await this.pool.query(
      `SELECT socio_id, dni, nombre, email, password_hash, rol, telefono, estado, created_at 
       FROM socios 
       WHERE LOWER(BTRIM(email)) = LOWER($1) OR BTRIM(dni) = $1
       LIMIT 1`,
      [clean]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      socioId: row.socio_id,
      dni: row.dni,
      nombre: row.nombre,
      email: row.email,
      passwordHash: row.password_hash ?? undefined,
      rol: (row.rol as 'ADMIN' | 'SOCIO') ?? 'SOCIO',
      telefono: row.telefono ?? undefined,
      estado: row.estado,
      createdAt: row.created_at.toISOString(),
    };
  }

  async obtenerMembresias(socioId: string): Promise<Membresia[]> {
    const res = await this.pool.query(
      'SELECT membresia_id, socio_id, tipo_plan, fecha_inicio, fecha_fin, estado, created_at, updated_at FROM membresias WHERE socio_id = $1 ORDER BY fecha_inicio DESC, created_at DESC, membresia_id',
      [socioId],
    );
    return res.rows.map((row) => ({
      membresiaId: row.membresia_id,
      socioId: row.socio_id,
      tipoPlan: row.tipo_plan,
      fechaInicio: row.fecha_inicio.toISOString(),
      fechaFin: row.fecha_fin.toISOString(),
      estado: row.estado,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async crearSocio(socio: Socio): Promise<Socio> {
    await this.pool.query(
      `INSERT INTO socios (socio_id, dni, nombre, email, password_hash, rol, telefono, estado, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        socio.socioId,
        socio.dni,
        socio.nombre,
        socio.email,
        socio.passwordHash ?? null,
        socio.rol ?? 'SOCIO',
        socio.telefono ?? null,
        socio.estado,
        socio.createdAt,
      ]
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

  async registrarEmpleado(registro: RegistroEmpleado): Promise<AltaEmpleado> {
    const { origen, clave, contenido, empleado, socio, respuesta } = registro;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Cada clave y empleado tienen su propia exclusión compartida entre instancias.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['alta-empleado', origen, clave])]);
      const replay = await client.query('SELECT contenido,respuesta FROM altas_empleados_idempotencia WHERE origen=$1 AND clave=$2', [origen, clave]);
      if (replay.rowCount) {
        if (replay.rows[0].contenido !== contenido) throw conflictoEmpleado('IDEMPOTENCIA_EN_CONFLICTO');
        await client.query('COMMIT');
        return replay.rows[0].respuesta as AltaEmpleado;
      }
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['empleado-externo', origen, empleado.empleadoExternoId])]);
      const externo = await client.query(
        'SELECT s.dni FROM empleados_externos e JOIN socios s ON s.socio_id=e.socio_id WHERE e.origen=$1 AND e.empleado_externo_id=$2',
        [origen, empleado.empleadoExternoId],
      );
      if (externo.rowCount && externo.rows[0].dni !== empleado.dni) throw conflictoEmpleado('EMPLEADO_EXTERNO_EN_CONFLICTO');
      const duplicados = await client.query('SELECT dni,email FROM socios WHERE BTRIM(dni)=$1 OR LOWER(BTRIM(email))=$2', [empleado.dni, empleado.email]);
      if (duplicados.rows.some((row) => row.dni.trim() === empleado.dni)) throw conflictoEmpleado('DNI_EXISTENTE');
      if (duplicados.rowCount) throw conflictoEmpleado('EMAIL_EXISTENTE');
      await client.query("INSERT INTO socios(socio_id,dni,nombre,email,rol,estado,created_at) VALUES($1,$2,$3,$4,'SOCIO','ACTIVO',$5)",
        [socio.socioId, socio.dni, socio.nombre, socio.email, socio.createdAt]);
      await client.query("INSERT INTO solicitudes_membresia(solicitud_id,socio_id,estado,created_at) VALUES($1,$2,'PENDIENTE',$3)",
        [respuesta.solicitudId, socio.socioId, socio.createdAt]);
      await client.query('INSERT INTO empleados_externos(origen,empleado_externo_id,socio_id) VALUES($1,$2,$3)',
        [origen, empleado.empleadoExternoId, socio.socioId]);
      await client.query('INSERT INTO altas_empleados_idempotencia(origen,clave,contenido,respuesta,solicitud_id,created_at) VALUES($1,$2,$3,$4,$5,$6)',
        [origen, clave, contenido, JSON.stringify(respuesta), respuesta.solicitudId, socio.createdAt]);
      await client.query('COMMIT');
      return { ...respuesta };
    } catch (error) {
      await client.query('ROLLBACK');
      const sqlError = error as { code?: string; constraint?: string };
      if (sqlError.code === '23505') {
        if (sqlError.constraint === 'uq_socios_email_normalizado') throw conflictoEmpleado('EMAIL_EXISTENTE');
        if (sqlError.constraint === 'socios_dni_key' || sqlError.constraint === 'uq_socios_dni_normalizado') throw conflictoEmpleado('DNI_EXISTENTE');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async actualizarEstadoMembresia(membresiaId: string, nuevoEstado: Membresia['estado']): Promise<void> {
    await this.pool.query(
      'UPDATE membresias SET estado = $1, updated_at = NOW() WHERE membresia_id = $2',
      [nuevoEstado, membresiaId]
    );
  }


}

function conflictoEmpleado(codigo: string) {
  const mensajes: Record<string, string> = {
    IDEMPOTENCIA_EN_CONFLICTO: 'La clave de idempotencia ya se utilizó con otro contenido.',
    EMPLEADO_EXTERNO_EN_CONFLICTO: 'El empleado externo ya está asociado a otro DNI.',
    DNI_EXISTENTE: 'El DNI ya pertenece a un socio.',
    EMAIL_EXISTENTE: 'El email ya pertenece a un socio.',
  };
  return new SociosError(409, codigo, mensajes[codigo]);
}
