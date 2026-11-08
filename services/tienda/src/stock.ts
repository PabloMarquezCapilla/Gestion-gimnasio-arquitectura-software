export class TiendaError extends Error {
  constructor(readonly statusCode: number, readonly codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'TiendaError';
  }
}

export interface StockItem {
  productoCodigo: string;
  unidadesDisponibles: number;
  unidadesVendidas: number;
}
export interface ReposicionEntrada {
  proveedorId: 'fav';
  productoCodigo: string;
  unidades: number;
  referencia: string;
}
export interface ReposicionRecibida { reposicionId: string; estado: 'RECIBIDA' }
export interface VentaEntrada { productoCodigo: string; unidades: number }
export interface VentaRecibida {
  ventaId: string;
  estado: 'REGISTRADA';
  productoCodigo: string;
  unidades: number;
}

export interface TiendaStockRepository {
  listarStock(): Promise<StockItem[]>;
  recibirReposicion(clave: string, datos: ReposicionEntrada): Promise<ReposicionRecibida>;
  registrarVenta(actorId: string, clave: string, datos: VentaEntrada): Promise<VentaRecibida>;
  comprobarSalud(): Promise<void>;
}

function identificador(value: unknown): value is string {
  return typeof value === 'string' && /\S/u.test(value);
}
function cantidad(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function objeto(body: unknown, campos: readonly string[]): body is Record<string, unknown> {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length === campos.length && campos.every(campo => Object.prototype.hasOwnProperty.call(body, campo));
}

export function claveStock(value: unknown): string {
  if (!identificador(value)) {
    throw new TiendaError(400, 'IDEMPOTENCIA_INVALIDA', 'Se requiere una Idempotency-Key no vacía de espacios.');
  }
  return value;
}

export function datosReposicion(body: unknown): ReposicionEntrada {
  if (!objeto(body, ['proveedorId', 'productoCodigo', 'unidades', 'referencia'])
    || body.proveedorId !== 'fav' || !identificador(body.productoCodigo)
    || !cantidad(body.unidades) || !identificador(body.referencia)) {
    throw new TiendaError(400, 'SOLICITUD_INVALIDA', 'Se requiere proveedorId=fav, variante, unidades enteras positivas y referencia, sin campos adicionales.');
  }
  // Orden fijo para comparar contenido; los identificadores opacos no se normalizan.
  return { proveedorId: 'fav', productoCodigo: body.productoCodigo, unidades: body.unidades, referencia: body.referencia };
}

export function datosVenta(body: unknown): VentaEntrada {
  if (!objeto(body, ['productoCodigo', 'unidades']) || !identificador(body.productoCodigo) || !cantidad(body.unidades)) {
    throw new TiendaError(400, 'SOLICITUD_INVALIDA', 'Se requiere una variante y unidades enteras positivas, sin campos adicionales.');
  }
  return { productoCodigo: body.productoCodigo, unidades: body.unidades };
}

export class TiendaStockService {
  constructor(private readonly repository: TiendaStockRepository) {}

  async consultarStock(): Promise<{ proveedorId: 'fav'; items: StockItem[] }> {
    return { proveedorId: 'fav', items: await this.repository.listarStock() };
  }

  async reponer(clave: unknown, body: unknown): Promise<ReposicionRecibida> {
    return this.repository.recibirReposicion(claveStock(clave), datosReposicion(body));
  }

  async vender(actorId: string, clave: unknown, body: unknown): Promise<VentaRecibida> {
    if (!identificador(actorId)) throw new TiendaError(401, 'NO_AUTENTICADO', 'Se requiere una identidad administrativa válida.');
    return this.repository.registrarVenta(actorId, claveStock(clave), datosVenta(body));
  }
}
