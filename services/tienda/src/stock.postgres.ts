import { createHash, randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import {
  CompraDeSocio, CompraEntrada, CompraRegistrada, ItemCompra, PaginaCompras, PaginaComprasAdmin, ReposicionEntrada, ReposicionRecibida, StockItem,
  TiendaError, TiendaStockRepository, VentaEntrada, VentaRecibida,
} from './stock';

// Los IDs del contrato son opacos, sin un límite de longitud. El JSON de cada
// cadena preserva incluso NUL/surrogates; su digest permite índices de tamaño
// fijo. Siempre se compara también el valor completo, nunca solo el hash.
const serializar = (value: unknown) => JSON.stringify(value);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const maximo = BigInt(Number.MAX_SAFE_INTEGER);

export const TIENDA_STOCK_DDL = `
CREATE TABLE IF NOT EXISTS tienda_stock (
  producto_hash CHAR(64) PRIMARY KEY,
  producto_codigo_json TEXT NOT NULL,
  unidades_disponibles BIGINT NOT NULL DEFAULT 0 CHECK (unidades_disponibles BETWEEN 0 AND 9007199254740991),
  unidades_vendidas BIGINT NOT NULL DEFAULT 0 CHECK (unidades_vendidas BETWEEN 0 AND 9007199254740991),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tienda_reposiciones (
  reposicion_id UUID PRIMARY KEY,
  proveedor_id TEXT NOT NULL CHECK (proveedor_id = 'fav'),
  referencia_hash CHAR(64) NOT NULL,
  referencia_json TEXT NOT NULL,
  producto_hash CHAR(64) NOT NULL REFERENCES tienda_stock(producto_hash),
  unidades BIGINT NOT NULL CHECK (unidades BETWEEN 1 AND 9007199254740991),
  contenido TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proveedor_id, referencia_hash)
);
CREATE TABLE IF NOT EXISTS tienda_ventas (
  venta_id UUID PRIMARY KEY,
  actor_json TEXT NOT NULL,
  producto_hash CHAR(64) NOT NULL REFERENCES tienda_stock(producto_hash),
  unidades BIGINT NOT NULL CHECK (unidades BETWEEN 1 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tienda_operaciones (
  tipo TEXT NOT NULL CHECK (tipo IN ('REPOSICION', 'VENTA')),
  origen_hash CHAR(64) NOT NULL,
  origen_json TEXT NOT NULL,
  clave_hash CHAR(64) NOT NULL,
  clave_json TEXT NOT NULL,
  contenido TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  reposicion_id UUID REFERENCES tienda_reposiciones(reposicion_id),
  venta_id UUID REFERENCES tienda_ventas(venta_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tipo, origen_hash, clave_hash),
  CHECK ((tipo = 'REPOSICION' AND reposicion_id IS NOT NULL AND venta_id IS NULL)
    OR (tipo = 'VENTA' AND venta_id IS NOT NULL AND reposicion_id IS NULL))
);
CREATE TABLE IF NOT EXISTS tienda_compras (
  compra_id UUID PRIMARY KEY,
  socio_hash CHAR(64) NOT NULL,
  socio_json TEXT NOT NULL,
  clave_hash CHAR(64) NOT NULL,
  clave_json TEXT NOT NULL,
  contenido TEXT NOT NULL,
  respuesta TEXT NOT NULL,
  total_minor BIGINT NOT NULL CHECK (total_minor BETWEEN 0 AND 9007199254740991),
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (socio_hash, clave_hash)
);
CREATE INDEX IF NOT EXISTS tienda_compras_socio_fecha ON tienda_compras(socio_hash, created_at DESC, compra_id);
CREATE TABLE IF NOT EXISTS tienda_compra_items (
  compra_id UUID NOT NULL REFERENCES tienda_compras(compra_id),
  producto_hash CHAR(64) NOT NULL REFERENCES tienda_stock(producto_hash),
  unidades BIGINT NOT NULL CHECK (unidades BETWEEN 1 AND 10),
  precio_unitario_minor BIGINT NOT NULL CHECK (precio_unitario_minor >= 0),
  PRIMARY KEY (compra_id, producto_hash)
);
`;

type TipoOperacion = 'REPOSICION' | 'VENTA';
interface IdentidadOperacion { tipo: TipoOperacion; origen: string; clave: string; contenido: string }
interface FilaStock {
  producto_codigo_json: string;
  unidades_disponibles: string;
  unidades_vendidas: string;
}

function verificarIdentidad(actual: string, esperada: string): void {
  if (actual !== esperada) throw new Error('La identidad completa no coincide con el índice de Tienda.');
}
function seguro(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Cantidad persistida fuera del rango seguro de Tienda.');
  return n;
}
function saldoRepresentable(value: bigint): void {
  if (value > maximo || value < 0n) {
    throw new TiendaError(422, 'STOCK_NO_REPRESENTABLE', 'El saldo resultante no puede representarse de forma segura.');
  }
}

export class PostgresTiendaStockRepository implements TiendaStockRepository {
  constructor(private readonly pool: Pool) {}

  async inicializarEsquema(): Promise<void> {
    await this.transaccion(async client => {
      await this.bloquear(client, ['esquema', 'v1']);
      await client.query(TIENDA_STOCK_DDL);
    });
  }

  async comprobarSalud(): Promise<void> {
    await this.pool.query('SELECT 1');
  }

  async listarStock(): Promise<StockItem[]> {
    const result = await this.pool.query<FilaStock>(`SELECT producto_codigo_json,
      unidades_disponibles::text, unidades_vendidas::text FROM tienda_stock`);
    return result.rows.map(row => ({
      productoCodigo: JSON.parse(row.producto_codigo_json) as string,
      unidadesDisponibles: seguro(row.unidades_disponibles),
      unidadesVendidas: seguro(row.unidades_vendidas),
    })).sort((a, b) => a.productoCodigo < b.productoCodigo ? -1 : a.productoCodigo > b.productoCodigo ? 1 : 0);
  }

  async recibirReposicion(clave: string, datos: ReposicionEntrada): Promise<ReposicionRecibida> {
    const contenido = serializar({ proveedorId: datos.proveedorId, productoCodigo: datos.productoCodigo,
      unidades: datos.unidades, referencia: datos.referencia });
    const operacion: IdentidadOperacion = { tipo: 'REPOSICION', origen: datos.proveedorId, clave, contenido };
    return this.transaccion(async client => {
      const repetida = await this.buscarOperacion<ReposicionRecibida>(client, operacion);
      if (repetida) return repetida;

      await this.bloquear(client, ['referencia', datos.proveedorId, datos.referencia]);
      const referenciaJson = serializar(datos.referencia);
      const anterior = (await client.query<{ reposicion_id: string; referencia_json: string; contenido: string }>(
        'SELECT reposicion_id, referencia_json, contenido FROM tienda_reposiciones WHERE proveedor_id=$1 AND referencia_hash=$2',
        [datos.proveedorId, digest(referenciaJson)],
      )).rows[0];
      if (anterior) {
        verificarIdentidad(anterior.referencia_json, referenciaJson);
        if (anterior.contenido !== contenido) {
          throw new TiendaError(409, 'REFERENCIA_REUTILIZADA', 'La entrega ya fue registrada con otros datos.');
        }
        const resultado: ReposicionRecibida = { reposicionId: anterior.reposicion_id, estado: 'RECIBIDA' };
        await this.guardarOperacion(client, operacion, resultado, anterior.reposicion_id);
        return resultado;
      }

      const codigoJson = serializar(datos.productoCodigo), productoHash = digest(codigoJson);
      await client.query('INSERT INTO tienda_stock(producto_hash,producto_codigo_json) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [productoHash, codigoJson]);
      const row = await this.bloquearStock(client, productoHash, codigoJson);
      const disponibles = BigInt(row.unidades_disponibles) + BigInt(datos.unidades);
      saldoRepresentable(disponibles);
      await client.query('UPDATE tienda_stock SET unidades_disponibles=$1, updated_at=now() WHERE producto_hash=$2',
        [disponibles.toString(), productoHash]);
      const reposicionId = randomUUID();
      await client.query(`INSERT INTO tienda_reposiciones(reposicion_id,proveedor_id,referencia_hash,referencia_json,producto_hash,unidades,contenido)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [reposicionId, datos.proveedorId, digest(referenciaJson), referenciaJson, productoHash, String(datos.unidades), contenido]);
      const resultado: ReposicionRecibida = { reposicionId, estado: 'RECIBIDA' };
      await this.guardarOperacion(client, operacion, resultado, reposicionId);
      return resultado;
    });
  }

  async registrarVenta(actorId: string, clave: string, datos: VentaEntrada): Promise<VentaRecibida> {
    const contenido = serializar({ productoCodigo: datos.productoCodigo, unidades: datos.unidades });
    const operacion: IdentidadOperacion = { tipo: 'VENTA', origen: actorId, clave, contenido };
    return this.transaccion(async client => {
      const repetida = await this.buscarOperacion<VentaRecibida>(client, operacion);
      if (repetida) return repetida;
      const codigoJson = serializar(datos.productoCodigo), productoHash = digest(codigoJson);
      const row = await this.bloquearStock(client, productoHash, codigoJson);
      if (BigInt(row.unidades_disponibles) < BigInt(datos.unidades)) {
        throw new TiendaError(409, 'STOCK_INSUFICIENTE', 'La venta supera las unidades disponibles.');
      }
      const vendidas = BigInt(row.unidades_vendidas) + BigInt(datos.unidades);
      saldoRepresentable(vendidas);
      await client.query(`UPDATE tienda_stock SET unidades_disponibles=unidades_disponibles-$1,
        unidades_vendidas=$2, updated_at=now() WHERE producto_hash=$3`,
      [String(datos.unidades), vendidas.toString(), productoHash]);
      const ventaId = randomUUID();
      await client.query('INSERT INTO tienda_ventas(venta_id,actor_json,producto_hash,unidades) VALUES($1,$2,$3,$4)',
        [ventaId, serializar(actorId), productoHash, String(datos.unidades)]);
      const resultado: VentaRecibida = { ventaId, estado: 'REGISTRADA', productoCodigo: datos.productoCodigo, unidades: datos.unidades };
      await this.guardarOperacion(client, operacion, resultado, undefined, ventaId);
      return resultado;
    });
  }

  async buscarCompra(socioId: string, clave: string, datos: CompraEntrada): Promise<CompraRegistrada | undefined> {
    return this.compraPrevia(this.pool, socioId, clave, serializar(datos.items));
  }

  async registrarCompra(socioId: string, clave: string, datos: CompraEntrada, items: ItemCompra[], creadaEn: Date): Promise<CompraRegistrada> {
    const contenido = serializar(datos.items);
    return this.transaccion(async client => {
      await this.bloquear(client, ['compra', socioId, clave]);
      const repetida = await this.compraPrevia(client, socioId, clave, contenido);
      if (repetida) return repetida;
      // Filas bloqueadas en orden de hash: dos compras cruzadas no se interbloquean.
      const productos = items.map(item => {
        const codigoJson = serializar(item.productoCodigo);
        return { item, codigoJson, hash: digest(codigoJson) };
      }).sort((a, b) => a.hash < b.hash ? -1 : 1);
      const filas = new Map((await client.query<FilaStock & { producto_hash: string }>(`SELECT producto_hash, producto_codigo_json,
        unidades_disponibles::text, unidades_vendidas::text FROM tienda_stock WHERE producto_hash = ANY($1::char(64)[])
        ORDER BY producto_hash FOR UPDATE`, [productos.map(p => p.hash)])).rows.map(row => [row.producto_hash, row]));
      const faltantes = productos.filter(({ item, hash }) => {
        const fila = filas.get(hash);
        return !fila || BigInt(fila.unidades_disponibles) < BigInt(item.unidades);
      }).map(({ item }) => item.productoCodigo);
      if (faltantes.length) {
        throw new TiendaError(409, 'STOCK_INSUFICIENTE', 'No alcanzan las unidades de: ' + faltantes.join(', ') + '. No se descontó nada.');
      }
      const compraId = randomUUID();
      const totalMinor = items.reduce((total, item) => total + item.subtotalMinor, 0);
      if (!Number.isSafeInteger(totalMinor)) throw new TiendaError(422, 'STOCK_NO_REPRESENTABLE', 'El total de la compra no puede representarse de forma segura.');
      const resultado: CompraRegistrada = { compraId, estado: 'REGISTRADA', items, totalMinor, currency: 'ARS', creadaEn: creadaEn.toISOString() };
      const socioJson = serializar(socioId), claveJson = serializar(clave);
      await client.query(`INSERT INTO tienda_compras(compra_id,socio_hash,socio_json,clave_hash,clave_json,contenido,respuesta,total_minor,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [compraId, digest(socioJson), socioJson, digest(claveJson), claveJson, contenido, serializar(resultado), String(totalMinor), resultado.creadaEn]);
      for (const { item, codigoJson, hash } of productos) {
        verificarIdentidad(filas.get(hash)!.producto_codigo_json, codigoJson);
        const vendidas = BigInt(filas.get(hash)!.unidades_vendidas) + BigInt(item.unidades);
        saldoRepresentable(vendidas);
        await client.query(`UPDATE tienda_stock SET unidades_disponibles=unidades_disponibles-$1,
          unidades_vendidas=$2, updated_at=now() WHERE producto_hash=$3`, [String(item.unidades), vendidas.toString(), hash]);
        await client.query('INSERT INTO tienda_compra_items(compra_id,producto_hash,unidades,precio_unitario_minor) VALUES($1,$2,$3,$4)',
          [compraId, hash, String(item.unidades), String(item.precioUnitarioMinor)]);
      }
      return resultado;
    });
  }

  async listarCompras(socioId: string, pagina: number, tamanio: number): Promise<PaginaCompras> {
    const socioJson = serializar(socioId);
    const [filas, total] = await Promise.all([
      this.pool.query<{ socio_json: string; respuesta: string }>(`SELECT socio_json, respuesta FROM tienda_compras
        WHERE socio_hash=$1 ORDER BY created_at DESC, compra_id LIMIT $2 OFFSET $3`,
      [digest(socioJson), tamanio, (pagina - 1) * tamanio]),
      this.pool.query<{ total: string }>('SELECT count(*)::text AS total FROM tienda_compras WHERE socio_hash=$1', [digest(socioJson)]),
    ]);
    return {
      pagina, tamanio, total: seguro(total.rows[0].total),
      items: filas.rows.map(row => { verificarIdentidad(row.socio_json, socioJson); return JSON.parse(row.respuesta) as CompraRegistrada; }),
    };
  }

  async listarComprasAdmin(pagina: number, tamanio: number): Promise<PaginaComprasAdmin> {
    const [filas, resumen] = await Promise.all([
      this.pool.query<{ socio_json: string; respuesta: string }>(`SELECT socio_json, respuesta FROM tienda_compras
        ORDER BY created_at DESC, compra_id LIMIT $1 OFFSET $2`, [tamanio, (pagina - 1) * tamanio]),
      this.pool.query<{ total: string; suma: string }>("SELECT count(*)::text AS total, COALESCE(sum(total_minor),0)::text AS suma FROM tienda_compras"),
    ]);
    return {
      pagina, tamanio, total: seguro(resumen.rows[0].total), totalMinor: seguro(resumen.rows[0].suma),
      items: filas.rows.map(row => ({ ...(JSON.parse(row.respuesta) as CompraRegistrada), socioId: JSON.parse(row.socio_json) as string }) as CompraDeSocio),
    };
  }

  private async compraPrevia(db: Pool | PoolClient, socioId: string, clave: string, contenido: string): Promise<CompraRegistrada | undefined> {
    const socioJson = serializar(socioId), claveJson = serializar(clave);
    const anterior = (await db.query<{ socio_json: string; clave_json: string; contenido: string; respuesta: string }>(
      'SELECT socio_json, clave_json, contenido, respuesta FROM tienda_compras WHERE socio_hash=$1 AND clave_hash=$2',
      [digest(socioJson), digest(claveJson)],
    )).rows[0];
    if (!anterior) return undefined;
    verificarIdentidad(anterior.socio_json, socioJson);
    verificarIdentidad(anterior.clave_json, claveJson);
    if (anterior.contenido !== contenido) throw new TiendaError(409, 'CLAVE_REUTILIZADA', 'La clave ya corresponde a otra compra.');
    return JSON.parse(anterior.respuesta) as CompraRegistrada;
  }

  private async bloquearStock(client: PoolClient, hash: string, codigoJson: string): Promise<FilaStock> {
    const row = (await client.query<FilaStock>(`SELECT producto_codigo_json, unidades_disponibles::text,
      unidades_vendidas::text FROM tienda_stock WHERE producto_hash=$1 FOR UPDATE`, [hash])).rows[0];
    if (!row) throw new TiendaError(404, 'PRODUCTO_NO_ENCONTRADO', 'La variante no tiene recepciones en la tienda.');
    verificarIdentidad(row.producto_codigo_json, codigoJson);
    return row;
  }

  private async buscarOperacion<T>(client: PoolClient, op: IdentidadOperacion): Promise<T | undefined> {
    await this.bloquear(client, ['clave', op.tipo, op.origen, op.clave]);
    const origenJson = serializar(op.origen), claveJson = serializar(op.clave);
    const anterior = (await client.query<{ origen_json: string; clave_json: string; contenido: string; respuesta: string }>(
      'SELECT origen_json,clave_json,contenido,respuesta FROM tienda_operaciones WHERE tipo=$1 AND origen_hash=$2 AND clave_hash=$3',
      [op.tipo, digest(origenJson), digest(claveJson)],
    )).rows[0];
    if (!anterior) return undefined;
    verificarIdentidad(anterior.origen_json, origenJson);
    verificarIdentidad(anterior.clave_json, claveJson);
    if (anterior.contenido !== op.contenido) {
      throw new TiendaError(409, 'CLAVE_REUTILIZADA', 'La clave ya corresponde a otra solicitud.');
    }
    return JSON.parse(anterior.respuesta) as T;
  }

  private async guardarOperacion(client: PoolClient, op: IdentidadOperacion,
    resultado: ReposicionRecibida | VentaRecibida, reposicionId?: string, ventaId?: string): Promise<void> {
    const origenJson = serializar(op.origen), claveJson = serializar(op.clave);
    await client.query(`INSERT INTO tienda_operaciones(tipo,origen_hash,origen_json,clave_hash,clave_json,contenido,respuesta,reposicion_id,venta_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [op.tipo, digest(origenJson), origenJson, digest(claveJson), claveJson, op.contenido, serializar(resultado), reposicionId ?? null, ventaId ?? null]);
  }

  private async bloquear(client: PoolClient, identidad: unknown[]): Promise<void> {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [serializar(['tienda', ...identidad])]);
  }

  private async transaccion<T>(aplicar: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let errorDeConexion: Error | undefined;
    try {
      await client.query('BEGIN');
      const resultado = await aplicar(client);
      await client.query('COMMIT');
      return resultado;
    } catch (error) {
      try { await client.query('ROLLBACK'); }
      catch (rollbackError) { errorDeConexion = rollbackError instanceof Error ? rollbackError : new Error('No se pudo revertir la transacción.'); }
      throw error;
    } finally { client.release(errorDeConexion); }
  }
}
