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
