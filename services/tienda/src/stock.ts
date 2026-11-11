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

export interface CompraEntrada { items: VentaEntrada[] }
export interface ItemCompra {
  productoCodigo: string;
  nombre: string;
  talle: string;
  color: string;
  unidades: number;
  precioUnitarioMinor: number;
  subtotalMinor: number;
}
export interface CompraRegistrada {
  compraId: string;
  estado: 'REGISTRADA';
  items: ItemCompra[];
  totalMinor: number;
  currency: 'ARS';
  creadaEn: string;
}
export interface PaginaCompras { pagina: number; tamanio: number; total: number; items: CompraRegistrada[] }
export interface CompraDeSocio extends CompraRegistrada { socioId: string }
export interface PaginaComprasAdmin { pagina: number; tamanio: number; total: number; totalMinor: number; items: CompraDeSocio[] }
export interface ResumenComprasAdmin {
  consultadoEn: string; mesActual: string;
  hoy: { cantidad: number; importeMinor: number };
  historico: { cantidad: number; importeMinor: number };
  mensuales: { mes: string; importeMinor: number }[];
  productos: { nombre: string; unidades: number }[];
}
export interface PrecioCompra { nombre: string; talle: string; color: string; precioMinor: number }

export interface TiendaStockRepository {
  listarStock(): Promise<StockItem[]>;
  recibirReposicion(clave: string, datos: ReposicionEntrada): Promise<ReposicionRecibida>;
  registrarVenta(actorId: string, clave: string, datos: VentaEntrada): Promise<VentaRecibida>;
  buscarCompra(socioId: string, clave: string, datos: CompraEntrada): Promise<CompraRegistrada | undefined>;
  registrarCompra(socioId: string, clave: string, datos: CompraEntrada, items: ItemCompra[], creadaEn: Date): Promise<CompraRegistrada>;
  listarCompras(socioId: string, pagina: number, tamanio: number): Promise<PaginaCompras>;
  // Caja: compras de todos los socios, recientes primero; totalMinor suma todas, no solo la página.
  listarComprasAdmin(pagina: number, tamanio: number): Promise<PaginaComprasAdmin>;
  resumenComprasAdmin(): Promise<ResumenComprasAdmin>;
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

export const MAX_ITEMS_COMPRA = 10;
export const MAX_UNIDADES_ITEM = 10;

export function datosCompra(body: unknown): CompraEntrada {
  const invalido = () => new TiendaError(400, 'SOLICITUD_INVALIDA',
    `Se requieren entre 1 y ${MAX_ITEMS_COMPRA} variantes distintas con 1 a ${MAX_UNIDADES_ITEM} unidades cada una, sin campos adicionales.`);
  if (!objeto(body, ['items']) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ITEMS_COMPRA) throw invalido();
  const items = (body.items as unknown[]).map(item => {
    if (!objeto(item, ['productoCodigo', 'unidades']) || !identificador(item.productoCodigo)
      || !cantidad(item.unidades) || item.unidades > MAX_UNIDADES_ITEM) throw invalido();
    return { productoCodigo: item.productoCodigo, unidades: item.unidades };
  });
  if (new Set(items.map(item => item.productoCodigo)).size !== items.length) throw invalido();
  return { items };
}

// El precio se cotiza fuera de la transacción; el stock se valida y descuenta adentro.
export function cotizarCompra(datos: CompraEntrada, precios: Map<string, PrecioCompra>): ItemCompra[] {
  const faltantes = datos.items.filter(item => !precios.has(item.productoCodigo)).map(item => item.productoCodigo);
  if (faltantes.length) {
    throw new TiendaError(409, 'PRODUCTO_NO_DISPONIBLE', 'Alguna variante ya no figura en el catálogo de FAV: ' + faltantes.join(', ') + '.');
  }
  return datos.items.map(item => {
    const precio = precios.get(item.productoCodigo)!;
    return { productoCodigo: item.productoCodigo, nombre: precio.nombre, talle: precio.talle, color: precio.color,
      unidades: item.unidades, precioUnitarioMinor: precio.precioMinor, subtotalMinor: precio.precioMinor * item.unidades };
  });
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

  async comprar(socioId: string, clave: unknown, body: unknown,
    cotizar: (codigos: string[]) => Promise<Map<string, PrecioCompra>>, ahora: Date = new Date()): Promise<CompraRegistrada> {
    if (!identificador(socioId)) throw new TiendaError(401, 'NO_AUTENTICADO', 'Se requiere un socio autenticado.');
    const llave = claveStock(clave), datos = datosCompra(body);
    // Un reintento con la misma clave devuelve la compra original aunque FAV esté caído.
    const previa = await this.repository.buscarCompra(socioId, llave, datos);
    if (previa) return previa;
    const items = cotizarCompra(datos, await cotizar(datos.items.map(item => item.productoCodigo)));
    return this.repository.registrarCompra(socioId, llave, datos, items, ahora);
  }

  async compras(socioId: string, pagina: number, tamanio: number): Promise<PaginaCompras> {
    if (!identificador(socioId)) throw new TiendaError(401, 'NO_AUTENTICADO', 'Se requiere un socio autenticado.');
    return this.repository.listarCompras(socioId, pagina, tamanio);
  }

  async comprasAdmin(pagina: number, tamanio: number): Promise<PaginaComprasAdmin> {
    return this.repository.listarComprasAdmin(pagina, tamanio);
  }

  async resumenComprasAdmin(): Promise<ResumenComprasAdmin> {
    return this.repository.resumenComprasAdmin();
  }
}
