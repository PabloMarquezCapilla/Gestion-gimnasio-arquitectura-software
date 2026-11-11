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

export interface AccesosMovimiento {
  movimientoId: string; sedeId: string; socioId: string; actorId: string;
  tipo: 'INGRESO' | 'EGRESO'; fecha: string; aceptado: boolean; codigo: string;
}
export interface AccesosOrden { sedeId: string; socioId: string; tipo: 'INGRESO' | 'EGRESO' }
export async function apiAccesosSedes(): Promise<{ items: { sedeId: string; nombre: string }[] }> {
  const data = await request<unknown>('/api/v1/accesos/sedes', {}, true, 200);
  if (!isRecord(data) || !Array.isArray(data.items) || data.items.some(sede => !isRecord(sede)
    || !isText(sede.sedeId) || !isText(sede.nombre))
    || new Set(data.items.map(sede => sede.sedeId)).size !== data.items.length) {
    throw new ApiError('El servidor devolvió sedes no válidas. Volvé a consultar.', 502, 'RESPUESTA_INVALIDA');
  }
  return { items: data.items.map(sede => ({ sedeId: sede.sedeId as string, nombre: sede.nombre as string })) };
}
export const apiAccesosOcupacion = (sedeId: string) => request<{ sedeId: string; ocupacion: number; consultadoEn: string }>(
  '/api/v1/accesos/sedes/' + encodeURIComponent(sedeId) + '/ocupacion');
export const apiAccesosHistorial = (sedeId: string, pagina = 1, socioId = '') => request<{ items: AccesosMovimiento[]; pagina: number; tamanio: number }>(
  '/api/v1/accesos/movimientos?' + new URLSearchParams({ sedeId, pagina: String(pagina), tamanio: '20', ...(socioId ? { socioId } : {}) }));
export async function apiAccesosRegistrar(body: AccesosOrden, clave: string) {
  const result = await request<{ movimiento: AccesosMovimiento }>('/api/v1/accesos/movimientos', {
    method: 'POST', headers: { 'Idempotency-Key': clave }, body: JSON.stringify(body),
  });
  if (!result.movimiento?.aceptado || !result.movimiento.movimientoId || result.movimiento.sedeId !== body.sedeId
    || result.movimiento.socioId !== body.socioId || result.movimiento.tipo !== body.tipo) {
    throw new ApiError('Respuesta no válida. Conservá la operación para reintentar.', 502, 'RESPUESTA_INVALIDA');
  }
  return result;
}

async function request<T>(path: string, options: RequestInit = {}, privateRequest = true, expectedStatus?: number): Promise<T> {
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
    const error = data as { mensaje?: string; codigo?: string; movimiento?: { codigo?: string } } | undefined;
    const accesosMessages: Record<string, string> = {
      INGRESO_YA_ABIERTO: 'El socio ya tiene un ingreso abierto en esta sede.',
      SIN_INGRESO_ABIERTO: 'No hay un ingreso abierto para registrar la salida.',
      MEMBRESIA_NO_HABILITADA: 'La membresía no habilita el ingreso.',
    };
    if (path.startsWith('/api/v1/accesos/') && error?.movimiento?.codigo) {
      throw new ApiError(accesosMessages[error.movimiento.codigo] ?? 'Movimiento rechazado.', response.status, error.movimiento.codigo);
    }
    throw new ApiError(error?.mensaje || (response.status === 401
      ? 'La sesión venció o no es válida. Iniciá sesión nuevamente.'
      : 'El servidor no pudo completar la operación (' + response.status + ').'), response.status, error?.codigo);
  }
  if (expectedStatus !== undefined && (response.status !== expectedStatus || response.redirected
    || response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json')) {
    throw new ApiError('El servidor no confirmó la respuesta esperada. Conservá la operación para revisarla o reintentar.', 502, 'RESPUESTA_INVALIDA');
  }
  if (!data || typeof data !== 'object') {
    throw new ApiError('El servidor devolvió una respuesta no válida.', expectedStatus === undefined ? response.status : 502, 'RESPUESTA_INVALIDA');
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

export interface VarianteTienda {
  productoCodigo: string; talle: string; color: string; precioMinor: number; unidadesDisponibles: number;
}
export interface ProductoTienda {
  productoId: string; nombre: string; categoria: string; descripcion?: string; fotoUrl?: string; variantes: VarianteTienda[];
}
export interface CatalogoTienda {
  origen: 'FAV' | 'CACHE_DEGRADADA'; actualizadoEn: string; pagina: number; tamanio: number; total: number; items: ProductoTienda[];
}
export interface ItemCompraTienda {
  productoCodigo: string; nombre: string; talle: string; color: string; unidades: number; precioUnitarioMinor: number; subtotalMinor: number;
}
export interface CompraTienda {
  compraId: string; estado: 'REGISTRADA'; items: ItemCompraTienda[]; totalMinor: number; currency: 'ARS'; creadaEn: string;
}
export interface CompraPendienteTienda { clave: string; items: VentaOrdenTienda[] }

// Contrato openapi-tienda-socios-v1: una respuesta desconocida nunca se muestra como catálogo vacío.
function invalidCatalogoTienda(): never {
  throw new ApiError('El servidor devolvió un catálogo no válido. Volvé a consultar.', 502, 'RESPUESTA_INVALIDA');
}
const opcionalTexto = (value: unknown) => value === undefined || isText(value);
export async function apiCatalogoTienda(filtros: { categoria?: string; talle?: string; pagina?: number } = {}): Promise<CatalogoTienda> {
  const query = new URLSearchParams();
  if (filtros.categoria) query.set('categoria', filtros.categoria);
  if (filtros.talle) query.set('talle', filtros.talle);
  if (filtros.pagina && filtros.pagina > 1) query.set('pagina', String(filtros.pagina));
  const value = await request<unknown>('/api/v1/tienda/productos' + (query.toString() ? '?' + query : ''), {}, true, 200);
  if (!isRecord(value) || !exactKeys(value, ['origen', 'actualizadoEn', 'pagina', 'tamanio', 'total', 'items'])
    || !['FAV', 'CACHE_DEGRADADA'].includes(value.origen as string) || !isText(value.actualizadoEn)
    || !isNatural(value.pagina) || !isNatural(value.tamanio) || !isNatural(value.total) || !Array.isArray(value.items)) return invalidCatalogoTienda();
  const items = value.items.map((producto: unknown) => {
    if (!isRecord(producto) || !isText(producto.productoId) || !isText(producto.nombre) || !isText(producto.categoria)
      || !opcionalTexto(producto.descripcion) || !opcionalTexto(producto.fotoUrl) || !Array.isArray(producto.variantes)
      || Object.keys(producto).some(key => !['productoId', 'nombre', 'categoria', 'descripcion', 'fotoUrl', 'variantes'].includes(key))) {
      return invalidCatalogoTienda();
    }
    const variantes = producto.variantes.map((variante: unknown) => {
      if (!isRecord(variante) || !exactKeys(variante, ['productoCodigo', 'talle', 'color', 'precioMinor', 'unidadesDisponibles'])
        || !isText(variante.productoCodigo) || !isText(variante.talle) || !isText(variante.color)
        || !isNatural(variante.precioMinor) || !isNatural(variante.unidadesDisponibles) || variante.unidadesDisponibles < 1) {
        return invalidCatalogoTienda();
      }
      return variante as unknown as VarianteTienda;
    });
    return { ...(producto as unknown as ProductoTienda), variantes };
  });
  return { ...(value as unknown as CatalogoTienda), items };
}

function validarCompraTienda(value: unknown): CompraTienda {
  const invalida = () => new ApiError('El servidor no confirmó la compra. Conservá el carrito para reintentar la misma operación.', 502, 'RESPUESTA_INVALIDA');
  if (!isRecord(value) || !exactKeys(value, ['compraId', 'estado', 'items', 'totalMinor', 'currency', 'creadaEn'])
    || !isText(value.compraId) || value.estado !== 'REGISTRADA' || value.currency !== 'ARS' || !isText(value.creadaEn)
    || !isNatural(value.totalMinor) || !Array.isArray(value.items) || !value.items.length) throw invalida();
  for (const item of value.items as unknown[]) {
    if (!isRecord(item) || !exactKeys(item, ['productoCodigo', 'nombre', 'talle', 'color', 'unidades', 'precioUnitarioMinor', 'subtotalMinor'])
      || !isText(item.productoCodigo) || !isNatural(item.unidades) || !isNatural(item.precioUnitarioMinor) || !isNatural(item.subtotalMinor)) throw invalida();
  }
  return value as unknown as CompraTienda;
}
export async function apiComprarTienda(op: CompraPendienteTienda): Promise<CompraTienda> {
  if (!isText(op.clave) || /[\r\n]/.test(op.clave) || !op.items.length) {
    throw new ApiError('El carrito está vacío.', 400, 'SOLICITUD_INVALIDA');
  }
  const value = await request<unknown>('/api/v1/tienda/compras', {
    method: 'POST', headers: { 'Idempotency-Key': op.clave },
    body: JSON.stringify({ items: op.items.map(({ productoCodigo, unidades }) => ({ productoCodigo, unidades })) }),
  }, true, 201);
  const compra = validarCompraTienda(value);
  // La respuesta debe corresponder exactamente al carrito enviado con esa clave.
  if (compra.items.length !== op.items.length || op.items.some(item =>
    !compra.items.some(c => c.productoCodigo === item.productoCodigo && c.unidades === item.unidades))) {
    throw new ApiError('El servidor no confirmó esta compra. Conservá el carrito para reintentar la misma operación.', 502, 'RESPUESTA_INVALIDA');
  }
  return compra;
}
export async function apiMisCompras(pagina = 1): Promise<{ pagina: number; tamanio: number; total: number; items: CompraTienda[] }> {
  const value = await request<unknown>('/api/v1/tienda/compras' + (pagina > 1 ? '?pagina=' + pagina : ''), {}, true, 200);
  if (!isRecord(value) || !exactKeys(value, ['pagina', 'tamanio', 'total', 'items']) || !isNatural(value.total) || !Array.isArray(value.items)) {
    throw new ApiError('El servidor devolvió compras no válidas.', 502, 'RESPUESTA_INVALIDA');
  }
  return { pagina: value.pagina as number, tamanio: value.tamanio as number, total: value.total, items: value.items.map(validarCompraTienda) };
}

export interface StockItemTienda {
  productoCodigo: string; unidadesDisponibles: number; unidadesVendidas: number;
}
export interface StockTienda { proveedorId: 'fav'; items: StockItemTienda[] }
export interface VentaOrdenTienda { productoCodigo: string; unidades: number }
export interface VentaTienda extends VentaOrdenTienda { ventaId: string; estado: 'REGISTRADA' }
export interface VentaPendienteTienda { clave: string; body: VentaOrdenTienda }

// Una respuesta de una vista anterior no puede retirar la siguiente venta.
export function retirarVentaTiendaPendiente(storage: Pick<Storage, 'getItem' | 'removeItem'>,
  storageKey: string, op: VentaPendienteTienda, esActual: () => boolean): boolean {
  if (!esActual()) return false;
  const raw = storage.getItem(storageKey);
  if (raw === null) return true;
  let actual: unknown;
  try { actual = JSON.parse(raw); } catch { return false; }
  if (!isRecord(actual) || !exactKeys(actual, ['clave', 'body']) || actual.clave !== op.clave
    || !isRecord(actual.body) || !exactKeys(actual.body, ['productoCodigo', 'unidades'])
    || actual.body.productoCodigo !== op.body.productoCodigo || actual.body.unidades !== op.body.unidades
    || !esActual()) return false;
  // Comparación y borrado son síncronos, sin ceder entre ambos.
  storage.removeItem(storageKey);
  return true;
}

const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
function invalidStockTienda(): never {
  throw new ApiError('El servidor devolvió información de stock no válida. Volvé a consultar.', 502, 'RESPUESTA_INVALIDA');
}
export async function apiConsultarStockTienda(): Promise<StockTienda> {
  const value = await request<unknown>('/api/v1/tienda/stock', {}, true, 200);
  if (!isRecord(value) || !exactKeys(value, ['proveedorId', 'items']) || value.proveedorId !== 'fav'
    || !Array.isArray(value.items)) return invalidStockTienda();
  const items = value.items.map(item => {
    if (!isRecord(item) || !exactKeys(item, ['productoCodigo', 'unidadesDisponibles', 'unidadesVendidas'])
      || !isText(item.productoCodigo) || !isNatural(item.unidadesDisponibles) || !isNatural(item.unidadesVendidas)) {
      return invalidStockTienda();
    }
    return { productoCodigo: item.productoCodigo, unidadesDisponibles: item.unidadesDisponibles, unidadesVendidas: item.unidadesVendidas };
  });
  if (new Set(items.map(item => item.productoCodigo)).size !== items.length) return invalidStockTienda();
  return { proveedorId: 'fav', items };
}
export async function apiRegistrarVentaTienda(body: VentaOrdenTienda, clave: string): Promise<VentaTienda> {
  if (!isRecord(body) || !exactKeys(body, ['productoCodigo', 'unidades']) || !isText(body.productoCodigo)
    || !isNatural(body.unidades) || body.unidades < 1 || !isText(clave) || /[\r\n]/.test(clave)) {
    throw new ApiError('Indicá una variante, unidades enteras positivas y la clave de la venta.', 400, 'SOLICITUD_INVALIDA');
  }
  const value = await request<unknown>('/api/v1/tienda/ventas', {
    method: 'POST', headers: { 'Idempotency-Key': clave },
    body: JSON.stringify({ productoCodigo: body.productoCodigo, unidades: body.unidades }),
  }, true, 201);
  if (!isRecord(value) || !exactKeys(value, ['ventaId', 'estado', 'productoCodigo', 'unidades'])
    || !isText(value.ventaId) || value.estado !== 'REGISTRADA'
    || value.productoCodigo !== body.productoCodigo || value.unidades !== body.unidades) {
    throw new ApiError('El servidor no confirmó esta venta. Conservá los datos para reintentar la misma operación.', 502, 'RESPUESTA_INVALIDA');
  }
  return { ventaId: value.ventaId, estado: 'REGISTRADA', productoCodigo: value.productoCodigo as string, unidades: value.unidades as number };
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
  clasesPersonales?: Pick<BackendClaseDTO, 'claseId' | 'nombre' | 'sedeId' | 'inicio'>[];
}

export async function apiObtenerClasesYReservas(socioId: string): Promise<ClasesYReservas> {
  const data = await request<ClasesYReservas>('/api/v1/reservas/clases?socioId=' + encodeURIComponent(socioId));
  if (![data.items, data.reservasSocio, data.esperaSocio].every(Array.isArray)) {
    throw new ApiError('El servidor devolvió un listado no válido.', 502, 'RESPUESTA_INVALIDA');
  }
  if (data.clasesPersonales !== undefined && (!Array.isArray(data.clasesPersonales)
    || data.clasesPersonales.some(clase => !isRecord(clase) || !isText(clase.claseId)
      || !isText(clase.nombre) || !isText(clase.sedeId) || !isDate(clase.inicio)))) {
    throw new ApiError('El servidor devolvió detalles de reservas no válidos.', 502, 'RESPUESTA_INVALIDA');
  }
  return data;
}

export type OrdenCatalogo = 'inicio_asc' | 'inicio_desc' | 'relevancia';
export interface FiltrosCatalogo {
  texto?: string; sedeId?: string; profesor?: string; desde?: string; hasta?: string;
  soloConCupo?: boolean; orden?: OrdenCatalogo; pagina?: number; tamanio?: number;
}
export interface ClaseCatalogo {
  claseId: string; nombre: string; actividad: string | null; profesor: string | null;
  sedeId: string; inicio: string; fin: string; capacidad: number;
  cuposDisponibles: number; reservaDirectaDisponible: boolean;
}
export interface PaginaCatalogo {
  items: ClaseCatalogo[]; pagina: number; tamanio: number; total: number; consultadoEn: string;
}
const catalogoInvalido = (): never => {
  throw new ApiError('La respuesta de búsqueda no es válida. Volvé a consultar.', 502, 'RESPUESTA_INVALIDA');
};

export async function apiBuscarClases(filtros: FiltrosCatalogo = {}, signal?: AbortSignal): Promise<PaginaCatalogo> {
  const params = new URLSearchParams();
  for (const key of ['texto', 'sedeId', 'profesor', 'desde', 'hasta'] as const) {
    const value = filtros[key];
    if (value?.trim()) params.set(key, key === 'sedeId' ? value : value.trim());
  }
  for (const key of ['soloConCupo', 'orden', 'pagina', 'tamanio'] as const) {
    if (filtros[key] !== undefined) params.set(key, String(filtros[key]));
  }
  const value = await request<unknown>('/api/v1/catalogo/clases?' + params, { signal }, true, 200);
  if (!isRecord(value) || !Array.isArray(value.items) || !isNatural(value.total)
    || value.pagina !== (filtros.pagina ?? 1) || value.tamanio !== (filtros.tamanio ?? 20)
    || !isNatural(value.pagina) || value.pagina < 1 || value.pagina > 1000000
    || !isNatural(value.tamanio) || value.tamanio < 1 || value.tamanio > 100
    || !isDate(value.consultadoEn)) return catalogoInvalido();
  const cantidad = Math.min(value.tamanio, Math.max(0, value.total - (value.pagina - 1) * value.tamanio));
  if (value.items.length !== cantidad) return catalogoInvalido();
  const items = value.items.map(clase => {
    if (!isRecord(clase) || !isText(clase.claseId) || !isText(clase.nombre) || !isText(clase.sedeId)
      || !(clase.actividad === null || typeof clase.actividad === 'string')
      || !(clase.profesor === null || typeof clase.profesor === 'string')
      || !isDate(clase.inicio) || !isDate(clase.fin) || Date.parse(clase.inicio) <= Date.parse(value.consultadoEn as string)
      || !isNatural(clase.capacidad) || !isNatural(clase.cuposDisponibles) || clase.cuposDisponibles > clase.capacidad
      || typeof clase.reservaDirectaDisponible !== 'boolean'
      || (clase.reservaDirectaDisponible && clase.cuposDisponibles === 0)) return catalogoInvalido();
    return clase as unknown as ClaseCatalogo;
  });
  if (new Set(items.map(clase => clase.claseId)).size !== items.length) return catalogoInvalido();
  return { items, pagina: value.pagina, tamanio: value.tamanio, total: value.total, consultadoEn: value.consultadoEn };
}

export interface DatosPublicacionClase {
  nombre: string; actividad: string; profesor: string; sedeId: string;
  inicio: string; fin: string; capacidad: number;
}
export interface ClaseAdministrada extends Omit<DatosPublicacionClase, 'actividad' | 'profesor'> {
  claseId: string; actividad: string | null; profesor: string | null; publicada: boolean; version: number;
}
export interface OperacionClasePendiente {
  clave: string; claseId: string | null; datos: DatosPublicacionClase & { versionEsperada?: number };
}
export function validarOperacionClase(value: unknown): OperacionClasePendiente {
  const invalida = () => { throw new ApiError('Revisá los datos de la publicación o edición de la clase.', 400, 'PARAMETROS_INVALIDOS'); };
  if (!isRecord(value) || !exactKeys(value, ['clave', 'claseId', 'datos'])
    || typeof value.clave !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value.clave)
    || !(value.claseId === null || isText(value.claseId)) || !isRecord(value.datos)) return invalida();
  const datos = value.datos;
  const campos = ['nombre', 'actividad', 'profesor', 'sedeId', 'inicio', 'fin', 'capacidad'];
  if (value.claseId !== null) campos.push('versionEsperada');
  if (!exactKeys(datos, campos) || !isDate(datos.inicio) || !isDate(datos.fin)
    || Date.parse(datos.fin) <= Date.parse(datos.inicio)
    || !isNatural(datos.capacidad) || datos.capacidad < 1 || datos.capacidad > 2147483647
    || (value.claseId !== null && (!isNatural(datos.versionEsperada) || datos.versionEsperada < 1 || datos.versionEsperada > 2147483647))) return invalida();
  for (const [campo, max] of [['nombre', 100], ['actividad', 50], ['profesor', 100], ['sedeId', 50]] as const) {
    if (!isText(datos[campo]) || Array.from(datos[campo]).length > max) return invalida();
  }
  return value as unknown as OperacionClasePendiente;
}
function claseAdministrada(value: unknown): ClaseAdministrada {
  if (!isRecord(value) || !isText(value.claseId) || !isText(value.nombre) || !isText(value.sedeId)
    || !(value.actividad === null || typeof value.actividad === 'string')
    || !(value.profesor === null || typeof value.profesor === 'string')
    || !isDate(value.inicio) || !isDate(value.fin) || !isNatural(value.capacidad)
    || value.publicada !== true || !isNatural(value.version) || value.version < 1 || value.version > 2147483647) {
    throw new ApiError('El servidor devolvió una clase no válida. Volvé a consultar.', 502, 'RESPUESTA_INVALIDA');
  }
  return value as unknown as ClaseAdministrada;
}
export async function apiObtenerClaseAdmin(claseId: string): Promise<ClaseAdministrada> {
  const value = claseAdministrada(await request<unknown>('/api/v1/admin/clases/' + encodeURIComponent(claseId), {}, true, 200));
  if (value.claseId !== claseId) throw new ApiError('El servidor devolvió otra clase. Volvé a consultar.', 502, 'RESPUESTA_INVALIDA');
  return value;
}
export async function apiGuardarClase(operacion: OperacionClasePendiente): Promise<ClaseAdministrada> {
  const op = validarOperacionClase(operacion);
  const value = claseAdministrada(await request<unknown>('/api/v1/admin/clases' + (op.claseId === null ? '' : '/' + encodeURIComponent(op.claseId)), {
    method: op.claseId === null ? 'POST' : 'PUT', headers: { 'Idempotency-Key': op.clave }, body: JSON.stringify(op.datos),
  }, true, op.claseId === null ? 201 : 200));
  const d = op.datos;
  if ((op.claseId !== null && value.claseId !== op.claseId) || value.version !== (op.claseId === null ? 1 : d.versionEsperada! + 1)
    || value.nombre !== d.nombre.trim() || value.actividad !== d.actividad.trim() || value.profesor !== d.profesor.trim()
    || value.sedeId !== d.sedeId || Date.parse(value.inicio) !== Date.parse(d.inicio)
    || Date.parse(value.fin) !== Date.parse(d.fin) || value.capacidad !== d.capacidad) {
    throw new ApiError('El servidor no confirmó los datos de esta clase. Conservá la operación para reintentar.', 502, 'RESPUESTA_INVALIDA');
  }
  return value;
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

export interface RetiroEspera {
  exito: true;
  espera: BackendEspera & { estado: 'CANCELADO'; updatedAt: string };
  reasignacionPendiente: boolean;
}
export async function apiRetirarEspera(claseId: string, esperaId: string): Promise<RetiroEspera> {
  const value = await request<unknown>('/api/v1/clases/' + encodeURIComponent(claseId) + '/espera/'
    + encodeURIComponent(esperaId) + '/retirar', { method: 'POST' }, true, 200);
  if (!isRecord(value) || value.exito !== true || typeof value.reasignacionPendiente !== 'boolean'
    || !isRecord(value.espera) || value.espera.esperaId !== esperaId || value.espera.claseId !== claseId
    || value.espera.estado !== 'CANCELADO' || !isText(value.espera.socioId)
    || !isNatural(value.espera.orden) || value.espera.orden < 1
    || !isDate(value.espera.createdAt) || !isDate(value.espera.updatedAt)
    || Date.parse(value.espera.updatedAt) < Date.parse(value.espera.createdAt)) {
    throw new ApiError('El servidor no confirmó el retiro de esta espera. Actualizá tus reservas antes de volver a intentar.', 502, 'RESPUESTA_INVALIDA');
  }
  return value as unknown as RetiroEspera;
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

export interface PlanMembresia { planId: string; nombre: string; importeMinor: number; moneda: string; estado: 'ACTIVO' | 'INACTIVO'; duracionMeses: number }
export interface SolicitudMembresia {
  solicitudId: string; socioId: string; planId: string; nombrePlan: string; importeMinor: number; moneda: string;
  fechaInicio: string; fechaFin: string; estado: 'PENDIENTE' | 'CONFIRMADA' | 'RECHAZADA';
  pago?: { pagoId: string; referencia: string; estado: 'PENDIENTE' | 'CONFIRMADO' | 'RECHAZADO' } | null;
  comprobante?: { comprobanteId: string; pagoId: string; membresiaId: string; confirmadoEn: string } | null;
}
const invalidMembresias = (): never => { throw new ApiError('Respuesta de membresía no válida. Conservá la misma operación para reintentar.', 502, 'RESPUESTA_INVALIDA'); };
async function requestGestion<T>(path: string, options: RequestInit = {}, expectedStatus?: number): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    return await request<T>(path, { ...options, signal }, true, expectedStatus);
  } catch (error) {
    if (timeout.aborted) {
      throw new ApiError('Se agotó el tiempo de espera. Volvé a consultar o reintentá la misma operación pendiente.', 0, 'TIEMPO_AGOTADO');
    }
    if (error instanceof ApiError && error.status >= 200 && error.status < 300) return invalidMembresias();
    throw error;
  }
}

function planMembresia(value: unknown): PlanMembresia {
  if (!isRecord(value) || !isText(value.planId) || !isText(value.nombre) || !isNatural(value.importeMinor)
    || typeof value.moneda !== 'string' || !/^[A-Z]{3}$/.test(value.moneda) || !['ACTIVO','INACTIVO'].includes(String(value.estado))
    || (value.duracionMeses !== undefined && (!isNatural(value.duracionMeses) || value.duracionMeses < 1))) return invalidMembresias();
  // Un servidor 1.0 sin duración equivale a un plan mensual.
  return { ...(value as unknown as PlanMembresia), duracionMeses: (value.duracionMeses as number | undefined) ?? 1 };
}
function solicitudMembresia(value: unknown): SolicitudMembresia {
  if (!isRecord(value) || !isText(value.solicitudId) || !isText(value.socioId) || !isText(value.planId) || !isText(value.nombrePlan)
    || !isNatural(value.importeMinor) || typeof value.moneda !== 'string' || !/^[A-Z]{3}$/.test(value.moneda)
    || !isDate(value.fechaInicio) || !isDate(value.fechaFin) || !['PENDIENTE','CONFIRMADA','RECHAZADA'].includes(String(value.estado))) return invalidMembresias();
  if (value.pago != null && (!isRecord(value.pago) || !isText(value.pago.pagoId) || !isText(value.pago.referencia) || !['PENDIENTE','CONFIRMADO','RECHAZADO'].includes(String(value.pago.estado)))) return invalidMembresias();
  if (value.estado === 'CONFIRMADA') {
    if (!isRecord(value.pago) || value.pago.estado !== 'CONFIRMADO' || !isRecord(value.comprobante)
      || !isText(value.comprobante.comprobanteId) || !isText(value.comprobante.membresiaId) || value.comprobante.pagoId !== value.pago.pagoId || !isDate(value.comprobante.confirmadoEn)) return invalidMembresias();
  } else if (value.comprobante != null) return invalidMembresias();
  return value as unknown as SolicitudMembresia;
}
export async function apiPlanesMembresia() {
  const v=await requestGestion<unknown>('/api/v1/planes'); if(!isRecord(v)||!Array.isArray(v.items))return invalidMembresias(); return {items:v.items.map(planMembresia)};
}
export type SocioAdministrativo = Pick<AuthUser, 'socioId' | 'dni' | 'nombre' | 'email' | 'estado'>;
export async function apiSociosAdministracion(pagina: number) {
  const v=await requestGestion<unknown>('/api/v1/socios?'+new URLSearchParams({pagina:String(pagina),tamanio:'20'}));
  if(!isRecord(v)||!Array.isArray(v.items))return invalidMembresias();
  const items=v.items.map(item=>{if(!isRecord(item)||!isText(item.socioId)||!isText(item.nombre)||!isText(item.dni)||!isText(item.email)||!['ACTIVO','INACTIVO'].includes(String(item.estado)))return invalidMembresias();
    return {socioId:item.socioId,nombre:item.nombre,dni:item.dni,email:item.email,estado:item.estado} as SocioAdministrativo;});return {items};
}
export async function apiSolicitudesMembresia(pagina: number, socioId?: string) {
  const v=await requestGestion<unknown>((socioId?'/api/v1/socios/'+encodeURIComponent(socioId)+'/solicitudes':'/api/v1/solicitudes')+'?'+new URLSearchParams({pagina:String(pagina),tamanio:'20'}));
  if(!isRecord(v)||!Array.isArray(v.items))return invalidMembresias();
  const items=v.items.map(solicitudMembresia); if(socioId&&items.some(s=>s.socioId!==socioId))return invalidMembresias();return {items};
}
export async function apiOperacionMembresia(path: string, method: 'POST' | 'PUT', body: object, clave: string) {
  const value=await requestGestion<unknown>(path,{method,headers:{'Idempotency-Key':clave},body:JSON.stringify(body)},path.startsWith('/api/v1/membresias/')?200:undefined);
  const b=body as Record<string,unknown>;
  if(path.startsWith('/api/v1/planes')) {
    const p=planMembresia(value);
    if(path==='/api/v1/planes'?(p.nombre!==String(b.nombre).trim()||p.importeMinor!==b.importeMinor||p.moneda!==b.moneda):(path!=='/api/v1/planes/'+p.planId+'/estado'||p.estado!==b.estado))return invalidMembresias();
    return p;
  }
  if(path.startsWith('/api/v1/membresias/')) {
    if(!isRecord(value)||!isText(value.membresiaId)||path!=='/api/v1/membresias/'+encodeURIComponent(value.membresiaId)+'/suspender'
      ||value.estado!=='SUSPENDIDA'||!isText(value.socioId)||!isText(value.eventId)||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.eventId)||!isDate(value.suspendidaEn)
      ||!isDate(value.fechaInicio)||!isDate(value.fechaFin)||Date.parse(value.fechaInicio)>Date.parse(value.fechaFin))return invalidMembresias();
    return value;
  }
  const s=solicitudMembresia(value);
  if(path.endsWith('/confirmar')) { if(path!=='/api/v1/pagos/'+s.pago?.pagoId+'/confirmar'||s.estado!=='CONFIRMADA')return invalidMembresias(); }
  else if(path.endsWith('/rechazar')) { if(path!=='/api/v1/solicitudes/'+s.solicitudId+'/rechazar'||s.estado!=='RECHAZADA')return invalidMembresias(); }
  else if(path.endsWith('/pagos')) { if(path!=='/api/v1/solicitudes/'+s.solicitudId+'/pagos'||s.pago?.referencia!==b.referencia||s.importeMinor!==b.importeMinor||s.moneda!==b.moneda)return invalidMembresias(); }
  else if(path!=='/api/v1/socios/'+encodeURIComponent(s.socioId)+'/solicitudes'||s.planId!==b.planId||Date.parse(s.fechaInicio)!==Date.parse(String(b.fechaInicio))||Date.parse(s.fechaFin)!==Date.parse(String(b.fechaFin)))return invalidMembresias();
  return s;
}

export interface MembresiaAdministrativa {
  membresiaId: string; socioId: string; tipoPlan: string; estado: 'HABILITADA'|'SUSPENDIDA'|'VENCIDA';
  fechaInicio: string; fechaFin: string;
}
export async function apiHistorialMembresias(socioId: string) {
  const v = await requestGestion<unknown>('/api/v1/socios/'+encodeURIComponent(socioId)+'/membresias',{},200);
  if(!isRecord(v)||!Array.isArray(v.items))return invalidMembresias();
  const items = v.items.map(m => {
    if(!isRecord(m)||!isText(m.membresiaId)||m.socioId!==socioId||!isText(m.tipoPlan)
      ||!['HABILITADA','SUSPENDIDA','VENCIDA'].includes(String(m.estado))||!isDate(m.fechaInicio)||!isDate(m.fechaFin))return invalidMembresias();
    return m as unknown as MembresiaAdministrativa;
  });
  return {items};
}

// Caja: compras de socios en la tienda, que se cobran en el mostrador (ADMIN).
export interface CompraCaja extends CompraTienda { socioId: string }
export async function apiComprasCaja(pagina = 1): Promise<{ pagina: number; tamanio: number; total: number; totalMinor: number; items: CompraCaja[] }> {
  const value = await request<unknown>('/api/v1/tienda/admin/compras?' + new URLSearchParams({ pagina: String(pagina), tamanio: '50' }), {}, true, 200);
  if (!isRecord(value) || !isNatural(value.total) || !isNatural(value.totalMinor) || !Array.isArray(value.items)) {
    throw new ApiError('El servidor devolvió compras no válidas.', 502, 'RESPUESTA_INVALIDA');
  }
  const items = value.items.map(item => {
    if (!isRecord(item) || !isText(item.socioId)) throw new ApiError('El servidor devolvió compras no válidas.', 502, 'RESPUESTA_INVALIDA');
    const { socioId, ...compra } = item;
    return { ...validarCompraTienda(compra), socioId };
  });
  return { pagina: value.pagina as number, tamanio: value.tamanio as number, total: value.total, totalMinor: value.totalMinor, items };
}

// Resúmenes ADMIN calculados por cada servicio propietario.
export interface ResumenMembresias {
  consultadoEn: string; mesActual: string;
  pendientes: { cantidad: number; conPagoRegistrado: number; importes: { moneda: string; importeMinor: number }[] };
  ingresosMensuales: { mes: string; moneda: string; importeMinor: number }[];
  ingresosPeriodo: { moneda: string; importeMinor: number }[];
  confirmadasPorPlan: { nombrePlan: string; cantidad: number }[];
}
export interface ResumenComprasAdmin {
  consultadoEn: string; mesActual: string;
  hoy: { cantidad: number; importeMinor: number };
  historico: { cantidad: number; importeMinor: number };
  mensuales: { mes: string; importeMinor: number }[];
  productos: { nombre: string; unidades: number }[];
}
const esMes = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const esImporteResumen = (value: unknown) => isRecord(value) && isNatural(value.importeMinor);
const esImporteConMoneda = (value: unknown) => esImporteResumen(value) && isRecord(value)
  && typeof value.moneda === 'string' && /^[A-Z]{3}$/.test(value.moneda);
const resumenInvalido = (): never => { throw new ApiError('El servidor devolvió un resumen no válido. Volvé a consultar.', 502, 'RESPUESTA_INVALIDA'); };

export async function apiResumenMembresias(): Promise<ResumenMembresias> {
  const v = await request<unknown>('/api/v1/solicitudes/resumen', {}, true, 200);
  if (!isRecord(v) || !isDate(v.consultadoEn) || !esMes(v.mesActual) || !isRecord(v.pendientes)
    || !isNatural(v.pendientes.cantidad) || !isNatural(v.pendientes.conPagoRegistrado)
    || v.pendientes.conPagoRegistrado > v.pendientes.cantidad
    || !Array.isArray(v.pendientes.importes) || !v.pendientes.importes.every(esImporteConMoneda)
    || !Array.isArray(v.ingresosPeriodo) || !v.ingresosPeriodo.every(esImporteConMoneda)
    || !Array.isArray(v.ingresosMensuales) || v.ingresosMensuales.some(i => !isRecord(i) || !esMes(i.mes) || !esImporteConMoneda(i))
    || !Array.isArray(v.confirmadasPorPlan) || v.confirmadasPorPlan.some(p => !isRecord(p) || !isText(p.nombrePlan) || !isNatural(p.cantidad))) return resumenInvalido();
  return v as unknown as ResumenMembresias;
}
export async function apiResumenCompras(): Promise<ResumenComprasAdmin> {
  const v = await request<unknown>('/api/v1/tienda/admin/resumen', {}, true, 200);
  if (!isRecord(v) || !isDate(v.consultadoEn) || !esMes(v.mesActual)
    || !isRecord(v.hoy) || !isNatural(v.hoy.cantidad) || !esImporteResumen(v.hoy)
    || !isRecord(v.historico) || !isNatural(v.historico.cantidad) || !esImporteResumen(v.historico)
    || v.hoy.cantidad > v.historico.cantidad || Number(v.hoy.importeMinor) > Number(v.historico.importeMinor)
    || !Array.isArray(v.mensuales) || v.mensuales.some(m => !isRecord(m) || !esMes(m.mes) || !esImporteResumen(m))
    || !Array.isArray(v.productos) || v.productos.some(p => !isRecord(p) || !isText(p.nombre) || !isNatural(p.unidades))) return resumenInvalido();
  return v as unknown as ResumenComprasAdmin;
}

// Estado de los servicios para Configuración.
export type ServicioSalud = 'gateway' | 'socios' | 'clases' | 'accesos' | 'tienda';
export async function apiSaludServicio(servicio: ServicioSalud): Promise<{ ok: boolean; detalle: Record<string, unknown> }> {
  try {
    const response = await fetch(API_BASE + (servicio === 'gateway' ? '/health' : '/health/' + servicio), { signal: AbortSignal.timeout(5000) });
    let detalle: Record<string, unknown> = {};
    try { const data = await response.json(); if (isRecord(data)) detalle = data; } catch { /* sin cuerpo */ }
    return { ok: response.ok, detalle };
  } catch {
    return { ok: false, detalle: { estado: 'sin respuesta' } };
  }
}
