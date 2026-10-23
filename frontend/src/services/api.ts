import type { AuthResponse, AuthUser, UserMembresia } from '../types/auth';

const API_BASE = ''; // Las peticiones pasan por el gateway del mismo origen.
let sessionToken: string | null = null;
let onUnauthorized: (() => void) | undefined;

// La sesión vive únicamente en memoria; no se recupera desde localStorage.
export function setApiSession(token: string | null, unauthorized?: () => void) {
  sessionToken = token;
  onUnauthorized = unauthorized;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly codigo?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}, privateRequest = true): Promise<T> {
  const tokenUsed = sessionToken;
  if (privateRequest && !tokenUsed) {
    throw new ApiError('Iniciá sesión para realizar esta operación.', 401, 'SESION_REQUERIDA');
  }
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (privateRequest && tokenUsed) headers.set('Authorization', 'Bearer ' + tokenUsed);
  let response: Response;
  try {
    response = await fetch(API_BASE + path, { ...options, headers });
  } catch {
    throw new ApiError('No se pudo conectar con el servidor. Verificá la conexión y volvé a intentar.', 0, 'ERROR_RED');
  }
  let data: unknown;
  try { data = await response.json(); } catch { data = undefined; }
  if (!response.ok) {
    if (privateRequest && response.status === 401 && sessionToken === tokenUsed) {
      const callback = onUnauthorized;
      setApiSession(null);
      callback?.();
    }
    const error = data as { mensaje?: string; codigo?: string } | undefined;
    throw new ApiError(error?.mensaje || (response.status === 401
      ? 'La sesión venció o no es válida. Iniciá sesión nuevamente.'
      : 'El servidor no pudo completar la operación (' + response.status + ').'), response.status, error?.codigo);
  }
  if (!data || typeof data !== 'object') {
    throw new ApiError('El servidor devolvió una respuesta no válida.', response.status, 'RESPUESTA_INVALIDA');
  }
  return data as T;
}

export async function apiLogin(emailOrDni: string, password: string): Promise<AuthResponse> {
  const data = await request<AuthResponse>('/api/v1/auth/login', {
    method: 'POST', body: JSON.stringify({ emailOrDni, password }),
  }, false);
  if (!data.token || !data.socio?.socioId || !['ADMIN', 'SOCIO'].includes(data.socio.rol)) {
    throw new ApiError('La respuesta de inicio de sesión no es válida.', 502, 'RESPUESTA_INVALIDA');
  }
  return { ...data, socio: { ...data.socio, membresia: data.membresia ?? null } };
}

// Alta administrativa: no crea membresía ni cambia la sesión del administrador.
export async function apiRegistro(payload: {
  dni: string; nombre: string; email: string; password: string; telefono?: string;
}): Promise<{ socio: AuthUser; membresia: null }> {
  const data = await request<{ socio: AuthUser; membresia: null }>('/api/v1/auth/registro', { method: 'POST', body: JSON.stringify(payload) });
  if (!data.socio?.socioId || data.socio.rol !== 'SOCIO' || data.membresia !== null) {
    throw new ApiError('El servidor no confirmó el alta del socio sin membresía.', 502, 'RESPUESTA_INVALIDA');
  }
  return data;
}

export function apiObtenerSocio(socioId: string): Promise<AuthUser & { membresia: UserMembresia | null }> {
  return request('/api/v1/socios/' + encodeURIComponent(socioId));
}

// La estructura solo informa indisponibilidad hasta acordar el contrato real.
// No interpretar una respuesta desconocida como un catálogo vacío o stock cero.
export async function apiConsultarTienda(): Promise<never> {
  await request('/api/v1/tienda/productos');
  throw new ApiError('No se pudo interpretar la respuesta de la tienda.', 502, 'RESPUESTA_INVALIDA');
}

export interface BackendClaseDTO {
  claseId: string; nombre: string; sedeId: string; inicio: string;
  capacidad: number; cuposDisponibles: number; consultadoEn: string;
}
export interface BackendReserva {
  reservaId: string; claseId: string; socioId: string;
  estado: 'CONFIRMADA' | 'CANCELADA'; createdAt: string;
}
export interface BackendEspera {
  esperaId: string; claseId: string; socioId: string; orden: number;
  estado: 'PENDIENTE' | 'PROMOVIDO' | 'CANCELADO'; createdAt: string;
}
export interface ClasesYReservas {
  items: BackendClaseDTO[]; reservasSocio: BackendReserva[]; esperaSocio: BackendEspera[];
}

export async function apiObtenerClasesYReservas(socioId: string): Promise<ClasesYReservas> {
  const data = await request<ClasesYReservas>('/api/v1/reservas/clases?socioId=' + encodeURIComponent(socioId));
  if (![data.items, data.reservasSocio, data.esperaSocio].every(Array.isArray)) {
    throw new ApiError('El servidor devolvió un listado no válido.', 502, 'RESPUESTA_INVALIDA');
  }
  return data;
}

export async function apiReservarClase(claseId: string, socioId: string, ingresarEsperaSiLlena = false): Promise<{ reservaId: string; estado: string }> {
  const data = await request<{ reservaId: string; estado: string }>('/api/v1/reservas', {
    method: 'POST', body: JSON.stringify({ claseId, socioId, ingresarEsperaSiLlena }),
  });
  if (!data.reservaId || data.estado !== 'CONFIRMADA') {
    throw new ApiError('El servidor no confirmó la reserva. Actualizá el listado antes de volver a intentar.', 502, 'RESPUESTA_INVALIDA');
  }
  return data;
}

export async function apiUnirseEspera(claseId: string, socioId: string): Promise<{ esperaId: string; orden: number; estado: string }> {
  const data = await request<{ esperaId: string; orden: number; estado: string }>('/api/v1/clases/' + encodeURIComponent(claseId) + '/espera', {
    method: 'POST', body: JSON.stringify({ socioId }),
  });
  if (!data.esperaId || data.estado !== 'PENDIENTE') {
    throw new ApiError('El servidor no confirmó la inscripción a la espera. Actualizá el listado.', 502, 'RESPUESTA_INVALIDA');
  }
  return data;
}

export function apiCancelarReserva(reservaId: string): Promise<{
  exito: boolean; promocion?: unknown; reasignacionPendiente?: boolean;
}> {
  return request('/api/v1/reservas/' + encodeURIComponent(reservaId) + '/cancelar', { method: 'POST' });
}

export interface CarCrudsEmpleado { employeeId: string; displayName: string }
export interface CarCrudsEstado { employeeId: string; active: boolean }
export interface CarCrudsVinculo {
  employeeId: string; socioId: string | null; version: number; actualizadoEn: string | null;
}
export interface CarCrudsHistorial {
  historialId: string; employeeId: string; version: number; socioAnteriorId: string | null;
  socioNuevoId: string | null; administradorId: string; createdAt: string;
}
export interface CarCrudsPagina<T> { items: T[]; page: number; pageSize: number; total: number }
export type SocioPublico = Omit<AuthUser, 'membresia'>;

const CAR_CRUDS = '/api/v1/integraciones/car-cruds';
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isNullableId = (value: unknown): value is string | null => value === null || isText(value);
const isDate = (value: unknown): value is string => isText(value) && Number.isFinite(Date.parse(value));
const isNatural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function invalidCarCruds(): never {
  throw new ApiError('El servidor devolvió información de Car Cruds no válida. Volvé a consultar antes de continuar.', 502, 'RESPUESTA_INVALIDA');
}
function vinculoCarCruds(value: unknown): CarCrudsVinculo {
  if (!isRecord(value) || !isText(value.employeeId) || !isNullableId(value.socioId) || !isNatural(value.version)
    || !(value.actualizadoEn === null || isDate(value.actualizadoEn))
    || (value.version === 0 && (value.socioId !== null || value.actualizadoEn !== null))
    || (value.version > 0 && value.actualizadoEn === null)) return invalidCarCruds();
  return { employeeId: value.employeeId, socioId: value.socioId, version: value.version, actualizadoEn: value.actualizadoEn };
}
function paginaCarCruds<T>(value: unknown, parseItem: (item: unknown) => T): CarCrudsPagina<T> {
  if (!isRecord(value) || !Array.isArray(value.items) || !isNatural(value.page) || value.page < 1
    || !isNatural(value.pageSize) || value.pageSize < 1 || !isNatural(value.total)
    || value.items.length > value.pageSize || value.items.length > value.total) return invalidCarCruds();
  return { items: value.items.map(parseItem), page: value.page, pageSize: value.pageSize, total: value.total };
}
function parseSocioPublico(value: unknown): SocioPublico {
  if (!isRecord(value) || ![value.socioId, value.dni, value.nombre, value.email].every(isText)
    || !['ADMIN', 'SOCIO'].includes(String(value.rol)) || !['ACTIVO', 'INACTIVO'].includes(String(value.estado))
    || !isDate(value.createdAt) || !(value.telefono === undefined || typeof value.telefono === 'string')) return invalidCarCruds();
  // Lista explícita de campos públicos: nunca devolver credenciales ni membresías por esta consulta.
  return {
    socioId: value.socioId as string, dni: value.dni as string, nombre: value.nombre as string, email: value.email as string,
    rol: value.rol as SocioPublico['rol'], estado: value.estado as SocioPublico['estado'], createdAt: value.createdAt,
    ...(value.telefono === undefined ? {} : { telefono: value.telefono as string }),
  };
}

export async function apiCarCrudsEmpleados(page = 1, pageSize = 20): Promise<CarCrudsPagina<CarCrudsEmpleado>> {
  return paginaCarCruds(await request<unknown>(`${CAR_CRUDS}/empleados?page=${page}&pageSize=${pageSize}`), value => {
    if (!isRecord(value) || !isText(value.employeeId) || !isText(value.displayName)) return invalidCarCruds();
    return { employeeId: value.employeeId, displayName: value.displayName };
  });
}
export async function apiCarCrudsEstado(employeeId: string): Promise<CarCrudsEstado> {
  const value = await request<unknown>(`${CAR_CRUDS}/empleados/${encodeURIComponent(employeeId)}/estado`);
  if (!isRecord(value) || value.employeeId !== employeeId || typeof value.active !== 'boolean') return invalidCarCruds();
  return { employeeId, active: value.active };
}
export async function apiCarCrudsVinculos(page = 1, pageSize = 20): Promise<CarCrudsPagina<CarCrudsVinculo>> {
  return paginaCarCruds(await request<unknown>(`${CAR_CRUDS}/vinculos?page=${page}&pageSize=${pageSize}`), vinculoCarCruds);
}
export async function apiCarCrudsVinculo(employeeId: string): Promise<CarCrudsVinculo> {
  const value = vinculoCarCruds(await request<unknown>(`${CAR_CRUDS}/empleados/${encodeURIComponent(employeeId)}/vinculo`));
  if (value.employeeId !== employeeId) return invalidCarCruds();
  return value;
}
export async function apiCarCrudsGuardarVinculo(employeeId: string, socioId: string | null, versionEsperada: number): Promise<CarCrudsVinculo> {
  const value = vinculoCarCruds(await request<unknown>(`${CAR_CRUDS}/empleados/${encodeURIComponent(employeeId)}/vinculo`, {
    method: 'PUT', body: JSON.stringify({ socioId, versionEsperada }),
  }));
  if (value.employeeId !== employeeId || value.socioId !== socioId) return invalidCarCruds();
  return value;
}
export async function apiCarCrudsHistorial(employeeId: string): Promise<{ items: CarCrudsHistorial[] }> {
  const value = await request<unknown>(`${CAR_CRUDS}/empleados/${encodeURIComponent(employeeId)}/vinculo/historial`);
  if (!isRecord(value) || !Array.isArray(value.items)) return invalidCarCruds();
  return { items: value.items.map(item => {
    if (!isRecord(item) || !isText(item.historialId) || item.employeeId !== employeeId || !isNatural(item.version) || item.version < 1
      || !isNullableId(item.socioAnteriorId) || !isNullableId(item.socioNuevoId)
      || !isText(item.administradorId) || !isDate(item.createdAt)) return invalidCarCruds();
    return {
      historialId: item.historialId, employeeId, version: item.version, socioAnteriorId: item.socioAnteriorId,
      socioNuevoId: item.socioNuevoId, administradorId: item.administradorId, createdAt: item.createdAt,
    };
  }) };
}
export async function apiCarCrudsBuscarSocios(identificador: string): Promise<{ items: SocioPublico[] }> {
  const value = await request<unknown>(`${CAR_CRUDS}/socios/buscar`, {
    method: 'POST', body: JSON.stringify({ identificador: identificador.trim() }),
  });
  if (!isRecord(value) || !Array.isArray(value.items)) return invalidCarCruds();
  return { items: value.items.map(parseSocioPublico) };
}

export interface CarCrudsFotografiaPayload {
  employeeId: string; period: string; sourceReference: string; version: number; observedAt: string;
  member: boolean | null; used: boolean | null; costMinor: number | null; spendingMinor: number | null; currency?: 'ARS';
}
export interface CarCrudsFotografia {
  fotografiaId: string; socioId: string; versionVinculo: number; administradorId: string; creadaEn: string;
  payload: CarCrudsFotografiaPayload;
  estado: 'PREPARADA' | 'ENVIANDO' | 'PENDIENTE' | 'RECIBIDA' | 'REQUIERE_REVISION';
  intentos: number; ultimoIntentoEn: string | null; recibidaEn: string | null; applied: boolean | null;
  codigoError: string | null; leaseId: string | null; leaseHasta: string | null;
}
export interface CarCrudsPrepararFotografia {
  period: string; versionVinculoEsperada: number; versionAnteriorEsperada: number; confirmarCambioVinculo?: boolean;
}
export interface CarCrudsEnviarFotografia { versionVinculoEsperada: number; confirmarRevision?: boolean }

const isNullableDate = (value: unknown): value is string | null => value === null || isDate(value);
const isNullableBoolean = (value: unknown): value is boolean | null => value === null || typeof value === 'boolean';
const isNullableNatural = (value: unknown): value is number | null => value === null || isNatural(value);
function fotografiaCarCruds(value: unknown): CarCrudsFotografia {
  if (!isRecord(value) || !isRecord(value.payload)) return invalidCarCruds();
  const payload = value.payload;
  if (!isText(value.fotografiaId) || !isText(value.socioId) || !isNatural(value.versionVinculo) || value.versionVinculo < 1
    || !isText(value.administradorId) || !isDate(value.creadaEn)
    || !['PREPARADA', 'ENVIANDO', 'PENDIENTE', 'RECIBIDA', 'REQUIERE_REVISION'].includes(String(value.estado))
    || !isNatural(value.intentos) || !isNullableDate(value.ultimoIntentoEn) || !isNullableDate(value.recibidaEn)
    || !isNullableBoolean(value.applied) || !isNullableId(value.codigoError) || !isNullableId(value.leaseId) || !isNullableDate(value.leaseHasta)
    || !isText(payload.employeeId) || typeof payload.period !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.period)
    || !isText(payload.sourceReference) || !isNatural(payload.version) || payload.version < 1 || !isDate(payload.observedAt)
    || !isNullableBoolean(payload.member) || !isNullableBoolean(payload.used)
    || !isNullableNatural(payload.costMinor) || !isNullableNatural(payload.spendingMinor)
    || !(payload.currency === undefined || payload.currency === 'ARS')
    || ((payload.costMinor !== null || payload.spendingMinor !== null) && payload.currency !== 'ARS')) return invalidCarCruds();
  return {
    fotografiaId: value.fotografiaId, socioId: value.socioId, versionVinculo: value.versionVinculo,
    administradorId: value.administradorId, creadaEn: value.creadaEn, estado: value.estado as CarCrudsFotografia['estado'],
    intentos: value.intentos, ultimoIntentoEn: value.ultimoIntentoEn, recibidaEn: value.recibidaEn, applied: value.applied,
    codigoError: value.codigoError, leaseId: value.leaseId, leaseHasta: value.leaseHasta,
    payload: {
      employeeId: payload.employeeId, period: payload.period, sourceReference: payload.sourceReference,
      version: payload.version, observedAt: payload.observedAt, member: payload.member, used: payload.used,
      costMinor: payload.costMinor, spendingMinor: payload.spendingMinor,
      ...(payload.currency === undefined ? {} : { currency: payload.currency }),
    },
  };
}
export async function apiCarCrudsFotografias(employeeId: string, period: string): Promise<{ items: CarCrudsFotografia[] }> {
  const value = await request<unknown>(`${CAR_CRUDS}/empleados/${encodeURIComponent(employeeId)}/fotografias?period=${encodeURIComponent(period)}`);
  if (!isRecord(value) || !Array.isArray(value.items)) return invalidCarCruds();
  const items = value.items.map(fotografiaCarCruds);
  if (items.some(item => item.payload.employeeId !== employeeId || item.payload.period !== period)
    || new Set(items.map(item => item.fotografiaId)).size !== items.length
    || new Set(items.map(item => item.payload.version)).size !== items.length
    || new Set(items.map(item => item.payload.sourceReference)).size > 1) return invalidCarCruds();
  return { items };
}
export async function apiCarCrudsPrepararFotografia(employeeId: string, options: CarCrudsPrepararFotografia): Promise<CarCrudsFotografia> {
  const value = fotografiaCarCruds(await request<unknown>(`${CAR_CRUDS}/empleados/${encodeURIComponent(employeeId)}/fotografias`, {
    method: 'POST', body: JSON.stringify({
      period: options.period, versionVinculoEsperada: options.versionVinculoEsperada,
      versionAnteriorEsperada: options.versionAnteriorEsperada,
      ...(options.confirmarCambioVinculo === undefined ? {} : { confirmarCambioVinculo: options.confirmarCambioVinculo }),
    }),
  }));
  if (value.payload.employeeId !== employeeId || value.payload.period !== options.period
    || value.versionVinculo !== options.versionVinculoEsperada || value.payload.version !== options.versionAnteriorEsperada + 1
    || value.estado !== 'PREPARADA') return invalidCarCruds();
  return value;
}
export async function apiCarCrudsEnviarFotografia(fotografiaId: string, options: CarCrudsEnviarFotografia): Promise<CarCrudsFotografia> {
  const value = fotografiaCarCruds(await request<unknown>(`${CAR_CRUDS}/fotografias/${encodeURIComponent(fotografiaId)}/enviar`, {
    method: 'POST', body: JSON.stringify({
      versionVinculoEsperada: options.versionVinculoEsperada,
      ...(options.confirmarRevision === undefined ? {} : { confirmarRevision: options.confirmarRevision }),
    }),
  }));
  if (value.fotografiaId !== fotografiaId) return invalidCarCruds();
  return value;
}
