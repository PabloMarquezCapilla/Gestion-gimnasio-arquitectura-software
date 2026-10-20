import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { IClaseRepository, Instante, OpcionesReserva, ResultadoPromocion } from './ports';
export { IClaseRepository } from './ports';

function instante(value?: Instante) { return typeof value === 'function' ? value() : value ?? new Date().toISOString(); }

import {
  ClaseDTO,
  ClaseEntidad,
  EntradaEspera,
  FiltrosClases,
  Reserva,
  ResultadoCancelacion,
  ResultadoReserva,
} from './types';
import { mockClasses, MockClass } from './mock-data';

export class MemoryClaseRepository implements IClaseRepository {
  public readonly isMock: boolean;
  conexionesActivas(): number { return 0; }
  private clases: Map<string, ClaseEntidad> = new Map();
  private reservas: Map<string, Reserva> = new Map();
  private listaEspera: Map<string, EntradaEspera> = new Map();

  constructor(initialClasses: readonly MockClass[] = mockClasses, isMock: boolean = true) {
    this.isMock = isMock;
    for (const c of initialClasses) {
      this.clases.set(c.claseId, {
        claseId: c.claseId,
        nombre: c.nombre,
        sedeId: c.sedeId,
        inicio: c.inicio,
        fin: new Date(new Date(c.inicio).getTime() + 60 * 60 * 1000).toISOString(),
        capacidad: c.capacidad,
        publicada: c.publicada,
        createdAt: new Date().toISOString(),
      });

      // Crear reservas iniciales para coincidir exactamente con cuposDisponibles
      const reservasOcupadas = Math.max(0, c.capacidad - c.cuposDisponibles);
      for (let i = 0; i < reservasOcupadas; i++) {
        const id = `res-init-${c.claseId}-${i + 1}`;
        this.reservas.set(id, {
          reservaId: id,
          claseId: c.claseId,
          socioId: `socio-seed-${i + 1}`,
          estado: 'CONFIRMADA',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  async inicializarEsquema(): Promise<void> {
    // No-op en memoria
  }

  async verificarSalud(): Promise<{ ok: boolean; detalle?: string }> {
    return { ok: true };
  }

  private calcularCuposDisponibles(claseId: string, capacidad: number): number {
    let ocupados = 0;
    for (const r of this.reservas.values()) {
      if (r.claseId === claseId && r.estado === 'CONFIRMADA') {
        ocupados++;
      }
    }
    return Math.max(0, Math.min(capacidad, capacidad - ocupados));
  }

  async listarClases(filtros: FiltrosClases, consultadoEn: string): Promise<{ items: ClaseDTO[]; total: number }> {
    const desdeTime = filtros.desde ? Date.parse(filtros.desde) : undefined;
    const hastaTime = filtros.hasta ? Date.parse(filtros.hasta) : undefined;

    const list = Array.from(this.clases.values())
      .filter((c) => c.publicada)
      .filter((c) => filtros.sedeId === undefined || c.sedeId === filtros.sedeId)
      .filter((c) => desdeTime === undefined || Date.parse(c.inicio) >= desdeTime)
      .filter((c) => hastaTime === undefined || Date.parse(c.inicio) < hastaTime)
      .sort((a, b) => {
        const diff = Date.parse(a.inicio) - Date.parse(b.inicio);
        if (diff !== 0) return diff;
        return a.claseId < b.claseId ? -1 : a.claseId > b.claseId ? 1 : 0;
      });

    const start = (filtros.pagina - 1) * filtros.tamanio;
    const paginados = list.slice(start, start + filtros.tamanio).map((c) => ({
      claseId: c.claseId,
      nombre: c.nombre,
      sedeId: c.sedeId,
      inicio: c.inicio,
      capacidad: c.capacidad,
      cuposDisponibles: this.calcularCuposDisponibles(c.claseId, c.capacidad),
      consultadoEn,
    }));

    return { items: paginados, total: list.length };
  }

  async obtenerClase(claseId: string, consultadoEn: string): Promise<ClaseDTO | null> {
    const clase = this.clases.get(claseId);
    if (!clase || !clase.publicada) return null;
    return {
      claseId: clase.claseId,
      nombre: clase.nombre,
      sedeId: clase.sedeId,
      inicio: clase.inicio,
      capacidad: clase.capacidad,
      cuposDisponibles: this.calcularCuposDisponibles(clase.claseId, clase.capacidad),
      consultadoEn,
    };
  }

  async obtenerEntidadClase(claseId: string): Promise<ClaseEntidad | null> {
    const clase = this.clases.get(claseId);
    return clase ? { ...clase } : null;
  }


  private bloqueos = new Map<string, Promise<void>>();

  private async conClase<T>(claseId: string, operation: () => T | Promise<T>): Promise<T> {
    const anterior = this.bloqueos.get(claseId) ?? Promise.resolve();
    let liberar!: () => void;
    const puerta = new Promise<void>((resolve) => { liberar = resolve; });
    const actual = anterior.then(() => puerta);
    this.bloqueos.set(claseId, actual);
    await anterior;
    try { return await operation(); }
    finally {
      liberar();
      if (this.bloqueos.get(claseId) === actual) this.bloqueos.delete(claseId);
    }
  }

  private primero(claseId: string) {
    return [...this.listaEspera.values()]
      .filter((entry) => entry.claseId === claseId && entry.estado === 'PENDIENTE')
      .sort((a, b) => a.orden - b.orden)[0];
  }

  private agregarEspera(claseId: string, socioId: string, ahora: string) {
    const existente = [...this.listaEspera.values()].find(
      (entry) => entry.claseId === claseId && entry.socioId === socioId && entry.estado === 'PENDIENTE',
    );
    if (existente) return { exito: false, codigo: 'YA_EN_ESPERA', espera: { ...existente } };
    const orden = Math.max(0, ...[...this.listaEspera.values()]
      .filter((entry) => entry.claseId === claseId).map((entry) => entry.orden)) + 1;
    const entrada: EntradaEspera = {
      esperaId: 'esp-' + randomUUID(), claseId, socioId, orden, estado: 'PENDIENTE',
      createdAt: ahora, updatedAt: ahora,
    };
    this.listaEspera.set(entrada.esperaId, entrada);
    return { exito: true, espera: { ...entrada } };
  }

  async obtenerReserva(reservaId: string): Promise<Reserva | null> {
    const reserva = this.reservas.get(reservaId);
    return reserva ? { ...reserva } : null;
  }

  async reservarCupo(claseId: string, socioId: string, opciones?: OpcionesReserva): Promise<ResultadoReserva> {
    return this.conClase<ResultadoReserva>(claseId, () => {
      const ahora = instante(opciones?.ahora);
      const clase = this.clases.get(claseId);
      if (!clase?.publicada) return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
      if (Date.parse(ahora) >= Date.parse(clase.inicio)) return { exito: false, codigo: 'CLASE_INICIADA' };
      if ([...this.reservas.values()].some((r) => r.claseId === claseId && r.socioId === socioId && r.estado === 'CONFIRMADA')) {
        return { exito: false, codigo: 'RESERVA_DUPLICADA' };
      }
      if (this.calcularCuposDisponibles(claseId, clase.capacidad) <= 0 || this.primero(claseId)) {
        return opciones?.ingresarEsperaSiLlena
          ? this.agregarEspera(claseId, socioId, ahora)
          : { exito: false, codigo: 'CLASE_SIN_CUPOS', puedeIngresarEspera: true };
      }
      const reserva: Reserva = {
        reservaId: 'res-' + randomUUID(), claseId, socioId, estado: 'CONFIRMADA',
        createdAt: ahora, updatedAt: ahora,
      };
      this.reservas.set(reserva.reservaId, reserva);
      return { exito: true, reserva: { ...reserva } };
    });
  }

  async ingresarListaEspera(claseId: string, socioId: string, momento?: Instante) {
    return this.conClase(claseId, () => {
      const ahora = instante(momento);
      const clase = this.clases.get(claseId);
      if (!clase?.publicada) return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
      if (Date.parse(ahora) >= Date.parse(clase.inicio)) return { exito: false, codigo: 'CLASE_INICIADA' };
      if ([...this.reservas.values()].some((r) => r.claseId === claseId && r.socioId === socioId && r.estado === 'CONFIRMADA')) {
        return { exito: false, codigo: 'TIENE_RESERVA_CONFIRMADA' };
      }
      if (this.calcularCuposDisponibles(claseId, clase.capacidad) > 0 && !this.primero(claseId)) {
        return { exito: false, codigo: 'CLASE_CON_CUPOS' };
      }
      return this.agregarEspera(claseId, socioId, ahora);
    });
  }

  async cancelarReserva(reservaId: string, momento?: Instante): Promise<ResultadoCancelacion> {
    const original = this.reservas.get(reservaId);
    if (!original) return { exito: false, codigo: 'RESERVA_NO_ENCONTRADA' };
    return this.conClase<ResultadoCancelacion>(original.claseId, () => {
      const ahora = instante(momento);
      const reserva = this.reservas.get(reservaId)!;
      const clase = this.clases.get(reserva.claseId)!;
      if (reserva.estado === 'CONFIRMADA' && Date.parse(ahora) >= Date.parse(clase.inicio)) {
        return { exito: false, codigo: 'CLASE_INICIADA' };
      }
      if (reserva.estado === 'CONFIRMADA') {
        reserva.estado = 'CANCELADA';
        reserva.updatedAt = ahora;
      }
      return {
        exito: true, reserva: { ...reserva },
        reasignacionPendiente: Date.parse(ahora) < Date.parse(clase.inicio) && !!this.primero(clase.claseId),
      };
    });
  }

  async obtenerPrimerCandidato(claseId: string) {
    const clase = this.clases.get(claseId);
    const espera = this.primero(claseId);
    if (!clase || !espera || this.calcularCuposDisponibles(claseId, clase.capacidad) <= 0) return null;
    return { clase: { ...clase }, espera: { ...espera } };
  }

  async aplicarEvaluacionEspera(claseId: string, esperaId: string, habilitado: boolean, momento: Instante): Promise<ResultadoPromocion> {
    return this.conClase<ResultadoPromocion>(claseId, () => {
      const ahora = instante(momento);
      const clase = this.clases.get(claseId);
      if (!clase || Date.parse(ahora) >= Date.parse(clase.inicio)) return { estado: 'CLASE_INICIADA' };
      if (this.calcularCuposDisponibles(claseId, clase.capacidad) <= 0) return { estado: 'SIN_CUPO' };
      const candidato = this.primero(claseId);
      if (!candidato || candidato.esperaId !== esperaId) return { estado: 'CAMBIO' };
      candidato.updatedAt = ahora;
      if (!habilitado) {
        candidato.estado = 'CANCELADO';
        return { estado: 'RETIRADO' };
      }
      candidato.estado = 'PROMOVIDO';
      if ([...this.reservas.values()].some((r) => r.claseId === claseId && r.socioId === candidato.socioId && r.estado === 'CONFIRMADA')) {
        return { estado: 'CAMBIO' };
      }
      const reserva: Reserva = {
        reservaId: 'res-' + randomUUID(), claseId, socioId: candidato.socioId,
        estado: 'CONFIRMADA', createdAt: ahora, updatedAt: ahora,
      };
      this.reservas.set(reserva.reservaId, reserva);
      return { estado: 'PROMOVIDO', promocion: { socioId: reserva.socioId, reservaId: reserva.reservaId } };
    });
  }

  async listarClasesConEsperaYCupo(ahora: string): Promise<string[]> {
    return [...this.clases.values()]
      .filter((c) => c.publicada && Date.parse(c.inicio) > Date.parse(ahora)
        && this.calcularCuposDisponibles(c.claseId, c.capacidad) > 0 && this.primero(c.claseId))
      .map((c) => c.claseId).slice(0, 100);
  }

  async obtenerReservasPorClase(claseId: string): Promise<Reserva[]> {
    return Array.from(this.reservas.values()).filter((r) => r.claseId === claseId);
  }

  async obtenerEsperaPorClase(claseId: string): Promise<EntradaEspera[]> {
    return Array.from(this.listaEspera.values())
      .filter((e) => e.claseId === claseId)
      .sort((a, b) => a.orden - b.orden);
  }

  async obtenerReservasPorSocio(socioId: string): Promise<{ reservas: Reserva[]; espera: EntradaEspera[] }> {
    const reservas = Array.from(this.reservas.values()).filter(
      (r) => r.socioId === socioId && r.estado === 'CONFIRMADA'
    );
    const espera = Array.from(this.listaEspera.values()).filter(
      (e) => e.socioId === socioId && e.estado === 'PENDIENTE'
    );
    return { reservas, espera };
  }
}

export class PostgresClaseRepository implements IClaseRepository {
  public readonly isMock = false;

  constructor(private pool: Pool) {}

  conexionesActivas(): number { return this.pool.totalCount - this.pool.idleCount; }

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
      // Bloqueo consultivo transaccional para evitar condición de carrera cuando inician múltiples réplicas (D12)
      await client.query('SELECT pg_advisory_xact_lock(1001)');
      await client.query(`
        CREATE TABLE IF NOT EXISTS clases (
          clase_id VARCHAR(50) PRIMARY KEY,
          nombre VARCHAR(100) NOT NULL,
          sede_id VARCHAR(50) NOT NULL,
          profesor VARCHAR(100),
          actividad VARCHAR(50),
          inicio TIMESTAMPTZ NOT NULL,
          fin TIMESTAMPTZ NOT NULL,
          capacidad INT NOT NULL,
          publicada BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        ALTER TABLE clases ADD COLUMN IF NOT EXISTS documento_busqueda tsvector
        GENERATED ALWAYS AS (
          setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
          setweight(to_tsvector('spanish', coalesce(actividad, '')), 'B') ||
          setweight(to_tsvector('spanish', coalesce(profesor, '')), 'C')
        ) STORED;

        CREATE TABLE IF NOT EXISTS reservas (
          reserva_id VARCHAR(50) PRIMARY KEY,
          clase_id VARCHAR(50) NOT NULL REFERENCES clases(clase_id),
          socio_id VARCHAR(50) NOT NULL,
          estado VARCHAR(20) NOT NULL CHECK (estado IN ('CONFIRMADA', 'CANCELADA')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS lista_espera (
          espera_id VARCHAR(50) PRIMARY KEY,
          clase_id VARCHAR(50) NOT NULL REFERENCES clases(clase_id),
          socio_id VARCHAR(50) NOT NULL,
          orden INT NOT NULL,
          estado VARCHAR(20) NOT NULL CHECK (estado IN ('PENDIENTE', 'PROMOVIDO', 'CANCELADO')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_reserva_activa ON reservas (clase_id, socio_id) WHERE estado = 'CONFIRMADA';
        CREATE UNIQUE INDEX IF NOT EXISTS uq_espera_activa ON lista_espera (clase_id, socio_id) WHERE estado = 'PENDIENTE';
        CREATE INDEX IF NOT EXISTS idx_clases_consulta ON clases (publicada, sede_id, inicio);
        CREATE INDEX IF NOT EXISTS idx_clases_fts ON clases USING GIN (documento_busqueda);
      `);

      const countRes = await client.query('SELECT count(*)::int AS count FROM clases');
      if (countRes.rows[0].count === 0) {
        for (const c of mockClasses) {
          await client.query(
            `INSERT INTO clases (clase_id, nombre, sede_id, profesor, actividad, inicio, fin, capacidad, publicada, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
             ON CONFLICT (clase_id) DO NOTHING`,
            [
              c.claseId,
              c.nombre,
              c.sedeId,
              c.nombre.includes('Yoga') ? 'Lucía Santoro' : 'Camila Rossi',
              c.nombre.includes('Yoga') ? 'YOGA' : 'PILATES',
              c.inicio,
              new Date(new Date(c.inicio).getTime() + 60 * 60 * 1000).toISOString(),
              c.capacidad,
              c.publicada,
            ]
          );

          // Crear reservas iniciales para que cuposDisponibles coincida exactamente
          const reservasOcupadas = Math.max(0, c.capacidad - c.cuposDisponibles);
          for (let i = 0; i < reservasOcupadas; i++) {
            const resId = `res-init-${c.claseId}-${i + 1}`;
            await client.query(
              `INSERT INTO reservas (reserva_id, clase_id, socio_id, estado, created_at, updated_at)
               VALUES ($1, $2, $3, 'CONFIRMADA', NOW(), NOW())
               ON CONFLICT (reserva_id) DO NOTHING`,
              [resId, c.claseId, `socio-seed-${i + 1}`]
            );
          }
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

  async listarClases(filtros: FiltrosClases, consultadoEn: string): Promise<{ items: ClaseDTO[]; total: number }> {
    const params: unknown[] = [];
    let where = 'WHERE c.publicada = TRUE';

    if (filtros.sedeId) {
      params.push(filtros.sedeId);
      where += ` AND c.sede_id = $${params.length}`;
    }
    if (filtros.desde) {
      params.push(filtros.desde);
      where += ` AND c.inicio >= $${params.length}::timestamptz`;
    }
    if (filtros.hasta) {
      params.push(filtros.hasta);
      where += ` AND c.inicio < $${params.length}::timestamptz`;
    }

    const countQuery = `SELECT count(*)::int AS total FROM clases c ${where}`;
    const countRes = await this.pool.query(countQuery, params);
    const total = countRes.rows[0]?.total ?? 0;

    const offset = (filtros.pagina - 1) * filtros.tamanio;
    params.push(filtros.tamanio, offset);

    const query = `
      SELECT c.clase_id, c.nombre, c.sede_id, c.inicio, c.capacidad,
             GREATEST(0, c.capacidad - COALESCE(COUNT(r.reserva_id) FILTER (WHERE r.estado = 'CONFIRMADA'), 0))::int AS cupos_disponibles
      FROM clases c
      LEFT JOIN reservas r ON c.clase_id = r.clase_id
      ${where}
      GROUP BY c.clase_id, c.nombre, c.sede_id, c.inicio, c.capacidad
      ORDER BY c.inicio ASC, c.clase_id ASC
      LIMIT $${params.length - 1} OFFSET $${params.length};
    `;

    const res = await this.pool.query(query, params);
    const items: ClaseDTO[] = res.rows.map((row) => ({
      claseId: row.clase_id,
      nombre: row.nombre,
      sedeId: row.sede_id,
      inicio: row.inicio.toISOString(),
      capacidad: Number(row.capacidad),
      cuposDisponibles: Number(row.cupos_disponibles),
      consultadoEn,
    }));

    return { items, total };
  }

  async obtenerClase(claseId: string, consultadoEn: string): Promise<ClaseDTO | null> {
    const query = `
      SELECT c.clase_id, c.nombre, c.sede_id, c.inicio, c.capacidad,
             GREATEST(0, c.capacidad - COALESCE(COUNT(r.reserva_id) FILTER (WHERE r.estado = 'CONFIRMADA'), 0))::int AS cupos_disponibles
      FROM clases c
      LEFT JOIN reservas r ON c.clase_id = r.clase_id
      WHERE c.clase_id = $1 AND c.publicada = TRUE
      GROUP BY c.clase_id, c.nombre, c.sede_id, c.inicio, c.capacidad;
    `;
    const res = await this.pool.query(query, [claseId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      claseId: row.clase_id,
      nombre: row.nombre,
      sedeId: row.sede_id,
      inicio: row.inicio.toISOString(),
      capacidad: Number(row.capacidad),
      cuposDisponibles: Number(row.cupos_disponibles),
      consultadoEn,
    };
  }

  async obtenerEntidadClase(claseId: string): Promise<ClaseEntidad | null> {
    const res = await this.pool.query(
      'SELECT clase_id, nombre, sede_id, profesor, actividad, inicio, fin, capacidad, publicada, created_at FROM clases WHERE clase_id = $1',
      [claseId]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      claseId: row.clase_id,
      nombre: row.nombre,
      sedeId: row.sede_id,
      profesor: row.profesor,
      actividad: row.actividad,
      inicio: row.inicio.toISOString(),
      fin: row.fin.toISOString(),
      capacidad: Number(row.capacidad),
      publicada: row.publicada,
      createdAt: row.created_at.toISOString(),
    };
  }


  private async conClase<T>(
    claseId: string,
    operation: (client: PoolClient, clase: { clase_id: string; capacidad: number; inicio: Date; publicada: boolean } | null) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await client.query(
        'SELECT clase_id, capacidad, inicio, publicada FROM clases WHERE clase_id = $1 FOR UPDATE', [claseId],
      );
      const result = await operation(client, row.rows[0] ?? null);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  private async primero(client: PoolClient, claseId: string) {
    const result = await client.query(
      "SELECT espera_id, clase_id, socio_id, orden, estado, created_at, updated_at FROM lista_espera WHERE clase_id=$1 AND estado='PENDIENTE' ORDER BY orden, espera_id LIMIT 1 FOR UPDATE",
      [claseId],
    );
    return result.rows[0];
  }

  private async agregarEspera(client: PoolClient, claseId: string, socioId: string, ahora: string) {
    const existente = await client.query(
      "SELECT espera_id FROM lista_espera WHERE clase_id=$1 AND socio_id=$2 AND estado='PENDIENTE'", [claseId, socioId],
    );
    if (existente.rowCount) return { exito: false, codigo: 'YA_EN_ESPERA' };
    const ordenRes = await client.query('SELECT COALESCE(MAX(orden),0)::int+1 AS orden FROM lista_espera WHERE clase_id=$1', [claseId]);
    const espera: EntradaEspera = {
      esperaId: 'esp-' + randomUUID(), claseId, socioId, orden: ordenRes.rows[0].orden,
      estado: 'PENDIENTE', createdAt: ahora, updatedAt: ahora,
    };
    await client.query(
      "INSERT INTO lista_espera (espera_id,clase_id,socio_id,orden,estado,created_at,updated_at) VALUES($1,$2,$3,$4,'PENDIENTE',$5,$5)",
      [espera.esperaId, claseId, socioId, espera.orden, ahora],
    );
    return { exito: true, espera };
  }

  async obtenerReserva(reservaId: string): Promise<Reserva | null> {
    const result = await this.pool.query('SELECT * FROM reservas WHERE reserva_id=$1', [reservaId]);
    const row = result.rows[0];
    return row ? {
      reservaId: row.reserva_id, claseId: row.clase_id, socioId: row.socio_id, estado: row.estado,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    } : null;
  }

  async reservarCupo(claseId: string, socioId: string, opciones?: OpcionesReserva): Promise<ResultadoReserva> {
    return this.conClase<ResultadoReserva>(claseId, async (client, clase) => {
      const ahora = instante(opciones?.ahora);
      if (!clase?.publicada) return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
      if (Date.parse(ahora) >= clase.inicio.getTime()) return { exito: false, codigo: 'CLASE_INICIADA' };
      const dup = await client.query("SELECT 1 FROM reservas WHERE clase_id=$1 AND socio_id=$2 AND estado='CONFIRMADA'", [claseId, socioId]);
      if (dup.rowCount) return { exito: false, codigo: 'RESERVA_DUPLICADA' };
      const count = await client.query("SELECT COUNT(*)::int AS ocupados FROM reservas WHERE clase_id=$1 AND estado='CONFIRMADA'", [claseId]);
      if (count.rows[0].ocupados >= clase.capacidad || await this.primero(client, claseId)) {
        return opciones?.ingresarEsperaSiLlena
          ? this.agregarEspera(client, claseId, socioId, ahora)
          : { exito: false, codigo: 'CLASE_SIN_CUPOS', puedeIngresarEspera: true };
      }
      const reserva: Reserva = {
        reservaId: 'res-' + randomUUID(), claseId, socioId, estado: 'CONFIRMADA', createdAt: ahora, updatedAt: ahora,
      };
      await client.query(
        "INSERT INTO reservas(reserva_id,clase_id,socio_id,estado,created_at,updated_at) VALUES($1,$2,$3,'CONFIRMADA',$4,$4)",
        [reserva.reservaId, claseId, socioId, ahora],
      );
      return { exito: true, reserva };
    });
  }

  async ingresarListaEspera(claseId: string, socioId: string, momento?: Instante) {
    return this.conClase(claseId, async (client, clase) => {
      const ahora = instante(momento);
      if (!clase?.publicada) return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
      if (Date.parse(ahora) >= clase.inicio.getTime()) return { exito: false, codigo: 'CLASE_INICIADA' };
      const dup = await client.query("SELECT 1 FROM reservas WHERE clase_id=$1 AND socio_id=$2 AND estado='CONFIRMADA'", [claseId, socioId]);
      if (dup.rowCount) return { exito: false, codigo: 'TIENE_RESERVA_CONFIRMADA' };
      const count = await client.query("SELECT COUNT(*)::int AS ocupados FROM reservas WHERE clase_id=$1 AND estado='CONFIRMADA'", [claseId]);
      if (count.rows[0].ocupados < clase.capacidad && !await this.primero(client, claseId)) {
        return { exito: false, codigo: 'CLASE_CON_CUPOS' };
      }
      return this.agregarEspera(client, claseId, socioId, ahora);
    });
  }

  async cancelarReserva(reservaId: string, momento?: Instante): Promise<ResultadoCancelacion> {
    const original = await this.obtenerReserva(reservaId);
    if (!original) return { exito: false, codigo: 'RESERVA_NO_ENCONTRADA' };
    return this.conClase<ResultadoCancelacion>(original.claseId, async (client, clase) => {
      const ahora = instante(momento);
      const result = await client.query('SELECT * FROM reservas WHERE reserva_id=$1 FOR UPDATE', [reservaId]);
      const row = result.rows[0];
      if (!row || !clase) return { exito: false, codigo: 'RESERVA_NO_ENCONTRADA' };
      if (row.estado === 'CONFIRMADA' && Date.parse(ahora) >= clase.inicio.getTime()) {
        return { exito: false, codigo: 'CLASE_INICIADA' };
      }
      if (row.estado === 'CONFIRMADA') {
        await client.query("UPDATE reservas SET estado='CANCELADA',updated_at=$2 WHERE reserva_id=$1", [reservaId, ahora]);
      }
      return {
        exito: true,
        reserva: {
          reservaId, claseId: row.clase_id, socioId: row.socio_id, estado: 'CANCELADA',
          createdAt: row.created_at.toISOString(), updatedAt: row.estado === 'CONFIRMADA' ? ahora : row.updated_at.toISOString(),
        },
        reasignacionPendiente: Date.parse(ahora) < clase.inicio.getTime() && !!await this.primero(client, original.claseId),
      };
    });
  }

  async obtenerPrimerCandidato(claseId: string) {
    const clase = await this.obtenerEntidadClase(claseId);
    if (!clase) return null;
    const result = await this.pool.query(
      "SELECT * FROM lista_espera WHERE clase_id=$1 AND estado='PENDIENTE' ORDER BY orden,espera_id LIMIT 1", [claseId],
    );
    const row = result.rows[0];
    if (!row) return null;
    const disponibilidad = await this.obtenerClase(claseId, new Date().toISOString());
    if (!disponibilidad || disponibilidad.cuposDisponibles <= 0) return null;
    return { clase, espera: {
      esperaId: row.espera_id, claseId, socioId: row.socio_id, orden: row.orden,
      estado: row.estado as EntradaEspera['estado'], createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    } };
  }

  async aplicarEvaluacionEspera(claseId: string, esperaId: string, habilitado: boolean, momento: Instante): Promise<ResultadoPromocion> {
    return this.conClase<ResultadoPromocion>(claseId, async (client, clase) => {
      const ahora = instante(momento);
      if (!clase || Date.parse(ahora) >= clase.inicio.getTime()) return { estado: 'CLASE_INICIADA' };
      const count = await client.query("SELECT COUNT(*)::int AS ocupados FROM reservas WHERE clase_id=$1 AND estado='CONFIRMADA'", [claseId]);
      if (count.rows[0].ocupados >= clase.capacidad) return { estado: 'SIN_CUPO' };
      const primero = await this.primero(client, claseId);
      if (!primero || primero.espera_id !== esperaId) return { estado: 'CAMBIO' };
      if (!habilitado) {
        await client.query("UPDATE lista_espera SET estado='CANCELADO',updated_at=$2 WHERE espera_id=$1", [esperaId, ahora]);
        return { estado: 'RETIRADO' };
      }
      await client.query("UPDATE lista_espera SET estado='PROMOVIDO',updated_at=$2 WHERE espera_id=$1", [esperaId, ahora]);
      const dup = await client.query("SELECT 1 FROM reservas WHERE clase_id=$1 AND socio_id=$2 AND estado='CONFIRMADA'", [claseId, primero.socio_id]);
      if (dup.rowCount) return { estado: 'CAMBIO' };
      const reservaId = 'res-' + randomUUID();
      await client.query(
        "INSERT INTO reservas(reserva_id,clase_id,socio_id,estado,created_at,updated_at) VALUES($1,$2,$3,'CONFIRMADA',$4,$4)",
        [reservaId, claseId, primero.socio_id, ahora],
      );
      return { estado: 'PROMOVIDO', promocion: { socioId: primero.socio_id, reservaId } };
    });
  }

  async listarClasesConEsperaYCupo(ahora: string): Promise<string[]> {
    const result = await this.pool.query(
      "SELECT c.clase_id FROM clases c WHERE c.publicada=TRUE AND c.inicio>$1 AND c.capacidad>(SELECT COUNT(*) FROM reservas r WHERE r.clase_id=c.clase_id AND r.estado='CONFIRMADA') AND EXISTS(SELECT 1 FROM lista_espera e WHERE e.clase_id=c.clase_id AND e.estado='PENDIENTE') ORDER BY c.inicio,c.clase_id LIMIT 100",
      [ahora],
    );
    return result.rows.map((row) => row.clase_id);
  }

  async obtenerReservasPorClase(claseId: string): Promise<Reserva[]> {
    const res = await this.pool.query(
      'SELECT reserva_id, clase_id, socio_id, estado, created_at, updated_at FROM reservas WHERE clase_id = $1 ORDER BY created_at ASC',
      [claseId]
    );
    return res.rows.map((r) => ({
      reservaId: r.reserva_id,
      claseId: r.clase_id,
      socioId: r.socio_id,
      estado: r.estado,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async obtenerEsperaPorClase(claseId: string): Promise<EntradaEspera[]> {
    const res = await this.pool.query(
      'SELECT espera_id, clase_id, socio_id, orden, estado, created_at, updated_at FROM lista_espera WHERE clase_id = $1 ORDER BY orden ASC',
      [claseId]
    );
    return res.rows.map((r) => ({
      esperaId: r.espera_id,
      claseId: r.clase_id,
      socioId: r.socio_id,
      orden: Number(r.orden),
      estado: r.estado,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    }));
  }

  async obtenerReservasPorSocio(socioId: string): Promise<{ reservas: Reserva[]; espera: EntradaEspera[] }> {
    const [resR, resE] = await Promise.all([
      this.pool.query(
        "SELECT reserva_id, clase_id, socio_id, estado, created_at, updated_at FROM reservas WHERE socio_id = $1 AND estado = 'CONFIRMADA' ORDER BY created_at DESC",
        [socioId]
      ),
      this.pool.query(
        "SELECT espera_id, clase_id, socio_id, orden, estado, created_at, updated_at FROM lista_espera WHERE socio_id = $1 AND estado = 'PENDIENTE' ORDER BY orden ASC",
        [socioId]
      ),
    ]);
    return {
      reservas: resR.rows.map((r) => ({
        reservaId: r.reserva_id,
        claseId: r.clase_id,
        socioId: r.socio_id,
        estado: r.estado,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
      espera: resE.rows.map((r) => ({
        esperaId: r.espera_id,
        claseId: r.clase_id,
        socioId: r.socio_id,
        orden: Number(r.orden),
        estado: r.estado,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
    };
  }
}
