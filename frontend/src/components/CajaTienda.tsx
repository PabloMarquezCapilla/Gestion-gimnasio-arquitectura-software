import { useCallback, useEffect, useRef, useState } from 'react';
import { apiComprasCaja, apiResumenCompras } from '../services/api';
import type { CompraCaja, ResumenComprasAdmin } from '../services/api';

const box = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-surface-container-high';
const pesos = (minor: number) => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

// Compras que los socios hicieron en el portal: se cobran y entregan en el mostrador.
export function CajaTienda() {
  const [items, setItems] = useState<CompraCaja[]>([]);
  const [resumen, setResumen] = useState<ResumenComprasAdmin | null>(null);
  const [pagina, setPagina] = useState(1);
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [mensaje, setMensaje] = useState('');
  const cargaActual = useRef(0);
  const cargar = useCallback(async () => {
    const carga = ++cargaActual.current;
    setEstado('cargando');
    try {
      const [r, total] = await Promise.all([apiComprasCaja(pagina), apiResumenCompras()]);
      if (carga !== cargaActual.current) return;
      setItems(r.items); setResumen(total); setEstado('listo');
    } catch (e) { if (carga === cargaActual.current) { setMensaje(e instanceof Error ? e.message : 'No se pudo consultar la caja de la tienda.'); setEstado('error'); } }
  }, [pagina]);
  useEffect(() => { void cargar(); return () => { cargaActual.current++; }; }, [cargar]);
  return (
    <section className={box}>
      <h2 className="font-bold">Caja de la tienda (compras de socios)</h2>
      {estado === 'cargando' && <p role="status">Consultando caja…</p>}
      {estado === 'listo' && resumen && <p className="text-sm">Hoy en Argentina: <strong>{resumen.hoy.cantidad}</strong> compras por <strong>{pesos(resumen.hoy.importeMinor)}</strong> · Histórico: {resumen.historico.cantidad} compras por {pesos(resumen.historico.importeMinor)}</p>}
      <button className={button} disabled={estado === 'cargando'} onClick={() => void cargar()}>Actualizar caja</button>
      {estado === 'error' && <p role="alert" className="text-error">{mensaje}</p>}
      {estado === 'listo' && items.length === 0 && <p>Todavía no hay compras de socios.</p>}
      {estado === 'listo' && <ul className="space-y-2">
        {items.map(c => (
          <li key={c.compraId} className="rounded-lg bg-surface-container p-3 text-sm flex flex-wrap justify-between gap-2">
            <span>{new Date(c.creadaEn).toLocaleString('es-AR')} · socio <strong>{c.socioId}</strong> · {c.items.map(i => `${i.nombre} (${i.talle}, ${i.color}) ×${i.unidades}`).join(', ')}</span>
            <strong>{pesos(c.totalMinor)}</strong>
          </li>
        ))}
      </ul>}
      {resumen && resumen.historico.cantidad > 50 && <div className="flex gap-2 items-center text-sm">
        <button className={button} disabled={estado === 'cargando' || pagina === 1} onClick={() => setPagina(p => p - 1)}>Anterior</button>
        Página {pagina}
        <button className={button} disabled={estado === 'cargando' || pagina * 50 >= resumen.historico.cantidad} onClick={() => setPagina(p => p + 1)}>Siguiente</button>
      </div>}
    </section>
  );
}
