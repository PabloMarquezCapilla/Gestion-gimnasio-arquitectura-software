import { GESTION_MEMBRESIAS_DDL } from './membresias.postgres';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { Socio, Membresia } from './types';
import { IdentidadDuplicadaError, SociosError } from './errors';
import type { AltaEmpleado, EmpleadosRepository, RegistroEmpleado } from './empleados.service';
import type {
  CarCrudsVinculosRepository, CambioVinculoCarCruds, HistorialVinculoCarCruds,
  PaginaVinculosCarCruds, VinculoCarCruds,
} from './car-cruds-vinculos.repository';
import { hashPassword } from './security';
import type {
  CarCrudsEvidenciasRepository, CambioPreparacionFotografia, CambioReclamoFotografia, CambioFinalizacionFotografia,
} from './car-cruds-evidencias.repository';
import { CAR_CRUDS_EVIDENCIAS_DDL, MemoryCarCrudsEvidenciasRepository, PostgresCarCrudsEvidenciasRepository } from './car-cruds-evidencias.storage';

export interface ISociosRepository extends EmpleadosRepository, CarCrudsVinculosRepository, CarCrudsEvidenciasRepository {
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
  private vinculosCarCruds = new Map<string, VinculoCarCruds>();
  private historialCarCruds: HistorialVinculoCarCruds[] = [];
  private readonly fotografiasCarCruds: MemoryCarCrudsEvidenciasRepository;

  constructor(socios: readonly Socio[] = SEED_SOCIOS, membresias: readonly Membresia[] = SEED_MEMBRESIAS, clock: () => Date = () => new Date()) {
    for (const s of socios) {
      this.socios.set(s.socioId, { ...s });
    }
    for (const m of membresias) {
      this.membresias.set(m.membresiaId, { ...m });
    }
    this.fotografiasCarCruds = new MemoryCarCrudsEvidenciasRepository((employeeId) => {
      const vinculo = { ...(this.vinculosCarCruds.get(employeeId) ?? vinculoCarCrudsAusente(employeeId)) };
      const socio = vinculo.socioId ? this.socios.get(vinculo.socioId) : undefined;
      return {
        vinculo, socio: socio ? { ...socio } : null,
        membresias: [...this.membresias.values()].filter(m => m.socioId === vinculo.socioId).map(m => ({ ...m })),
      };
    }, clock);
  }

  obtenerFotografias(employeeId: string, period: string) { return this.fotografiasCarCruds.obtenerFotografias(employeeId, period); }
  prepararFotografia(cambio: CambioPreparacionFotografia) { return this.fotografiasCarCruds.prepararFotografia(cambio); }
  reclamarFotografia(cambio: CambioReclamoFotografia) { return this.fotografiasCarCruds.reclamarFotografia(cambio); }
  finalizarFotografia(cambio: CambioFinalizacionFotografia) { return this.fotografiasCarCruds.finalizarFotografia(cambio); }

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

  async buscarSociosParaVincular(identificador: string): Promise<Socio[]> {
    const clean = identificador.trim();
    return [...this.socios.values()]
      .filter((socio) => socio.dni.trim() === clean || socio.email.trim().toLowerCase() === clean.toLowerCase())
      .sort((a, b) => a.socioId.localeCompare(b.socioId))
      .slice(0, 2)
      .map((socio) => ({ ...socio }));
  }

  async obtenerVinculoCarCruds(employeeId: string): Promise<VinculoCarCruds> {
    return { ...(this.vinculosCarCruds.get(employeeId) ?? vinculoCarCrudsAusente(employeeId)) };
  }

  async cambiarVinculoCarCruds(cambio: CambioVinculoCarCruds): Promise<VinculoCarCruds> {
    const anterior = this.vinculosCarCruds.get(cambio.employeeId) ?? vinculoCarCrudsAusente(cambio.employeeId);
    if (anterior.socioId === cambio.socioId) return { ...anterior };
    if (anterior.version !== cambio.versionEsperada) throw vinculoDesactualizado();
    if (cambio.socioId !== null) {
      if (!this.socios.has(cambio.socioId)) throw socioNoEncontrado();
      if ([...this.vinculosCarCruds.values()].some((vinculo) => vinculo.socioId === cambio.socioId)) {
        throw socioYaVinculado();
      }
    }
    if (!this.socios.has(cambio.administradorId)) throw new Error('No existe el administrador del cambio de vínculo.');
    const fecha = new Date(cambio.fecha).toISOString();
    const siguiente: VinculoCarCruds = {
      employeeId: cambio.employeeId, socioId: cambio.socioId,
      version: anterior.version + 1, actualizadoEn: fecha,
    };
    const historial: HistorialVinculoCarCruds = {
      historialId: randomUUID(), employeeId: cambio.employeeId, version: siguiente.version,
      socioAnteriorId: anterior.socioId, socioNuevoId: cambio.socioId,
      administradorId: cambio.administradorId, createdAt: fecha,
    };
    // Sin await: las comprobaciones, el vínculo y la auditoría cambian juntos en memoria.
    this.vinculosCarCruds.set(cambio.employeeId, siguiente);
    this.historialCarCruds.push(historial);
    return { ...siguiente };
  }

  async getHistorialVinculoCarCruds(employeeId: string): Promise<HistorialVinculoCarCruds[]> {
    return this.historialCarCruds.filter((entrada) => entrada.employeeId === employeeId)
      .sort((a, b) => a.version - b.version)
      .map((entrada) => ({ ...entrada }));
  }

  async listarVinculosCarCruds(page: number, pageSize: number): Promise<PaginaVinculosCarCruds> {
    const actuales = [...this.vinculosCarCruds.values()]
      .filter((vinculo) => vinculo.socioId !== null)
      .sort((a, b) => a.employeeId.localeCompare(b.employeeId));
    const desde = (BigInt(page) - 1n) * BigInt(pageSize);
    const items = desde >= BigInt(actuales.length) ? [] : actuales
      .slice(Number(desde), Number(desde) + pageSize).map((vinculo) => ({ ...vinculo }));
    return { items, page, pageSize, total: actuales.length };
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
  private readonly fotografiasCarCruds: PostgresCarCrudsEvidenciasRepository;

  constructor(private pool: Pool) { this.fotografiasCarCruds = new PostgresCarCrudsEvidenciasRepository(pool); }

  obtenerFotografias(employeeId: string, period: string) { return this.fotografiasCarCruds.obtenerFotografias(employeeId, period); }
  prepararFotografia(cambio: CambioPreparacionFotografia) { return this.fotografiasCarCruds.prepararFotografia(cambio); }
  reclamarFotografia(cambio: CambioReclamoFotografia) { return this.fotografiasCarCruds.reclamarFotografia(cambio); }
  finalizarFotografia(cambio: CambioFinalizacionFotografia) { return this.fotografiasCarCruds.finalizarFotografia(cambio); }

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

        CREATE TABLE IF NOT EXISTS car_cruds_vinculos (
          employee_id TEXT PRIMARY KEY,
          socio_id VARCHAR(50) REFERENCES socios(socio_id),
          version INTEGER NOT NULL CHECK (version >= 1),
          actualizado_en TIMESTAMPTZ NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS uq_car_cruds_vinculos_socio
          ON car_cruds_vinculos (socio_id) WHERE socio_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS car_cruds_vinculos_historial (
          id UUID PRIMARY KEY,
          employee_id TEXT NOT NULL REFERENCES car_cruds_vinculos(employee_id),
          version INTEGER NOT NULL CHECK (version >= 1),
          socio_anterior VARCHAR(50) REFERENCES socios(socio_id),
          socio_nuevo VARCHAR(50) REFERENCES socios(socio_id),
          administrador_id VARCHAR(50) NOT NULL REFERENCES socios(socio_id),
          created_at TIMESTAMPTZ NOT NULL,
          UNIQUE (employee_id, version)
        );
      `);

      await client.query(CAR_CRUDS_EVIDENCIAS_DDL);
      await client.query(GESTION_MEMBRESIAS_DDL);

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

  async buscarSociosParaVincular(identificador: string): Promise<Socio[]> {
    const res = await this.pool.query(
      `SELECT socio_id, dni, nombre, email, password_hash, rol, telefono, estado, created_at
       FROM socios WHERE LOWER(BTRIM(email)) = LOWER($1) OR BTRIM(dni) = $1
       ORDER BY socio_id LIMIT 2`,
      [identificador.trim()],
    );
    return res.rows.map((row) => ({
      socioId: row.socio_id, dni: row.dni, nombre: row.nombre, email: row.email,
      passwordHash: row.password_hash ?? undefined, rol: row.rol ?? 'SOCIO',
      telefono: row.telefono ?? undefined, estado: row.estado, createdAt: row.created_at.toISOString(),
    }));
  }

  async obtenerVinculoCarCruds(employeeId: string): Promise<VinculoCarCruds> {
    const res = await this.pool.query(
      'SELECT employee_id, socio_id, version, actualizado_en FROM car_cruds_vinculos WHERE employee_id = $1',
      [employeeId],
    );
    return res.rowCount ? vinculoCarCrudsDeFila(res.rows[0]) : vinculoCarCrudsAusente(employeeId);
  }

  async cambiarVinculoCarCruds(cambio: CambioVinculoCarCruds): Promise<VinculoCarCruds> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        JSON.stringify(['car-cruds-vinculo', cambio.employeeId]),
      ]);
      const actual = await client.query(
        'SELECT employee_id, socio_id, version, actualizado_en FROM car_cruds_vinculos WHERE employee_id = $1 FOR UPDATE',
        [cambio.employeeId],
      );
      const anterior = actual.rowCount ? vinculoCarCrudsDeFila(actual.rows[0]) : vinculoCarCrudsAusente(cambio.employeeId);
      if (anterior.socioId === cambio.socioId) {
        await client.query('COMMIT');
        return anterior;
      }
      if (anterior.version !== cambio.versionEsperada) throw vinculoDesactualizado();
      if (cambio.socioId !== null) {
        const socio = await client.query('SELECT socio_id FROM socios WHERE socio_id = $1 FOR KEY SHARE', [cambio.socioId]);
        if (!socio.rowCount) throw socioNoEncontrado();
        const ocupado = await client.query(
          'SELECT employee_id FROM car_cruds_vinculos WHERE socio_id = $1 AND employee_id <> $2',
          [cambio.socioId, cambio.employeeId],
        );
        if (ocupado.rowCount) throw socioYaVinculado();
      }
      const siguiente = await client.query(
        `INSERT INTO car_cruds_vinculos (employee_id, socio_id, version, actualizado_en)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id) DO UPDATE SET socio_id = EXCLUDED.socio_id,
           version = EXCLUDED.version, actualizado_en = EXCLUDED.actualizado_en
         RETURNING employee_id, socio_id, version, actualizado_en`,
        [cambio.employeeId, cambio.socioId, anterior.version + 1, cambio.fecha],
      );
      await client.query(
        `INSERT INTO car_cruds_vinculos_historial
         (id, employee_id, version, socio_anterior, socio_nuevo, administrador_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), cambio.employeeId, anterior.version + 1, anterior.socioId,
          cambio.socioId, cambio.administradorId, cambio.fecha],
      );
      await client.query('COMMIT');
      return vinculoCarCrudsDeFila(siguiente.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      const sqlError = error as { code?: string; constraint?: string };
      if (sqlError.code === '23505' && sqlError.constraint === 'uq_car_cruds_vinculos_socio') throw socioYaVinculado();
      throw error;
    } finally {
      client.release();
    }
  }

  async getHistorialVinculoCarCruds(employeeId: string): Promise<HistorialVinculoCarCruds[]> {
    const res = await this.pool.query(
      `SELECT id, employee_id, version, socio_anterior, socio_nuevo, administrador_id, created_at
       FROM car_cruds_vinculos_historial WHERE employee_id = $1 ORDER BY version`,
      [employeeId],
    );
    return res.rows.map((row) => ({
      historialId: row.id, employeeId: row.employee_id, version: row.version,
      socioAnteriorId: row.socio_anterior, socioNuevoId: row.socio_nuevo,
      administradorId: row.administrador_id, createdAt: row.created_at.toISOString(),
    }));
  }

  async listarVinculosCarCruds(page: number, pageSize: number): Promise<PaginaVinculosCarCruds> {
    // El total y la página comparten el snapshot de una única sentencia.
    const res = await this.pool.query(
      `WITH activos AS MATERIALIZED (
         SELECT employee_id, socio_id, version, actualizado_en FROM car_cruds_vinculos WHERE socio_id IS NOT NULL
       ), pagina AS (
         SELECT employee_id, socio_id, version, actualizado_en FROM activos
         ORDER BY employee_id LIMIT $1 OFFSET $2
       )
       SELECT (SELECT COUNT(*)::text FROM activos) total,
         COALESCE((SELECT jsonb_agg(to_jsonb(pagina) ORDER BY employee_id) FROM pagina), '[]'::jsonb) items`,
      [pageSize, ((BigInt(page) - 1n) * BigInt(pageSize)).toString()],
    );
    const row = res.rows[0];
    const total = Number(row.total);
    if (!Number.isSafeInteger(total)) throw new Error('La cantidad de vínculos supera el rango admitido.');
    return { items: row.items.map(vinculoCarCrudsDeFila), page, pageSize, total };
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

function vinculoCarCrudsAusente(employeeId: string): VinculoCarCruds {
  return { employeeId, socioId: null, version: 0, actualizadoEn: null };
}

function vinculoCarCrudsDeFila(row: {
  employee_id: string; socio_id: string | null; version: number; actualizado_en: Date | string;
}): VinculoCarCruds {
  return {
    employeeId: row.employee_id, socioId: row.socio_id, version: row.version,
    actualizadoEn: new Date(row.actualizado_en).toISOString(),
  };
}

function vinculoDesactualizado() {
  return new SociosError(409, 'VINCULO_DESACTUALIZADO', 'El vínculo cambió; consulte su versión actual antes de modificarlo.');
}

function socioNoEncontrado() {
  return new SociosError(404, 'SOCIO_NO_ENCONTRADO', 'No se encontró el socio solicitado.');
}

function socioYaVinculado() {
  return new SociosError(409, 'SOCIO_YA_VINCULADO', 'El socio ya está vinculado con otro empleado de Car Cruds.');
}
