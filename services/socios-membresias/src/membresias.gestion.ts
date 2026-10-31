import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SociosError } from './errors';

export type ComandoGestion = 'crearPlan' | 'estadoPlan' | 'solicitar' | 'registrarPago' | 'confirmarPago' | 'rechazarSolicitud';
export interface PlanGestion { planId: string; nombre: string; importeMinor: number; moneda: string; estado: 'ACTIVO' | 'INACTIVO' }
export interface SolicitudGestion {
  solicitudId: string; socioId: string; planId: string; nombrePlan: string; importeMinor: number; moneda: string;
  fechaInicio: string; fechaFin: string; estado: 'PENDIENTE' | 'CONFIRMADA' | 'RECHAZADA'; createdAt: string;
  pago?: { pagoId: string; referencia: string; estado: 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO' };
  comprobante?: { comprobanteId: string; pagoId: string; membresiaId: string; confirmadoPor: string; confirmadoEn: string };
}
export interface GestionRepository {
  ejecutar(actor: string, clave: string, comando: ComandoGestion, datos: Record<string, unknown>, alRepetir?: () => void): Promise<unknown>;
  planes(): Promise<PlanGestion[]>;
  socios(pagina: number, tamanio: number): Promise<unknown[]>;
  solicitudes(socioId: string | undefined, pagina: number, tamanio: number): Promise<SolicitudGestion[]>;
  solicitud(id: string): Promise<SolicitudGestion>;
}
export const falloGestion = (codigo: string, mensaje: string, status = 409) => new SociosError(status, codigo, mensaje);
const monedas = new Set<string>(Intl.supportedValuesOf('currency'));
const ajv = new Ajv(); addFormats(ajv, { mode: 'full' });
const id = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$' };
const importe = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const moneda = { type: 'string', pattern: '^[A-Z]{3}$' };
const fecha = { type: 'string', format: 'date-time' };
function esquema(properties: Record<string, unknown>) { return ajv.compile({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) }); }
const validadores = {
  crearPlan: esquema({ nombre: { type: 'string', minLength: 1, maxLength: 50 }, importeMinor: importe, moneda }),
  estadoPlan: esquema({ estado: { enum: ['ACTIVO', 'INACTIVO'] } }),
  solicitar: esquema({ planId: id, fechaInicio: fecha, fechaFin: fecha }),
  registrarPago: esquema({ referencia: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_-]{7,99}$' }, importeMinor: importe, moneda }),
  confirmarPago: esquema({}), rechazarSolicitud: esquema({}),
};
export function datosGestion(comando: ComandoGestion, body: unknown): Record<string, unknown> {
  if (!validadores[comando](body)) throw falloGestion('DATOS_INVALIDOS', 'Datos incompletos o no válidos; no se admiten campos adicionales.', 400);
  const b = body as Record<string, unknown>;
  if ('moneda' in b && !monedas.has(b.moneda as string)) throw falloGestion('MONEDA_INVALIDA', 'La moneda debe estar reconocida por el registro ISO disponible en el runtime.', 400);
  if (comando === 'crearPlan' && !(b.nombre as string).trim()) throw falloGestion('DATOS_INVALIDOS', 'El nombre del plan es obligatorio.', 400);
  if (comando === 'solicitar' && Date.parse(b.fechaInicio as string) > Date.parse(b.fechaFin as string)) throw falloGestion('VIGENCIA_INVALIDA', 'El inicio no puede superar el final de la vigencia.', 400);
  return Object.fromEntries(Object.keys(b).sort().map(k => [k, k.startsWith('fecha') ? new Date(b[k] as string).toISOString() : k === 'nombre' ? (b[k] as string).trim() : b[k]]));
}
export function identificadorGestion(value: string) { if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(value)) throw falloGestion('DATOS_INVALIDOS', 'Identificador inválido.', 400); return value; }
export function claveGestion(value: unknown) { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw falloGestion('IDEMPOTENCIA_REQUERIDA', 'Se requiere una clave de idempotencia válida de 8 a 128 caracteres.', 400); return value; }
export function paginaGestion(query: unknown) {
  const q = query as Record<string, unknown>;
  if (Object.keys(q).some(k => !['pagina', 'tamanio'].includes(k))) throw falloGestion('DATOS_INVALIDOS', 'Parámetros de consulta no admitidos.', 400);
  const pagina = Number(q.pagina ?? 1), tamanio = Number(q.tamanio ?? 20);
  if (!Number.isSafeInteger(pagina) || pagina < 1 || pagina > 1000000 || !Number.isSafeInteger(tamanio) || tamanio < 1 || tamanio > 100) throw falloGestion('DATOS_INVALIDOS', 'Paginación inválida.', 400);
  return { pagina, tamanio };
}
