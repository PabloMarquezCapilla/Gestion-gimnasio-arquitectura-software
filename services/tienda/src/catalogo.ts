import { CircuitBreaker, CircuitoAbiertoError, EstadoCircuito } from './circuit-breaker';
import { ContextoSalida, FavCatalogoClient, FavError, ProductoFav } from './clients/fav-catalogo.client';
import { StockItem, TiendaError } from './stock';

export interface VarianteCatalogo {
  productoCodigo: string;
  talle: string;
  color: string;
  precioMinor: number;
  unidadesDisponibles: number;
}
export interface ProductoCatalogo {
  productoId: string;
  nombre: string;
  categoria: string;
  descripcion?: string;
  fotoUrl?: string;
  variantes: VarianteCatalogo[];
}
export interface PaginaCatalogo {
  origen: 'FAV' | 'CACHE_DEGRADADA';
  actualizadoEn: string;
  pagina: number;
  tamanio: number;
  total: number;
  items: ProductoCatalogo[];
}
export interface FiltrosCatalogo { categoria?: string; talle?: string; pagina: number; tamanio: number }
export interface PrecioVigente { productoCodigo: string; nombre: string; talle: string; color: string; precioMinor: number }
export interface CatalogoVigente { origen: 'FAV' | 'CACHE_DEGRADADA'; actualizadoEn: string; productos: ProductoFav[] }

export interface OpcionesCatalogo {
  ttlMs?: number;
  vigenciaDegradadaMs?: number;
  clock?: () => number;
  breaker?: CircuitBreaker;
}

// Precio de FAV en pesos con decimales; se guarda en centavos para no acumular redondeos.
export const aMinor = (precio: number) => Math.round(precio * 100);

export class CatalogoFavService {
  private cache?: { productos: ProductoFav[]; obtenidoEn: number };
  private enCurso?: Promise<ProductoFav[]>;
  private readonly ttl: number;
  private readonly vigenciaDegradada: number;
  private readonly clock: () => number;
  readonly breaker: CircuitBreaker;
  readonly contadores = { cacheFresca: 0, cacheDegradada: 0, consultasFav: 0, fallosFav: 0, rechazosCircuito: 0 };

  constructor(private readonly client: FavCatalogoClient | undefined, opciones: OpcionesCatalogo = {}) {
    this.ttl = opciones.ttlMs ?? 60_000;
    this.vigenciaDegradada = opciones.vigenciaDegradadaMs ?? 15 * 60_000;
    this.clock = opciones.clock ?? Date.now;
    this.breaker = opciones.breaker ?? new CircuitBreaker({
      clock: this.clock, cuentaComoFallo: error => !(error instanceof FavError) || error.esIndisponibilidad,
    });
  }

  get estadoCircuito(): EstadoCircuito { return this.breaker.estado; }
  get configurado(): boolean { return this.client !== undefined; }

  async vigente(contexto?: ContextoSalida): Promise<CatalogoVigente> {
    if (!this.client) throw new TiendaError(503, 'PROVEEDOR_NO_CONFIGURADO', 'El catálogo de FAV todavía no está configurado.');
    const ahora = this.clock();
    if (this.cache && ahora - this.cache.obtenidoEn < this.ttl) {
      this.contadores.cacheFresca++;
      return { origen: 'FAV', actualizadoEn: new Date(this.cache.obtenidoEn).toISOString(), productos: this.cache.productos };
    }
    try {
      const productos = await this.refrescar(contexto);
      return { origen: 'FAV', actualizadoEn: new Date(this.cache!.obtenidoEn).toISOString(), productos };
    } catch (error) {
      if (error instanceof CircuitoAbiertoError) this.contadores.rechazosCircuito++;
      else this.contadores.fallosFav++;
      const cache = this.cache;
      if (cache && this.clock() - cache.obtenidoEn < this.vigenciaDegradada) {
        this.contadores.cacheDegradada++;
        return { origen: 'CACHE_DEGRADADA', actualizadoEn: new Date(cache.obtenidoEn).toISOString(), productos: cache.productos };
      }
      if (error instanceof FavError && !error.esIndisponibilidad) throw error;
      throw new TiendaError(503, 'PROVEEDOR_NO_DISPONIBLE', 'El catálogo de FAV no está disponible en este momento. Intentá nuevamente en unos minutos.');
    }
  }

  // El catálogo se resuelve antes que el stock: sin FAV no hay nada que mostrar.
  async consultar(obtenerStock: () => Promise<StockItem[]>, filtros: FiltrosCatalogo, contexto?: ContextoSalida): Promise<PaginaCatalogo> {
    const catalogo = await this.vigente(contexto);
    const stock = await obtenerStock();
    const disponibles = new Map(stock.map(item => [item.productoCodigo, item.unidadesDisponibles]));
    // La tienda física solo vende lo que FAV entregó en consignación y sigue en stock.
    const productos = catalogo.productos
      .filter(producto => filtros.categoria === undefined || producto.categoria === filtros.categoria)
      .map(producto => ({
        productoId: producto.productoId,
        nombre: producto.nombre,
        categoria: producto.categoria,
        ...(producto.descripcion === undefined ? {} : { descripcion: producto.descripcion }),
        ...(producto.fotoUrl === undefined ? {} : { fotoUrl: producto.fotoUrl }),
        variantes: producto.variantes
          .filter(variante => (disponibles.get(variante.varianteId) ?? 0) > 0)
          .filter(variante => filtros.talle === undefined || variante.talle === filtros.talle)
          .map(variante => ({
            productoCodigo: variante.varianteId, talle: variante.talle, color: variante.color,
            precioMinor: aMinor(variante.precio), unidadesDisponibles: disponibles.get(variante.varianteId)!,
          })),
      }))
      .filter(producto => producto.variantes.length > 0)
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es') || (a.productoId < b.productoId ? -1 : 1));
    const inicio = (filtros.pagina - 1) * filtros.tamanio;
    return {
      origen: catalogo.origen, actualizadoEn: catalogo.actualizadoEn,
      pagina: filtros.pagina, tamanio: filtros.tamanio, total: productos.length,
      items: productos.slice(inicio, inicio + filtros.tamanio),
    };
  }

  async precios(codigos: string[], contexto?: ContextoSalida): Promise<Map<string, PrecioVigente>> {
    const catalogo = await this.vigente(contexto);
    const buscados = new Set(codigos), precios = new Map<string, PrecioVigente>();
    for (const producto of catalogo.productos) {
      for (const variante of producto.variantes) {
        if (buscados.has(variante.varianteId)) {
          precios.set(variante.varianteId, { productoCodigo: variante.varianteId, nombre: producto.nombre,
            talle: variante.talle, color: variante.color, precioMinor: aMinor(variante.precio) });
        }
      }
    }
    return precios;
  }

  private refrescar(contexto?: ContextoSalida): Promise<ProductoFav[]> {
    // Varias solicitudes simultáneas comparten una sola consulta a FAV.
    this.enCurso ??= this.breaker.ejecutar(async () => {
      this.contadores.consultasFav++;
      const productos = await this.client!.listarProductos(contexto);
      this.cache = { productos, obtenidoEn: this.clock() };
      return productos;
    }).finally(() => { this.enCurso = undefined; });
    return this.enCurso;
  }
}
