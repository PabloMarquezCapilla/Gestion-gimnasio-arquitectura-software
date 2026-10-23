import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import type { FotografiaCarCruds } from './car-cruds.service';
import type {
  CambioFinalizacionFotografia, CambioPreparacionFotografia, CambioReclamoFotografia,
  CarCrudsEvidenciasRepository, FuenteFotografia, ReclamoFotografia, RegistroFotografia,
} from './car-cruds-evidencias.repository';
import { SociosError } from './errors';

const MAX_VERSION = Number.MAX_SAFE_INTEGER;
const LEASE_MS = 60_000;

// Se ejecuta dentro del inicializador de Socios, después de sus tablas, con el
// mismo bloqueo de migración. El cuerpo es texto para conservar su serialización.
export const CAR_CRUDS_EVIDENCIAS_DDL = `
  CREATE TABLE IF NOT EXISTS car_cruds_evidencias_series (
    employee_id TEXT NOT NULL REFERENCES car_cruds_vinculos(employee_id),
    period VARCHAR(7) NOT NULL CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    source_reference UUID NOT NULL UNIQUE,
    ultima_version BIGINT NOT NULL CHECK (ultima_version BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (employee_id, period)
  );
  CREATE TABLE IF NOT EXISTS car_cruds_evidencias (
    fotografia_id UUID PRIMARY KEY,
    employee_id TEXT NOT NULL,
    period VARCHAR(7) NOT NULL,
    version BIGINT NOT NULL CHECK (version BETWEEN 1 AND 9007199254740991),
    socio_id VARCHAR(50) NOT NULL REFERENCES socios(socio_id),
    version_vinculo INTEGER NOT NULL CHECK (version_vinculo >= 1),
    administrador_id VARCHAR(50) NOT NULL REFERENCES socios(socio_id),
    creada_en TIMESTAMPTZ NOT NULL,
    payload TEXT NOT NULL CHECK (jsonb_typeof(payload::jsonb) = 'object'),
    estado TEXT NOT NULL CHECK (estado IN ('PREPARADA','ENVIANDO','PENDIENTE','RECIBIDA','REQUIERE_REVISION')),
    intentos BIGINT NOT NULL DEFAULT 0 CHECK (intentos BETWEEN 0 AND 9007199254740991),
    ultimo_intento_en TIMESTAMPTZ,
    recibida_en TIMESTAMPTZ,
    applied BOOLEAN,
    codigo_error TEXT,
    lease_id UUID,
    lease_hasta TIMESTAMPTZ,
    FOREIGN KEY (employee_id, period) REFERENCES car_cruds_evidencias_series(employee_id, period),
    UNIQUE (employee_id, period, version),
    CHECK ((estado = 'ENVIANDO' AND lease_id IS NOT NULL AND lease_hasta IS NOT NULL)
       OR (estado <> 'ENVIANDO' AND lease_id IS NULL AND lease_hasta IS NULL)),
    CHECK ((payload::jsonb)->>'employeeId' = employee_id),
    CHECK ((payload::jsonb)->>'period' = period),
    CHECK (((payload::jsonb)->>'version')::numeric = version)
  );
  CREATE OR REPLACE FUNCTION car_cruds_fotografia_inmutable() RETURNS TRIGGER AS $$
  BEGIN
    IF ROW(NEW.fotografia_id, NEW.employee_id, NEW.period, NEW.version,
           NEW.socio_id, NEW.version_vinculo, NEW.administrador_id, NEW.creada_en, NEW.payload)
       IS DISTINCT FROM
       ROW(OLD.fotografia_id, OLD.employee_id, OLD.period, OLD.version,
           OLD.socio_id, OLD.version_vinculo, OLD.administrador_id, OLD.creada_en, OLD.payload) THEN
      RAISE EXCEPTION 'La fotografía de Car Cruds es inmutable';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS car_cruds_fotografia_inmutable ON car_cruds_evidencias;
  CREATE TRIGGER car_cruds_fotografia_inmutable BEFORE UPDATE ON car_cruds_evidencias
    FOR EACH ROW EXECUTE FUNCTION car_cruds_fotografia_inmutable();
`;

interface SerieMemoria { sourceReference: string; version: number }

export class MemoryCarCrudsEvidenciasRepository implements CarCrudsEvidenciasRepository {
  private readonly series = new Map<string, SerieMemoria>();
  private readonly fotografias = new Map<string, RegistroFotografia>();

  constructor(
    private readonly getFuente: (employeeId: string) => FuenteFotografia,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async obtenerFotografias(employeeId: string, period: string): Promise<RegistroFotografia[]> {
    return [...this.fotografias.values()]
      .filter((foto) => foto.payload.employeeId === employeeId && foto.payload.period === period)
      .sort((a, b) => a.payload.version - b.payload.version).map(copiar);
  }

  async prepararFotografia(cambio: CambioPreparacionFotografia): Promise<RegistroFotografia> {
    // El callback es síncrono: fuente, verificaciones y escritura forman una
    // sección crítica sin await compartida con los vínculos en memoria.
    const fuente = copiar(this.getFuente(cambio.employeeId));
    verificarFuente(fuente, cambio.versionVinculoEsperada);
    const corte = Date.parse(cambio.fecha);
    fuente.miembroObservadoEnPeriodo = [...this.fotografias.values()].some((registro) => {
      const observadaEn = Date.parse(registro.payload.observedAt);
      return registro.payload.employeeId === cambio.employeeId && registro.payload.period === cambio.period
        && registro.socioId === fuente.vinculo.socioId && registro.payload.member === true
        && Number.isFinite(observadaEn) && Number.isFinite(corte) && observadaEn <= corte;
    });
    const clave = JSON.stringify([cambio.employeeId, cambio.period]);
    const serie = this.series.get(clave);
    const anterior = serie ? this.ultima(cambio.employeeId, cambio.period) : undefined;
    const version = nuevaVersion(serie?.version ?? 0, cambio.versionAnteriorEsperada);
    const revisarAnterior = verificarPreparacion(anterior, fuente, cambio, this.clock().getTime());
    const referencia = serie?.sourceReference ?? randomUUID();
    const payload = generarPayload(cambio, fuente, referencia, version);
    const registro = registroNuevo(cambio, fuente, payload);
    if (revisarAnterior && anterior) {
      anterior.estado = 'REQUIERE_REVISION';
      anterior.codigoError = 'VINCULO_CAMBIADO';
      anterior.leaseId = null;
      anterior.leaseHasta = null;
    }
    this.series.set(clave, { sourceReference: referencia, version });
    this.fotografias.set(registro.fotografiaId, registro);
    return copiar(registro);
  }

  async reclamarFotografia(cambio: CambioReclamoFotografia): Promise<ReclamoFotografia> {
    const registro = this.encontrar(cambio.fotografiaId);
    if (this.ultima(registro.payload.employeeId, registro.payload.period)?.fotografiaId !== registro.fotografiaId) {
      throw desactualizada();
    }
    if (registro.estado === 'RECIBIDA') return { fotografia: copiar(registro), leaseId: null };
    const fuente = this.getFuente(registro.payload.employeeId);
    verificarReclamo(registro, fuente, cambio, this.clock().getTime());
    const fecha = this.clock();
    const leaseId = randomUUID();
    registro.estado = 'ENVIANDO';
    registro.intentos = contadorSeguro(registro.intentos + 1);
    registro.ultimoIntentoEn = fecha.toISOString();
    registro.leaseId = leaseId;
    registro.leaseHasta = new Date(fecha.getTime() + LEASE_MS).toISOString();
    registro.codigoError = null;
    return { fotografia: copiar(registro), leaseId };
  }

  async finalizarFotografia(cambio: CambioFinalizacionFotografia): Promise<RegistroFotografia> {
    const registro = this.encontrar(cambio.fotografiaId);
    if (registro.estado !== 'ENVIANDO' || registro.leaseId !== cambio.leaseId) return copiar(registro);
    registro.estado = cambio.estado;
    registro.codigoError = cambio.codigoError;
    registro.applied = cambio.applied;
    registro.recibidaEn = cambio.estado === 'RECIBIDA' ? this.clock().toISOString() : null;
    registro.leaseId = null;
    registro.leaseHasta = null;
    return copiar(registro);
  }

  private encontrar(id: string): RegistroFotografia {
    const registro = this.fotografias.get(id);
    if (!registro) throw noEncontrada();
    return registro;
  }

  private ultima(employeeId: string, period: string): RegistroFotografia | undefined {
    let ultima: RegistroFotografia | undefined;
    for (const registro of this.fotografias.values()) {
      if (registro.payload.employeeId === employeeId && registro.payload.period === period
        && (!ultima || registro.payload.version > ultima.payload.version)) ultima = registro;
    }
    return ultima;
  }
}

export class PostgresCarCrudsEvidenciasRepository implements CarCrudsEvidenciasRepository {
  constructor(private readonly pool: Pool) {}

  async obtenerFotografias(employeeId: string, period: string): Promise<RegistroFotografia[]> {
    const result = await this.pool.query(
      'SELECT * FROM car_cruds_evidencias WHERE employee_id = $1 AND period = $2 ORDER BY version',
      [employeeId, period],
    );
    return result.rows.map(desdeFila);
  }

  async prepararFotografia(cambio: CambioPreparacionFotografia): Promise<RegistroFotografia> {
    return this.transaccion(cambio.employeeId, cambio.period, async (client) => {
      const fuente = await leerFuente(client, cambio.employeeId);
      verificarFuente(fuente, cambio.versionVinculoEsperada);
      const observacion = await client.query(
        `SELECT EXISTS (
          SELECT 1 FROM car_cruds_evidencias
          WHERE employee_id = $1 AND period = $2 AND socio_id = $3
            AND (payload::jsonb)->'member' = 'true'::jsonb
            AND CASE WHEN pg_input_is_valid((payload::jsonb)->>'observedAt', 'timestamp with time zone')
              THEN ((payload::jsonb)->>'observedAt')::timestamptz <= $4::timestamptz
              ELSE FALSE END
        ) AS observada`,
        [cambio.employeeId, cambio.period, fuente.vinculo.socioId, new Date(cambio.fecha).toISOString()],
      );
      fuente.miembroObservadoEnPeriodo = observacion.rows[0].observada === true;
      const cabecera = await client.query(
        'SELECT source_reference, ultima_version FROM car_cruds_evidencias_series WHERE employee_id = $1 AND period = $2 FOR UPDATE',
        [cambio.employeeId, cambio.period],
      );
      const versionAnterior = cabecera.rowCount ? contadorSeguro(cabecera.rows[0].ultima_version) : 0;
      const version = nuevaVersion(versionAnterior, cambio.versionAnteriorEsperada);
      const anteriorRows = await client.query(
        'SELECT * FROM car_cruds_evidencias WHERE employee_id = $1 AND period = $2 AND version = $3 FOR UPDATE',
        [cambio.employeeId, cambio.period, versionAnterior],
      );
      const anterior = anteriorRows.rowCount ? desdeFila(anteriorRows.rows[0]) : undefined;
      const ahora = await horaDb(client);
      const revisarAnterior = verificarPreparacion(anterior, fuente, cambio, ahora.getTime());
      const referencia: string = cabecera.rowCount ? cabecera.rows[0].source_reference : randomUUID();
      const payload = generarPayload(cambio, fuente, referencia, version);
      const registro = registroNuevo(cambio, fuente, payload);
      await client.query(
        `INSERT INTO car_cruds_evidencias_series (employee_id, period, source_reference, ultima_version)
         VALUES ($1,$2,$3,$4) ON CONFLICT (employee_id, period) DO UPDATE SET ultima_version = EXCLUDED.ultima_version`,
        [cambio.employeeId, cambio.period, referencia, version],
      );
      if (revisarAnterior && anterior) {
        await client.query(
          `UPDATE car_cruds_evidencias SET estado = 'REQUIERE_REVISION', codigo_error = 'VINCULO_CAMBIADO', lease_id = NULL, lease_hasta = NULL
           WHERE fotografia_id = $1`, [anterior.fotografiaId],
        );
      }
      const result = await client.query(
        `INSERT INTO car_cruds_evidencias
         (fotografia_id, employee_id, period, version, socio_id, version_vinculo, administrador_id, creada_en, payload, estado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PREPARADA') RETURNING *`,
        [registro.fotografiaId, cambio.employeeId, cambio.period, version, registro.socioId,
          registro.versionVinculo, cambio.administradorId, registro.creadaEn, JSON.stringify(payload)],
      );
      return desdeFila(result.rows[0]);
    });
  }

  async reclamarFotografia(cambio: CambioReclamoFotografia): Promise<ReclamoFotografia> {
    const identidad = await this.identidad(cambio.fotografiaId);
    return this.transaccion(identidad.employee_id, identidad.period, async (client) => {
      const result = await client.query('SELECT * FROM car_cruds_evidencias WHERE fotografia_id = $1 FOR UPDATE', [cambio.fotografiaId]);
      if (!result.rowCount) throw noEncontrada();
      const registro = desdeFila(result.rows[0]);
      const serie = await client.query(
        'SELECT ultima_version FROM car_cruds_evidencias_series WHERE employee_id = $1 AND period = $2',
        [identidad.employee_id, identidad.period],
      );
      if (!serie.rowCount || contadorSeguro(serie.rows[0].ultima_version) !== registro.payload.version) throw desactualizada();
      if (registro.estado === 'RECIBIDA') return { fotografia: registro, leaseId: null };
      const fuente = await leerFuente(client, identidad.employee_id);
      const ahora = await horaDb(client);
      verificarReclamo(registro, fuente, cambio, ahora.getTime());
      const leaseId = randomUUID();
      contadorSeguro(registro.intentos + 1);
      const update = await client.query(
        `UPDATE car_cruds_evidencias SET estado = 'ENVIANDO', intentos = intentos + 1,
         ultimo_intento_en = $2, lease_id = $3, lease_hasta = $4, codigo_error = NULL
         WHERE fotografia_id = $1 RETURNING *`,
        [cambio.fotografiaId, ahora.toISOString(), leaseId, new Date(ahora.getTime() + LEASE_MS).toISOString()],
      );
      return { fotografia: desdeFila(update.rows[0]), leaseId };
    });
  }

  async finalizarFotografia(cambio: CambioFinalizacionFotografia): Promise<RegistroFotografia> {
    const identidad = await this.identidad(cambio.fotografiaId);
    return this.transaccion(identidad.employee_id, identidad.period, async (client) => {
      // El UUID es un fencing token: una respuesta tardía nunca finaliza el
      // intento que otra réplica reclamó después del vencimiento del lease.
      const result = await client.query(
        `UPDATE car_cruds_evidencias SET estado = $3, codigo_error = $4, applied = $5,
         recibida_en = CASE WHEN $3 = 'RECIBIDA' THEN clock_timestamp() ELSE NULL END,
         lease_id = NULL, lease_hasta = NULL
         WHERE fotografia_id = $1 AND estado = 'ENVIANDO' AND lease_id = $2 RETURNING *`,
        [cambio.fotografiaId, cambio.leaseId, cambio.estado, cambio.codigoError, cambio.applied],
      );
      if (result.rowCount) return desdeFila(result.rows[0]);
      const actual = await client.query('SELECT * FROM car_cruds_evidencias WHERE fotografia_id = $1', [cambio.fotografiaId]);
      if (!actual.rowCount) throw noEncontrada();
      return desdeFila(actual.rows[0]);
    });
  }

  private async identidad(id: string): Promise<{ employee_id: string; period: string }> {
    // Comparar como texto convierte un UUID mal formado en un 404, no un 500.
    const result = await this.pool.query(
      'SELECT employee_id, period FROM car_cruds_evidencias WHERE fotografia_id::text = $1', [id],
    );
    if (!result.rowCount) throw noEncontrada();
    return result.rows[0];
  }

  private async transaccion<T>(employeeId: string, period: string, accion: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Orden único: vínculo, serie, fotografía. Comparte el primer bloqueo con
      // cambiarVinculoCarCruds, incluso cuando no existe todavía una serie.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['car-cruds-vinculo', employeeId])]);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [JSON.stringify(['car-cruds-evidencias', employeeId, period])]);
      const respuesta = await accion(client);
      await client.query('COMMIT');
      return respuesta;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function copiar<T>(value: T): T { return structuredClone(value); }

function contadorSeguro(value: unknown): number {
  const numero = typeof value === 'string' && /^[0-9]+$/.test(value) ? Number(value) : value;
  if (typeof numero !== 'number' || !Number.isSafeInteger(numero) || numero < 0 || numero > MAX_VERSION) {
    throw new SociosError(409, 'CAR_CRUDS_FOTOGRAFIA_DESACTUALIZADA', 'La versión de la fotografía queda fuera del rango seguro.');
  }
  return numero;
}

function nuevaVersion(actual: number, esperada: number): number {
  contadorSeguro(esperada);
  if (actual !== esperada || actual >= MAX_VERSION) throw desactualizada();
  return actual + 1;
}

function verificarFuente(fuente: FuenteFotografia, versionEsperada: number): void {
  if (!Number.isSafeInteger(versionEsperada) || fuente.vinculo.version !== versionEsperada
    || !fuente.vinculo.socioId || fuente.socio?.socioId !== fuente.vinculo.socioId) throw vinculoDesactualizado();
}

function verificarPreparacion(
  anterior: RegistroFotografia | undefined, fuente: FuenteFotografia, cambio: CambioPreparacionFotografia, ahora: number,
): boolean {
  if (!anterior) return false;
  if (anterior.estado === 'ENVIANDO' && Number(new Date(anterior.leaseHasta!)) > ahora) throw envioEnCurso();
  const cambioVinculo = anterior.versionVinculo !== fuente.vinculo.version || anterior.socioId !== fuente.vinculo.socioId;
  if (cambioVinculo && !cambio.confirmarCambioVinculo) throw revisionRequerida();
  if (cambioVinculo) return anterior.estado !== 'RECIBIDA';
  if (anterior.estado === 'PENDIENTE' || anterior.estado === 'ENVIANDO') throw envioPendiente();
  if (anterior.estado === 'REQUIERE_REVISION' && anterior.codigoError === 'CAR_CRUDS_EVIDENCIA_CONFLICTO') throw revisionRequerida();
  return false;
}

function verificarReclamo(
  registro: RegistroFotografia, fuente: FuenteFotografia, cambio: CambioReclamoFotografia, ahora: number,
): void {
  verificarFuente(fuente, cambio.versionVinculoEsperada);
  if (registro.versionVinculo !== fuente.vinculo.version || registro.socioId !== fuente.vinculo.socioId) throw vinculoDesactualizado();
  if (registro.estado === 'ENVIANDO' && Number(new Date(registro.leaseHasta!)) > ahora) throw envioEnCurso();
  if (registro.estado === 'REQUIERE_REVISION' && !cambio.confirmarRevision) throw revisionRequerida();
}

function generarPayload(
  cambio: CambioPreparacionFotografia, fuente: FuenteFotografia, referencia: string, version: number,
): FotografiaCarCruds {
  const payload = copiar(cambio.generar(copiar(fuente), referencia, version));
  if (!payload || payload.employeeId !== cambio.employeeId || payload.period !== cambio.period
    || payload.sourceReference !== referencia || payload.version !== version) {
    throw new Error('La fotografía generada no corresponde con su serie y versión.');
  }
  // JSON.stringify es también la representación que se guarda y se reintenta.
  return JSON.parse(JSON.stringify(payload)) as FotografiaCarCruds;
}

function registroNuevo(cambio: CambioPreparacionFotografia, fuente: FuenteFotografia, payload: FotografiaCarCruds): RegistroFotografia {
  return {
    fotografiaId: randomUUID(), socioId: fuente.vinculo.socioId!, versionVinculo: fuente.vinculo.version,
    administradorId: cambio.administradorId, creadaEn: new Date(cambio.fecha).toISOString(), payload,
    estado: 'PREPARADA', intentos: 0, ultimoIntentoEn: null, recibidaEn: null,
    applied: null, codigoError: null, leaseId: null, leaseHasta: null,
  };
}

async function horaDb(client: PoolClient): Promise<Date> {
  const result = await client.query('SELECT clock_timestamp() AS ahora');
  return new Date(result.rows[0].ahora);
}

async function leerFuente(client: PoolClient, employeeId: string): Promise<FuenteFotografia> {
  const result = await client.query(
    `SELECT v.employee_id, v.socio_id, v.version, v.actualizado_en,
      to_jsonb(s) AS socio,
      COALESCE((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.membresia_id)
        FROM membresias m WHERE m.socio_id = s.socio_id), '[]'::jsonb) AS membresias
     FROM car_cruds_vinculos v LEFT JOIN socios s ON s.socio_id = v.socio_id
     WHERE v.employee_id = $1`, [employeeId],
  );
  if (!result.rowCount) return { vinculo: { employeeId, socioId: null, version: 0, actualizadoEn: null }, socio: null, membresias: [] };
  const row = result.rows[0];
  const socio = row.socio;
  return {
    vinculo: { employeeId: row.employee_id, socioId: row.socio_id, version: row.version, actualizadoEn: fechaIso(row.actualizado_en) },
    socio: socio ? {
      socioId: socio.socio_id, dni: socio.dni, nombre: socio.nombre, email: socio.email,
      passwordHash: socio.password_hash ?? undefined, rol: socio.rol, telefono: socio.telefono ?? undefined,
      estado: socio.estado, createdAt: fechaIso(socio.created_at)!,
    } : null,
    membresias: row.membresias.map((m: QueryResultRow) => ({
      membresiaId: m.membresia_id, socioId: m.socio_id, tipoPlan: m.tipo_plan,
      fechaInicio: fechaIso(m.fecha_inicio)!, fechaFin: fechaIso(m.fecha_fin)!, estado: m.estado,
      createdAt: fechaIso(m.created_at)!, updatedAt: fechaIso(m.updated_at)!,
    })),
  };
}

function fechaIso(value: Date | string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function desdeFila(row: QueryResultRow): RegistroFotografia {
  const payload: FotografiaCarCruds = typeof row.payload === 'string' ? JSON.parse(row.payload) : copiar(row.payload);
  const version = contadorSeguro(row.version);
  if (payload.version !== version) throw new Error('La versión guardada de Car Cruds no coincide con su cuerpo.');
  return {
    fotografiaId: row.fotografia_id, socioId: row.socio_id, versionVinculo: row.version_vinculo,
    administradorId: row.administrador_id, creadaEn: fechaIso(row.creada_en)!, payload,
    estado: row.estado, intentos: contadorSeguro(row.intentos), ultimoIntentoEn: fechaIso(row.ultimo_intento_en),
    recibidaEn: fechaIso(row.recibida_en), applied: row.applied, codigoError: row.codigo_error,
    leaseId: row.lease_id, leaseHasta: fechaIso(row.lease_hasta),
  };
}

function noEncontrada() { return new SociosError(404, 'CAR_CRUDS_FOTOGRAFIA_NO_ENCONTRADA', 'No se encontró la fotografía solicitada.'); }
function desactualizada() { return new SociosError(409, 'CAR_CRUDS_FOTOGRAFIA_DESACTUALIZADA', 'La fotografía cambió; revisá la última versión antes de continuar.'); }
function vinculoDesactualizado() { return new SociosError(409, 'VINCULO_DESACTUALIZADO', 'El vínculo cambió; revisá su versión y el socio actual antes de continuar.'); }
function envioEnCurso() { return new SociosError(409, 'CAR_CRUDS_ENVIO_EN_CURSO', 'Otra instancia está enviando esta fotografía.'); }
function envioPendiente() { return new SociosError(409, 'CAR_CRUDS_ENVIO_PENDIENTE', 'El resultado anterior es incierto; reintentá la misma fotografía antes de preparar otra.'); }
function revisionRequerida() { return new SociosError(409, 'CAR_CRUDS_REVISION_REQUERIDA', 'Se requiere revisar y confirmar explícitamente la fotografía o el cambio de vínculo.'); }
