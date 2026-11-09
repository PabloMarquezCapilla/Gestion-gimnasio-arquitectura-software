import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { ContextoSolicitud } from '../ports';

export class GestionClasesError extends Error {
  constructor(readonly statusCode: number, readonly codigo: string, mensaje: string) {
    super(mensaje);
  }
}
export interface DatosClase {
  nombre: string; actividad: string; profesor: string; sedeId: string;
  inicio: string; fin: string; capacidad: number;
}
export interface ClaseAdministrada extends Omit<DatosClase, 'actividad' | 'profesor'> {
  claseId: string; actividad: string | null; profesor: string | null;
  publicada: boolean; version: number;
}
export interface ComandoClase {
  actorId: string; clave: string; claseId: string | null;
  datos: DatosClase; versionEsperada: number | null;
}
export interface GestionClasesRepository {
  obtener(claseId: string): Promise<ClaseAdministrada | null>;
  recuperar(comando: ComandoClase): Promise<ClaseAdministrada | null>;
  guardar(comando: ComandoClase, ahora: () => string): Promise<ClaseAdministrada>;
}
export interface SedesClient {
  listar(authorization: string, contexto?: ContextoSolicitud): Promise<{ sedeId: string; nombre: string }[]>;
}

const ajv = new Ajv({ strict: false });
addFormats(ajv, { mode: 'full' });
const properties = {
  nombre: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
  actividad: { type: 'string', minLength: 1, maxLength: 50, pattern: '\\S' },
  profesor: { type: 'string', minLength: 1, maxLength: 100, pattern: '\\S' },
  sedeId: { type: 'string', minLength: 1, maxLength: 50, pattern: '\\S' },
  inicio: { type: 'string', format: 'date-time', maxLength: 64 },
  fin: { type: 'string', format: 'date-time', maxLength: 64 },
  capacidad: { type: 'integer', minimum: 1, maximum: 2147483647 },
};
const validators = [false, true].map(editar => ajv.compile<DatosClase & { versionEsperada?: number }>({
  type: 'object', additionalProperties: false,
  properties: { ...properties, ...(editar ? { versionEsperada: { type: 'integer', minimum: 1, maximum: 2147483647 } } : {}) },
  required: [...Object.keys(properties), ...(editar ? ['versionEsperada'] : [])],
}));
export function datosClase(body: unknown, editar: boolean): { datos: DatosClase; versionEsperada: number | null } {
  if (!validators[Number(editar)](body)) {
    throw new GestionClasesError(400, 'PARAMETROS_INVALIDOS', 'Completá nombre, actividad, profesor, sede, fechas con zona y capacidad entera positiva dentro de los límites del contrato.');
  }
  const value = body as DatosClase & { versionEsperada?: number };
  const datos = { nombre: value.nombre.trim(), actividad: value.actividad.trim(), profesor: value.profesor.trim(),
    sedeId: value.sedeId, inicio: new Date(value.inicio).toISOString(), fin: new Date(value.fin).toISOString(), capacidad: value.capacidad };
  if (Date.parse(datos.fin) <= Date.parse(datos.inicio)) {
    throw new GestionClasesError(400, 'FECHAS_INVALIDAS', 'El fin debe ser posterior al inicio.');
  }
  return { datos, versionEsperada: editar ? value.versionEsperada! : null };
}
export function exigirInicioFuturo(inicio: string, ahora: string) {
  if (Date.parse(inicio) <= Date.parse(ahora)) {
    throw new GestionClasesError(409, 'CLASE_INICIADA', 'La clase debe comenzar en el futuro.');
  }
}
export function claseIdValido(value: string) {
  if (!value.trim() || Array.from(value).length > 50) throw new GestionClasesError(400, 'PARAMETROS_INVALIDOS', 'Identificador de clase inválido.');
}

export class GestionClasesService {
  constructor(private repository: GestionClasesRepository | undefined, private sedes: SedesClient | undefined,
    private clock: () => Date = () => new Date()) {}

  private repositorio() {
    if (!this.repository) throw new GestionClasesError(503, 'GESTION_CLASES_NO_DISPONIBLE', 'La administración de clases requiere su almacenamiento disponible.');
    return this.repository;
  }
  async obtener(claseId: string) {
    claseIdValido(claseId);
    const clase = await this.repositorio().obtener(claseId);
    if (!clase) throw new GestionClasesError(404, 'CLASE_NO_ENCONTRADA', 'No se encontró la clase solicitada.');
    return clase;
  }
  async guardar(actorId: string, clave: unknown, claseId: string | null, body: unknown,
    authorization: string, contexto?: ContextoSolicitud) {
    if (typeof clave !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(clave)) {
      throw new GestionClasesError(400, 'IDEMPOTENCIA_INVALIDA', 'Idempotency-Key debe tener entre 8 y 128 letras, números, guiones o guiones bajos.');
    }
    if (claseId !== null) claseIdValido(claseId);
    const comando = { actorId, clave, claseId, ...datosClase(body, claseId !== null) };
    const repo = this.repositorio();
    // Recuperar primero permite repetir una operación confirmada aunque haya
    // comenzado la clase o Accesos esté temporalmente caído.
    const anterior = await repo.recuperar(comando);
    if (anterior) return anterior;
    exigirInicioFuturo(comando.datos.inicio, this.clock().toISOString());
    if (!this.sedes) throw new GestionClasesError(503, 'SEDES_NO_DISPONIBLES', 'No se pudo comprobar la sede con Accesos.');
    const sedes = await this.sedes.listar(authorization, contexto);
    if (!sedes.some(sede => sede.sedeId === comando.datos.sedeId)) {
      throw new GestionClasesError(422, 'SEDE_NO_ENCONTRADA', 'Seleccioná una sede existente de Accesos.');
    }
    return repo.guardar(comando, () => this.clock().toISOString());
  }
}
