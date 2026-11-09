import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { TiendaError } from '../stock';

export interface FavCatalogoConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface VarianteFav { varianteId: string; talle: string; color: string; precio: number }
export interface ProductoFav {
  productoId: string;
  nombre: string;
  categoria: string;
  descripcion?: string;
  fotoUrl?: string;
  variantes: VarianteFav[];
}

export interface FavCatalogoClient {
  listarProductos(contexto?: ContextoSalida): Promise<ProductoFav[]>;
}
export interface ContextoSalida { traceparent?: string; correlationId?: string }

type CodigoFav = 'FAV_CREDENCIAL_RECHAZADA' | 'FAV_RESPUESTA_INVALIDA' | 'FAV_NO_DISPONIBLE' | 'FAV_TIEMPO_AGOTADO';

const fallos: Record<CodigoFav, [number, string]> = {
  FAV_CREDENCIAL_RECHAZADA: [502, 'FAV rechazó la credencial del gimnasio.'],
  FAV_RESPUESTA_INVALIDA: [502, 'La respuesta de FAV no cumple el contrato catálogo-pedidos 1.1.0.'],
  FAV_NO_DISPONIBLE: [503, 'No se pudo consultar el catálogo de FAV.'],
  FAV_TIEMPO_AGOTADO: [504, 'Se agotó el tiempo de consulta al catálogo de FAV.'],
};

export class FavError extends TiendaError {
  constructor(readonly codigoFav: CodigoFav) {
    super(fallos[codigoFav][0], codigoFav, fallos[codigoFav][1]);
    this.name = 'FavError';
  }

  // Credencial o contrato roto no se resuelven reintentando: no abren el circuito.
  get esIndisponibilidad(): boolean {
    return this.codigoFav === 'FAV_NO_DISPONIBLE' || this.codigoFav === 'FAV_TIEMPO_AGOTADO';
  }
}

function validarConfig(config: FavCatalogoConfig): Required<FavCatalogoConfig> {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error('FAV_CATALOGO_BASE_URL debe ser una URL HTTP o HTTPS válida.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('FAV_CATALOGO_BASE_URL debe ser HTTP/HTTPS, sin credenciales, consulta ni fragmento.');
  }
  if (typeof config.apiKey !== 'string' || !/^[\x21-\x7e]+$/.test(config.apiKey)) {
    throw new Error('FAV_CATALOGO_API_KEY debe ser una clave imprimible sin espacios.');
  }
  const timeoutMs = config.timeoutMs ?? 3000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('FAV_CATALOGO_TIMEOUT_MS debe ser un entero entre 1 y 30000 milisegundos.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return { baseUrl: url.href, apiKey: config.apiKey, timeoutMs };
}

export function favCatalogoConfigDesdeEntorno(env: NodeJS.ProcessEnv = process.env): Required<FavCatalogoConfig> | undefined {
  const baseUrl = env.FAV_CATALOGO_BASE_URL?.trim() ?? '';
  const apiKey = env.FAV_CATALOGO_API_KEY ?? '';
  const rawTimeout = env.FAV_CATALOGO_TIMEOUT_MS;
  if (rawTimeout !== undefined && rawTimeout !== '' && !/^[1-9][0-9]*$/.test(rawTimeout)) {
    throw new Error('FAV_CATALOGO_TIMEOUT_MS debe ser un entero positivo de milisegundos.');
  }
  if (!baseUrl && !apiKey) return undefined;
  if (!baseUrl || !apiKey) throw new Error('Configurar conjuntamente FAV_CATALOGO_BASE_URL y FAV_CATALOGO_API_KEY.');
  return validarConfig({ baseUrl, apiKey, timeoutMs: rawTimeout ? Number(rawTimeout) : 3000 });
}

const contract = parse(readFileSync(
  resolve(__dirname, '../../../../docs/contracts/fav-catalogo-pedidos-1.1.0.openapi.yaml'), 'utf8',
)) as { paths: Record<string, any>; components: unknown };
const ajv = new Ajv({ strict: false });
addFormats(ajv);
ajv.addFormat('double', { type: 'number', validate: Number.isFinite });
const validarCatalogo = ajv.compile<{ items: ProductoFav[] }>({
  ...contract.paths['/v1/productos'].get.responses['200'].content['application/json'].schema,
  components: contract.components,
});
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export class HttpFavCatalogoClient implements FavCatalogoClient {
  private readonly config: Required<FavCatalogoConfig>;

  constructor(config: FavCatalogoConfig) {
    this.config = validarConfig(config);
  }

  async listarProductos(contexto?: ContextoSalida): Promise<ProductoFav[]> {
    const body = await this.consultar(new URL('v1/productos', this.config.baseUrl), contexto);
    if (!validarCatalogo(body)) throw new FavError('FAV_RESPUESTA_INVALIDA');
    const variantes = body.items.flatMap(producto => producto.variantes.map(variante => variante.varianteId));
    // Un precio negativo o un id de variante repetido haría ambigua la compra.
    if (new Set(variantes).size !== variantes.length
      || body.items.some(producto => producto.variantes.some(variante => variante.precio < 0))) {
      throw new FavError('FAV_RESPUESTA_INVALIDA');
    }
    return body.items.map(({ productoId, nombre, categoria, descripcion, fotoUrl, variantes }) => ({
      productoId, nombre, categoria,
      ...(descripcion === undefined ? {} : { descripcion }),
      ...(fotoUrl === undefined ? {} : { fotoUrl }),
      variantes: variantes.map(({ varianteId, talle, color, precio }) => ({ varianteId, talle, color, precio })),
    }));
  }

  // Lectura segura: un único reintento con jitter dentro del mismo presupuesto total.
  private async consultar(url: URL, contexto?: ContextoSalida): Promise<unknown> {
    const deadline = performance.now() + this.config.timeoutMs;
    let fallo = new FavError('FAV_NO_DISPONIBLE');
    for (let intento = 0; intento < 2; intento++) {
      const restante = deadline - performance.now();
      if (restante <= 0) throw new FavError('FAV_TIEMPO_AGOTADO');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), restante);
      try {
        const response = await fetch(url, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: {
            Accept: 'application/json', 'X-API-Key': this.config.apiKey,
            ...(contexto?.traceparent ? { traceparent: contexto.traceparent } : {}),
            ...(contexto?.correlationId ? { 'X-Correlation-Id': contexto.correlationId } : {}),
          },
        });
        if (response.status === 200) return await this.leerJson(response);
        if ([401, 403].includes(response.status)) throw new FavError('FAV_CREDENCIAL_RECHAZADA');
        if ([429, 500, 502, 503, 504].includes(response.status)) throw new FavError('FAV_NO_DISPONIBLE');
        throw new FavError('FAV_RESPUESTA_INVALIDA');
      } catch (error) {
        fallo = controller.signal.aborted || performance.now() >= deadline
          ? new FavError('FAV_TIEMPO_AGOTADO')
          : error instanceof FavError ? error : new FavError('FAV_NO_DISPONIBLE');
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      if (fallo.codigoFav !== 'FAV_NO_DISPONIBLE' || intento === 1) throw fallo;
      const pausa = Math.min(75 + Math.floor(Math.random() * 50), deadline - performance.now());
      if (pausa > 0) await new Promise(resolve => setTimeout(resolve, pausa));
    }
    throw fallo;
  }

  private async leerJson(response: Response): Promise<unknown> {
    if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
      || !response.body) {
      throw new FavError('FAV_RESPUESTA_INVALIDA');
    }
    const reader = response.body.getReader();
    const partes: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > MAX_BODY_BYTES) throw new FavError('FAV_RESPUESTA_INVALIDA');
        partes.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(partes))) as unknown;
    } catch {
      throw new FavError('FAV_RESPUESTA_INVALIDA');
    }
  }
}
