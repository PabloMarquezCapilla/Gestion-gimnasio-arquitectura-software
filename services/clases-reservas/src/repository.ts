import { Pool } from 'pg';
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

export interface IClaseRepository {
  readonly isMock: boolean;
  inicializarEsquema(): Promise<void>;
  verificarSalud(): Promise<{ ok: boolean; detalle?: string }>;
  listarClases(filtros: FiltrosClases, consultadoEn: string): Promise<{ items: ClaseDTO[]; total: number }>;
  obtenerClase(claseId: string, consultadoEn: string): Promise<ClaseDTO | null>;
  obtenerEntidadClase(claseId: string): Promise<ClaseEntidad | null>;
  reservarCupo(claseId: string, socioId: string): Promise<ResultadoReserva>;
  cancelarReserva(
    reservaId: string,
    promoverCallback?: (socioId: string, inicioClase?: string) => Promise<boolean>
  ): Promise<ResultadoCancelacion>;
  ingresarListaEspera(claseId: string, socioId: string): Promise<{ exito: boolean; codigo?: string; espera?: EntradaEspera }>;
  obtenerReservasPorClase(claseId: string): Promise<Reserva[]>;
  obtenerEsperaPorClase(claseId: string): Promise<EntradaEspera[]>;
  obtenerReservasPorSocio(socioId: string): Promise<{ reservas: Reserva[]; espera: EntradaEspera[] }>;
}

export class MemoryClaseRepository implements IClaseRepository {
  public readonly isMock: boolean;
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
    return this.clases.get(claseId) ?? null;
  }

  async reservarCupo(claseId: string, socioId: string): Promise<ResultadoReserva> {
    const clase = this.clases.get(claseId);
    if (!clase) {
      return { exito: false, codigo: 'CLASE_NO_ENCONTRADA', mensaje: 'La clase no existe.' };
    }
    if (Date.now() >= Date.parse(clase.inicio)) {
      return { exito: false, codigo: 'CLASE_INICIADA', mensaje: 'La clase ya ha iniciado.' };
    }

    // Verificar reserva duplicada activa
    for (const r of this.reservas.values()) {
      if (r.claseId === claseId && r.socioId === socioId && r.estado === 'CONFIRMADA') {
        return {
          exito: false,
          codigo: 'RESERVA_DUPLICADA',
          mensaje: 'El socio ya posee una reserva confirmada para esta clase.',
        };
      }
    }

    const cupos = this.calcularCuposDisponibles(claseId, clase.capacidad);
    if (cupos <= 0) {
      return {
        exito: false,
        codigo: 'CLASE_SIN_CUPOS',
        mensaje: 'No hay cupos disponibles.',
        puedeIngresarEspera: true,
      };
    }

    const reservaId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nuevaReserva: Reserva = {
      reservaId,
      claseId,
      socioId,
      estado: 'CONFIRMADA',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.reservas.set(reservaId, nuevaReserva);

    // Si estaba en lista de espera, marcar como promovido
    for (const e of this.listaEspera.values()) {
      if (e.claseId === claseId && e.socioId === socioId && e.estado === 'PENDIENTE') {
        e.estado = 'PROMOVIDO';
        e.updatedAt = new Date().toISOString();
      }
    }

    return { exito: true, reserva: nuevaReserva };
  }

  async cancelarReserva(
    reservaId: string,
    promoverCallback?: (socioId: string, inicioClase?: string) => Promise<boolean>
  ): Promise<ResultadoCancelacion> {
    const reserva = this.reservas.get(reservaId);
    if (!reserva || reserva.estado !== 'CONFIRMADA') {
      return {
        exito: false,
        codigo: 'RESERVA_NO_ENCONTRADA',
        mensaje: 'No se encontro una reserva confirmada activa con ese identificador.',
      };
    }

    const clase = this.clases.get(reserva.claseId);
    if (clase && Date.now() >= Date.parse(clase.inicio)) {
      return {
        exito: false,
        codigo: 'CLASE_YA_INICIADA',
        mensaje: 'No se puede cancelar una reserva despues del inicio de la clase.',
      };
    }

    reserva.estado = 'CANCELADA';
    reserva.updatedAt = new Date().toISOString();

    // Reasignacion automatica por orden de lista de espera
    let promocion: { socioId: string; reservaId: string } | undefined;
    const candidatos = Array.from(this.listaEspera.values())
      .filter((e) => e.claseId === reserva.claseId && e.estado === 'PENDIENTE')
      .sort((a, b) => a.orden - b.orden);

    for (const candidato of candidatos) {
      let habilitado = true;
      if (promoverCallback) {
        try {
          habilitado = await promoverCallback(candidato.socioId, clase?.inicio);
        } catch {
          // Si falla la comunicacion, conservar prioridad y continuar sin descartar
          continue;
        }
      }

      if (habilitado) {
        candidato.estado = 'PROMOVIDO';
        candidato.updatedAt = new Date().toISOString();
        const nuevaReservaId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const resPromovida: Reserva = {
          reservaId: nuevaReservaId,
          claseId: reserva.claseId,
          socioId: candidato.socioId,
          estado: 'CONFIRMADA',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        this.reservas.set(nuevaReservaId, resPromovida);
        promocion = { socioId: candidato.socioId, reservaId: nuevaReservaId };
        break;
      } else {
        // No habilitado, retirar de espera y evaluar al siguiente
        candidato.estado = 'CANCELADO';
        candidato.updatedAt = new Date().toISOString();
      }
    }

    return { exito: true, reserva, promocion };
  }

  async ingresarListaEspera(
    claseId: string,
    socioId: string
  ): Promise<{ exito: boolean; codigo?: string; espera?: EntradaEspera }> {
    const clase = this.clases.get(claseId);
    if (!clase) {
      return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
    }
    if (Date.now() >= Date.parse(clase.inicio)) {
      return { exito: false, codigo: 'CLASE_INICIADA' };
    }

    for (const r of this.reservas.values()) {
      if (r.claseId === claseId && r.socioId === socioId && r.estado === 'CONFIRMADA') {
        return { exito: false, codigo: 'TIENE_RESERVA_CONFIRMADA' };
      }
    }

    for (const e of this.listaEspera.values()) {
      if (e.claseId === claseId && e.socioId === socioId && e.estado === 'PENDIENTE') {
        return { exito: false, codigo: 'YA_EN_ESPERA', espera: e };
      }
    }

    const allEntries = Array.from(this.listaEspera.values()).filter((e) => e.claseId === claseId);
    const maxOrden = allEntries.reduce((max, e) => Math.max(max, e.orden), 0);
    const orden = maxOrden + 1;
    const esperaId = `esp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const entrada: EntradaEspera = {
      esperaId,
      claseId,
      socioId,
      orden,
      estado: 'PENDIENTE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.listaEspera.set(esperaId, entrada);
    return { exito: true, espera: entrada };
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

  async reservarCupo(claseId: string, socioId: string): Promise<ResultadoReserva> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Bloqueo pesimista a nivel de fila para garantizar consistencia estricta en concurrencia (D4)
      const claseRes = await client.query(
        'SELECT clase_id, capacidad, inicio FROM clases WHERE clase_id = $1 FOR UPDATE',
        [claseId]
      );
      if (claseRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { exito: false, codigo: 'CLASE_NO_ENCONTRADA', mensaje: 'La clase no existe.' };
      }

      const clase = claseRes.rows[0];
      if (new Date() >= new Date(clase.inicio)) {
        await client.query('ROLLBACK');
        return { exito: false, codigo: 'CLASE_INICIADA', mensaje: 'La clase ya ha iniciado.' };
      }

      // Validar si ya tiene reserva confirmada activa
      const dupRes = await client.query(
        "SELECT reserva_id FROM reservas WHERE clase_id = $1 AND socio_id = $2 AND estado = 'CONFIRMADA'",
        [claseId, socioId]
      );
      if (dupRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return {
          exito: false,
          codigo: 'RESERVA_DUPLICADA',
          mensaje: 'El socio ya posee una reserva confirmada para esta clase.',
        };
      }

      // Conteo actual de reservas confirmadas
      const countRes = await client.query(
        "SELECT count(*)::int AS ocupados FROM reservas WHERE clase_id = $1 AND estado = 'CONFIRMADA'",
        [claseId]
      );
      const ocupados = countRes.rows[0].ocupados;
      if (ocupados >= clase.capacidad) {
        await client.query('ROLLBACK');
        return {
          exito: false,
          codigo: 'CLASE_SIN_CUPOS',
          mensaje: 'No hay cupos disponibles.',
          puedeIngresarEspera: true,
        };
      }

      const reservaId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await client.query(
        `INSERT INTO reservas (reserva_id, clase_id, socio_id, estado, created_at, updated_at)
         VALUES ($1, $2, $3, 'CONFIRMADA', NOW(), NOW())`,
        [reservaId, claseId, socioId]
      );

      // Si estaba en espera, marcar promovido
      await client.query(
        "UPDATE lista_espera SET estado = 'PROMOVIDO', updated_at = NOW() WHERE clase_id = $1 AND socio_id = $2 AND estado = 'PENDIENTE'",
        [claseId, socioId]
      );

      await client.query('COMMIT');

      const nuevaReserva: Reserva = {
        reservaId,
        claseId,
        socioId,
        estado: 'CONFIRMADA',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { exito: true, reserva: nuevaReserva };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async cancelarReserva(
    reservaId: string,
    promoverCallback?: (socioId: string, inicioClase?: string) => Promise<boolean>
  ): Promise<ResultadoCancelacion> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const resRow = await client.query(
        "SELECT reserva_id, clase_id, socio_id, estado FROM reservas WHERE reserva_id = $1 AND estado = 'CONFIRMADA' FOR UPDATE",
        [reservaId]
      );
      if (resRow.rows.length === 0) {
        await client.query('ROLLBACK');
        return {
          exito: false,
          codigo: 'RESERVA_NO_ENCONTRADA',
          mensaje: 'No se encontro una reserva confirmada activa con ese identificador.',
        };
      }

      const reservaActual = resRow.rows[0];
      const claseRes = await client.query('SELECT inicio FROM clases WHERE clase_id = $1', [
        reservaActual.clase_id,
      ]);
      if (claseRes.rows.length > 0 && new Date() >= new Date(claseRes.rows[0].inicio)) {
        await client.query('ROLLBACK');
        return {
          exito: false,
          codigo: 'CLASE_YA_INICIADA',
          mensaje: 'No se puede cancelar una reserva despues del inicio de la clase.',
        };
      }

      await client.query(
        "UPDATE reservas SET estado = 'CANCELADA', updated_at = NOW() WHERE reserva_id = $1",
        [reservaId]
      );

      // Buscar candidatos en lista de espera
      const candidatosRes = await client.query(
        "SELECT espera_id, socio_id FROM lista_espera WHERE clase_id = $1 AND estado = 'PENDIENTE' ORDER BY orden ASC FOR UPDATE",
        [reservaActual.clase_id]
      );

      const inicioClase = claseRes.rows[0]?.inicio?.toISOString();
      let promocion: { socioId: string; reservaId: string } | undefined;
      for (const candidato of candidatosRes.rows) {
        let habilitado = true;
        if (promoverCallback) {
          try {
            habilitado = await promoverCallback(candidato.socio_id, inicioClase);
          } catch {
            // Error de comunicacion con el servicio externo: preservar prioridad y no descartar (D10)
            continue;
          }
        }

        if (habilitado) {
          await client.query(
            "UPDATE lista_espera SET estado = 'PROMOVIDO', updated_at = NOW() WHERE espera_id = $1",
            [candidato.espera_id]
          );
          const nuevaReservaId = `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await client.query(
            `INSERT INTO reservas (reserva_id, clase_id, socio_id, estado, created_at, updated_at)
             VALUES ($1, $2, $3, 'CONFIRMADA', NOW(), NOW())`,
            [nuevaReservaId, reservaActual.clase_id, candidato.socio_id]
          );
          promocion = { socioId: candidato.socio_id, reservaId: nuevaReservaId };
          break;
        } else {
          await client.query(
            "UPDATE lista_espera SET estado = 'CANCELADO', updated_at = NOW() WHERE espera_id = $1",
            [candidato.espera_id]
          );
        }
      }

      await client.query('COMMIT');

      const reservaCancelada: Reserva = {
        reservaId,
        claseId: reservaActual.clase_id,
        socioId: reservaActual.socio_id,
        estado: 'CANCELADA',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return { exito: true, reserva: reservaCancelada, promocion };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async ingresarListaEspera(
    claseId: string,
    socioId: string
  ): Promise<{ exito: boolean; codigo?: string; espera?: EntradaEspera }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const claseRes = await client.query('SELECT clase_id, inicio FROM clases WHERE clase_id = $1 FOR UPDATE', [
        claseId,
      ]);
      if (claseRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
      }
      if (new Date() >= new Date(claseRes.rows[0].inicio)) {
        await client.query('ROLLBACK');
        return { exito: false, codigo: 'CLASE_INICIADA' };
      }

      const dupRes = await client.query(
        "SELECT reserva_id FROM reservas WHERE clase_id = $1 AND socio_id = $2 AND estado = 'CONFIRMADA'",
        [claseId, socioId]
      );
      if (dupRes.rows.length > 0) {
        await client.query('ROLLBACK');
        return { exito: false, codigo: 'TIENE_RESERVA_CONFIRMADA' };
      }

      const ordenRes = await client.query(
        "SELECT COALESCE(MAX(orden), 0)::int AS max_orden FROM lista_espera WHERE clase_id = $1",
        [claseId]
      );
      const orden = ordenRes.rows[0].max_orden + 1;
      const esperaId = `esp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const insertRes = await client.query(
        `INSERT INTO lista_espera (espera_id, clase_id, socio_id, orden, estado, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'PENDIENTE', NOW(), NOW())
         ON CONFLICT (clase_id, socio_id) WHERE estado = 'PENDIENTE' DO NOTHING
         RETURNING espera_id`,
        [esperaId, claseId, socioId, orden]
      );

      if (insertRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return { exito: false, codigo: 'YA_EN_ESPERA' };
      }

      await client.query('COMMIT');

      const entrada: EntradaEspera = {
        esperaId,
        claseId,
        socioId,
        orden,
        estado: 'PENDIENTE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      return { exito: true, espera: entrada };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
