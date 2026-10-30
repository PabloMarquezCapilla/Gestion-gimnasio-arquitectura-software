export class AccesosError extends Error {
  constructor(readonly statusCode: number, readonly codigo: string, mensaje: string) { super(mensaje); }
}

export interface Sede { sedeId: string; nombre: string }
export interface Orden { sedeId: string; socioId: string; tipo: 'INGRESO' | 'EGRESO' }
export interface Operacion extends Orden { clave: string; actorId: string }
export interface Movimiento extends Orden {
  movimientoId: string; actorId: string; fecha: string; aceptado: boolean; codigo: string;
}
export interface Resultado { movimiento: Movimiento }
export interface Evaluacion { habilitado: boolean; motivo?: string }
export interface Contexto { traceId: string; spanId: string; traceFlags: string }
export interface SociosClient {
  verificar(socioId: string, fecha: string, contexto?: Contexto): Promise<Evaluacion>;
}
export interface AccesosRepository {
  salud(): Promise<void>;
  sedes(): Promise<Sede[]>;
  existeSede(sedeId: string): Promise<boolean>;
  repeticion(operacion: Operacion): Promise<Resultado | null>;
  registrar(operacion: Operacion, evaluacion: Evaluacion | null, fecha: string): Promise<Resultado>;
  ocupacion(sedeId: string): Promise<number>;
  historial(sedeId: string, socioId: string | undefined, pagina: number, tamanio: number): Promise<Movimiento[]>;
}

export function decidir(tipo: Orden['tipo'], abierta: boolean, evaluacion: Evaluacion | null): string {
  if (tipo === 'EGRESO') return abierta ? 'EGRESO_REGISTRADO' : 'SIN_INGRESO_ABIERTO';
  if (!evaluacion) throw new AccesosError(503, 'SOCIOS_NO_DISPONIBLE', 'No se pudo verificar la membresía. No se registró el ingreso.');
  if (!evaluacion.habilitado) return 'MEMBRESIA_NO_HABILITADA';
  return abierta ? 'INGRESO_YA_ABIERTO' : 'INGRESO_REGISTRADO';
}

export function identificador(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value);
}

export function orden(value: unknown): Orden {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw parametros();
  const b = value as Record<string, unknown>;
  if (Object.keys(b).some(k => !['sedeId', 'socioId', 'tipo'].includes(k))
    || !identificador(b.sedeId) || !identificador(b.socioId) || typeof b.tipo !== 'string' || !['INGRESO', 'EGRESO'].includes(b.tipo)) throw parametros();
  return { sedeId: b.sedeId, socioId: b.socioId, tipo: b.tipo as Orden['tipo'] };
}
export function parametros() { return new AccesosError(400, 'PARAMETROS_INVALIDOS', 'Revisá los identificadores y parámetros de la solicitud.'); }

export class AccesosService {
  constructor(private readonly repo: AccesosRepository, private readonly socios: SociosClient, private readonly clock = () => new Date()) {}
  async registrar(op: Operacion, contexto?: Contexto): Promise<Resultado> {
    const replay = await this.repo.repeticion(op);
    if (replay) return replay;
    await this.exigirSede(op.sedeId);
    const fecha = this.clock().toISOString();
    // La red nunca se consulta bajo la transacción MongoDB. Un fallo no es una inhabilitación.
    const evaluacion = op.tipo === 'INGRESO' ? await this.socios.verificar(op.socioId, fecha, contexto) : null;
    return this.repo.registrar(op, evaluacion, fecha);
  }
  async exigirSede(sedeId: string) {
    if (!await this.repo.existeSede(sedeId)) throw new AccesosError(404, 'SEDE_NO_ENCONTRADA', 'La sede no está configurada.');
  }
}
