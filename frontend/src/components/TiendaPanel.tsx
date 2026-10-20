import { useEffect, useState } from 'react';
import { ApiError, apiConsultarTienda } from '../services/api';

export function TiendaPanel() {
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'cargando' | 'pendiente' | 'error'>('cargando');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    setStatus('cargando');
    setMessage('');
    apiConsultarTienda().catch((error: unknown) => {
      if (!active) return;
      setStatus(error instanceof ApiError && error.codigo === 'INTEGRACION_PENDIENTE' ? 'pendiente' : 'error');
      setMessage(error instanceof Error ? error.message : 'No se pudo consultar la tienda.');
    });
    return () => { active = false; };
  }, [attempt]);

  return (
    <section aria-labelledby="tienda-heading" className="rounded-xl border border-outline-variant/60 bg-surface-container-low p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary" aria-hidden="true">storefront</span>
        <h2 id="tienda-heading" className="font-headline font-bold">Tienda</h2>
      </div>
      <p className="text-xs text-on-surface-variant">Consulta de productos y stock de la distribuidora.</p>
      <div role="status" aria-live="polite" aria-busy={status === 'cargando'} className="rounded-lg bg-surface-container p-4 space-y-2">
        <h3 className="text-sm font-semibold">{status === 'cargando' ? 'Consultando disponibilidad…'
          : status === 'pendiente' ? 'Tienda pendiente de habilitación' : 'No se pudo consultar la tienda'}</h3>
        <p className="text-xs text-on-surface-variant">{status === 'cargando' ? 'Esperá un momento.' : message}</p>
        {status === 'pendiente' && <p className="text-xs text-on-surface-variant">Los productos y sus existencias se mostrarán cuando la consulta esté disponible.</p>}
      </div>
      {status === 'error' && <button type="button" onClick={() => setAttempt(value => value + 1)}
        className="px-3 py-1.5 rounded-md border border-outline-variant text-xs font-semibold hover:bg-surface-container-high">Reintentar consulta</button>}
    </section>
  );
}
