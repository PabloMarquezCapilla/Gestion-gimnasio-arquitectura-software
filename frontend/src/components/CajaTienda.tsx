import { useCallback, useEffect, useState } from 'react';
import { apiComprasCaja } from '../services/api';
import type { CompraCaja } from '../services/api';

const box = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-surface-container-high';
const pesos = (minor: number) => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

// Compras que los socios hicieron en el portal: se cobran y entregan en el mostrador.
export function CajaTienda() {
  const [items, setItems] = useState<CompraCaja[]>([]);
  const [resumen, setResumen] = useState({ total: 0, totalMinor: 0 });
  const [pagina, setPagina] = useState(1);
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'error'>('cargando');
  const [mensaje, setMensaje] = useState('');
  const cargar = useCallback(async () => {
    setEstado('cargando');
    try {
      const r = await apiComprasCaja(pagina);
      setItems(r.items); setResumen({ total: r.total, totalMinor: r.totalMinor }); setEstado('listo');
    } catch (e) { setMensaje(e instanceof Error ? e.message : 'No se pudo consultar la caja de la tienda.'); setEstado('error'); }
  }, [pagina]);
  useEffect(() => { void cargar(); }, [cargar]);
  const hoy = new Date().toDateString();
  const deHoy = items.filter(c => new Date(c.creadaEn).toDateString() === hoy);
  return (
    <section className={box}>
      <h2 className="font-bold">Caja de la tienda (compras de socios)</h2>
      <p className="text-sm">Hoy: <strong>{deHoy.length}</strong> compras por <strong>{pesos(deHoy.reduce((t, c) => t + c.totalMinor, 0))}</strong> · Histórico: {resumen.total} compras por {pesos(resumen.totalMinor)}</p>
      <button className={button} disabled={estado === 'cargando'} onClick={() => void cargar()}>Actualizar caja</button>
      {estado === 'error' && <p role="alert" className="text-error">{mensaje}</p>}
      {estado === 'listo' && items.length === 0 && <p>Todavía no hay compras de socios.</p>}
      <ul className="space-y-2">
        {items.map(c => (
          <li key={c.compraId} className="rounded-lg bg-surface-container p-3 text-sm flex flex-wrap justify-between gap-2">
            <span>{new Date(c.creadaEn).toLocaleString('es-AR')} · socio <strong>{c.socioId}</strong> · {c.items.map(i => `${i.nombre} (${i.talle}, ${i.color}) ×${i.unidades}`).join(', ')}</span>
            <strong>{pesos(c.totalMinor)}</strong>
          </li>
        ))}
      </ul>
      {resumen.total > 50 && <div className="flex gap-2 items-center text-sm">
        <button className={button} disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>Anterior</button>
        Página {pagina}
        <button className={button} disabled={pagina * 50 >= resumen.total} onClick={() => setPagina(p => p + 1)}>Siguiente</button>
      </div>}
    </section>
  );
}
