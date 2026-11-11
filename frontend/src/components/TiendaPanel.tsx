import { useEffect, useMemo, useState } from 'react';
import {
  ApiError, CatalogoTienda, CompraPendienteTienda, CompraTienda, VarianteTienda,
  apiCatalogoTienda, apiComprarTienda, apiMisCompras,
} from '../services/api';

const storageKey = 'tienda.compra.pendiente';
const pesos = (minor: number) => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

function leerPendiente(): CompraPendienteTienda | null {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as CompraPendienteTienda;
    return typeof value?.clave === 'string' && Array.isArray(value.items) ? value : null;
  } catch { return null; }
}

interface ItemCarrito { variante: VarianteTienda; nombre: string; unidades: number }

export function TiendaPanel() {
  const [attempt, setAttempt] = useState(0);
  const [filtros, setFiltros] = useState<{ categoria: string; talle: string; pagina: number }>({ categoria: '', talle: '', pagina: 1 });
  const [catalogo, setCatalogo] = useState<CatalogoTienda | null>(null);
  const [status, setStatus] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [message, setMessage] = useState('');
  const [carrito, setCarrito] = useState<Map<string, ItemCarrito>>(new Map());
  // Una compra sin confirmación se conserva con su clave para reintentarla igual.
  const [pendiente, setPendiente] = useState<CompraPendienteTienda | null>(leerPendiente);
  const [comprando, setComprando] = useState(false);
  const [resultado, setResultado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [compras, setCompras] = useState<CompraTienda[]>([]);

  useEffect(() => {
    let active = true;
    setStatus('cargando');
    apiCatalogoTienda({ categoria: filtros.categoria || undefined, talle: filtros.talle || undefined, pagina: filtros.pagina })
      .then(value => { if (active) { setCatalogo(value); setStatus('listo'); } })
      .catch((error: unknown) => {
        if (!active) return;
        setStatus('error');
        setMessage(error instanceof Error ? error.message : 'No se pudo consultar la tienda.');
      });
    return () => { active = false; };
  }, [attempt, filtros]);

  useEffect(() => {
    let active = true;
    apiMisCompras().then(value => { if (active) setCompras(value.items); }).catch(() => { /* la lista es secundaria */ });
    return () => { active = false; };
  }, [attempt]);

  const categorias = useMemo(() => [...new Set(catalogo?.items.map(p => p.categoria) ?? [])].sort(), [catalogo]);
  const totalCarrito = [...carrito.values()].reduce((t, i) => t + i.variante.precioMinor * i.unidades, 0);

  function agregar(variante: VarianteTienda, nombre: string) {
    setResultado(null);
    setCarrito(actual => {
      const nuevo = new Map(actual);
      const previo = nuevo.get(variante.productoCodigo);
      const unidades = Math.min((previo?.unidades ?? 0) + 1, variante.unidadesDisponibles, 10);
      nuevo.set(variante.productoCodigo, { variante, nombre, unidades });
      return nuevo;
    });
  }
  function quitar(codigo: string) {
    setCarrito(actual => { const nuevo = new Map(actual); nuevo.delete(codigo); return nuevo; });
  }

  async function confirmar() {
    const op: CompraPendienteTienda = pendiente ?? {
      clave: crypto.randomUUID(),
      items: [...carrito.values()].map(i => ({ productoCodigo: i.variante.productoCodigo, unidades: i.unidades })),
    };
    if (!op.items.length) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify(op)); } catch { /* sin almacenamiento, se reintenta en memoria */ }
    setPendiente(op);
    setComprando(true);
    setResultado(null);
    try {
      const compra = await apiComprarTienda(op);
      try { sessionStorage.removeItem(storageKey); } catch { /* ignorar */ }
      setPendiente(null);
      setCarrito(new Map());
      setResultado({ tipo: 'ok', texto: `Compra registrada por ${pesos(compra.totalMinor)}. Pagala y retirala en el mostrador.` });
      setAttempt(value => value + 1);
    } catch (error) {
      // Un rechazo definitivo libera la clave; una respuesta incierta se conserva para reintentar.
      const definitivo = error instanceof ApiError && [400, 403, 409].includes(error.status);
      if (definitivo) {
        try { sessionStorage.removeItem(storageKey); } catch { /* ignorar */ }
        setPendiente(null);
      }
      setResultado({ tipo: 'error', texto: (error instanceof Error ? error.message : 'No se pudo registrar la compra.')
        + (definitivo ? '' : ' Podés reintentar: no se duplicará la compra.') });
      if (definitivo) setAttempt(value => value + 1);
    } finally {
      setComprando(false);
    }
  }

  return (
    <section aria-labelledby="tienda-heading" className="rounded-xl border border-outline-variant/60 bg-surface-container-low p-5 space-y-4">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary" aria-hidden="true">storefront</span>
        <h2 id="tienda-heading" className="font-headline font-bold">Tienda</h2>
      </div>
      <p className="text-xs text-on-surface-variant">Ropa de FAV disponible en la tienda del gimnasio. Pagás y retirás en el mostrador.</p>

      {catalogo?.origen === 'CACHE_DEGRADADA' && (
        <p role="status" className="rounded-lg bg-tertiary-container text-on-tertiary-container p-3 text-xs">
          FAV no responde: mostramos el catálogo de las {new Date(catalogo.actualizadoEn).toLocaleTimeString('es-AR')}. La compra requiere que FAV vuelva a responder para validar el precio.
        </p>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        <label className="flex items-center gap-1">Categoría
          <select value={filtros.categoria} onChange={e => setFiltros({ ...filtros, categoria: e.target.value, pagina: 1 })}
            className="rounded-md border border-outline-variant bg-surface px-2 py-1">
            <option value="">Todas</option>
            {categorias.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1">Talle
          <input value={filtros.talle} onChange={e => setFiltros({ ...filtros, talle: e.target.value.trim(), pagina: 1 })}
            placeholder="M, 38…" className="w-20 rounded-md border border-outline-variant bg-surface px-2 py-1" />
        </label>
      </div>

      {status !== 'listo' ? (
        <div role="status" aria-live="polite" aria-busy={status === 'cargando'} className="rounded-lg bg-surface-container p-4 space-y-2">
          <h3 className="text-sm font-semibold">{status === 'cargando' ? 'Consultando catálogo…' : 'No se pudo consultar la tienda'}</h3>
          <p className="text-xs text-on-surface-variant">{status === 'cargando' ? 'Esperá un momento.' : message}</p>
          {status === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)}
            className="px-3 py-1.5 rounded-md border border-outline-variant text-xs font-semibold hover:bg-surface-container-high">Reintentar consulta</button>}
        </div>
      ) : catalogo && catalogo.items.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No hay productos con stock para estos filtros.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {catalogo?.items.map(producto => (
            <li key={producto.productoId} className="rounded-lg bg-surface-container p-3 space-y-2">
              {producto.fotoUrl && <img src={producto.fotoUrl} alt="" className="h-32 w-full rounded-md object-cover" loading="lazy"
                onError={e => { e.currentTarget.style.display = 'none'; }} />}
              <div>
                <h3 className="text-sm font-semibold">{producto.nombre}</h3>
                <p className="text-xs text-on-surface-variant">{producto.categoria}{producto.descripcion ? ' · ' + producto.descripcion : ''}</p>
              </div>
              <ul className="space-y-1">
                {producto.variantes.map(v => (
                  <li key={v.productoCodigo} className="flex items-center justify-between gap-2 text-xs">
                    <span>{v.talle} · {v.color} · <strong>{pesos(v.precioMinor)}</strong> <span className="text-on-surface-variant">({v.unidadesDisponibles} disp.)</span></span>
                    <button type="button" disabled={!!pendiente} onClick={() => agregar(v, producto.nombre)}
                      className="rounded-md bg-primary px-2 py-1 font-semibold text-on-primary disabled:opacity-50">Agregar</button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {catalogo && catalogo.total > catalogo.tamanio && (
        <div className="flex items-center gap-2 text-xs">
          <button type="button" disabled={filtros.pagina <= 1} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina - 1 })}
            className="rounded-md border border-outline-variant px-2 py-1 disabled:opacity-50">Anterior</button>
          <span>Página {catalogo.pagina} de {Math.ceil(catalogo.total / catalogo.tamanio)}</span>
          <button type="button" disabled={catalogo.pagina * catalogo.tamanio >= catalogo.total} onClick={() => setFiltros({ ...filtros, pagina: filtros.pagina + 1 })}
            className="rounded-md border border-outline-variant px-2 py-1 disabled:opacity-50">Siguiente</button>
        </div>
      )}

      <div className="rounded-lg border border-outline-variant/60 p-3 space-y-2">
        <h3 className="text-sm font-semibold">Carrito</h3>
        {pendiente ? (
          <p className="text-xs">Hay una compra sin confirmar ({pendiente.items.length} variantes). Reintentala para saber si se registró.</p>
        ) : carrito.size === 0 ? <p className="text-xs text-on-surface-variant">Todavía no agregaste productos.</p> : (
          <ul className="space-y-1 text-xs">
            {[...carrito.values()].map(i => (
              <li key={i.variante.productoCodigo} className="flex justify-between gap-2">
                <span>{i.nombre} ({i.variante.talle}, {i.variante.color}) × {i.unidades}</span>
                <span className="flex gap-2">{pesos(i.variante.precioMinor * i.unidades)}
                  <button type="button" onClick={() => quitar(i.variante.productoCodigo)} className="underline">Quitar</button></span>
              </li>
            ))}
            <li className="flex justify-between font-semibold"><span>Total estimado</span><span>{pesos(totalCarrito)}</span></li>
          </ul>
        )}
        {(pendiente || carrito.size > 0) && (
          <button type="button" disabled={comprando} onClick={() => { void confirmar(); }}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary disabled:opacity-50">
            {comprando ? 'Registrando…' : pendiente ? 'Reintentar compra' : 'Comprar'}
          </button>
        )}
        {resultado && <p role="status" className={'text-xs ' + (resultado.tipo === 'ok' ? 'text-primary' : 'text-error')}>{resultado.texto}</p>}
      </div>

      {compras.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Mis compras</h3>
          <ul className="space-y-1 text-xs">
            {compras.map(c => (
              <li key={c.compraId} className="flex justify-between gap-2 rounded-md bg-surface-container p-2">
                <span>{new Date(c.creadaEn).toLocaleString('es-AR')} · {c.items.map(i => `${i.nombre} ×${i.unidades}`).join(', ')}</span>
                <span className="font-semibold">{pesos(c.totalMinor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
