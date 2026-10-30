import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiAccesosHistorial, apiAccesosOcupacion, apiAccesosRegistrar, apiAccesosSedes } from '../services/api';
import type { AccesosMovimiento, AccesosOrden } from '../services/api';

const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-surface-container-high';
const primaryButton = 'rounded-lg border border-primary px-4 py-2 text-sm font-semibold disabled:opacity-50 bg-primary text-on-primary hover:bg-primary-hover';
const resultLabels: Record<string, string> = {
  INGRESO_REGISTRADO: 'Ingreso registrado', EGRESO_REGISTRADO: 'Egreso registrado',
  INGRESO_YA_ABIERTO: 'Ya tenía un ingreso abierto', SIN_INGRESO_ABIERTO: 'Sin ingreso abierto',
  MEMBRESIA_NO_HABILITADA: 'Membresía no habilitada',
};
type Pendiente = { clave: string; body: AccesosOrden };
const message = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';

export function AccesosPanel({ actorId }: { actorId: string }) {
  const storageKey = 'pulse.accesos.pendiente.' + actorId;
  const [pendiente, setPendiente] = useState<Pendiente | null>(() => {
    try {
      const p = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null');
      return p && typeof p.clave === 'string' && typeof p.body?.sedeId === 'string' && typeof p.body?.socioId === 'string'
        && ['INGRESO', 'EGRESO'].includes(p.body?.tipo) ? p : null;
    } catch { return null; }
  });
  const [sedes, setSedes] = useState<{ sedeId: string; nombre: string }[]>([]);
  const [sedeId, setSedeId] = useState(pendiente?.body.sedeId ?? '');
  const [socioId, setSocioId] = useState(pendiente?.body.socioId ?? '');
  const [tipo, setTipo] = useState<AccesosOrden['tipo']>(pendiente?.body.tipo ?? 'INGRESO');
  const [ocupacion, setOcupacion] = useState<{ ocupacion: number; consultadoEn: string } | null>(null);
  const [historial, setHistorial] = useState<AccesosMovimiento[]>([]);
  const [pagina, setPagina] = useState(1);
  const [filtro, setFiltro] = useState('');
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const generation = useRef(0); const mounted = useRef(true); const mutation = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => {
    let active = true;
    apiAccesosSedes().then(data => { if (active) { setSedes(data.items); setSedeId(previous => previous || data.items[0]?.sedeId || ''); } })
      .catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, []);
  const refresh = useCallback(async () => {
    if (!sedeId) return;
    const current = ++generation.current;
    setLoading(true); setError(''); setOcupacion(null); setHistorial([]);
    try {
      const [o, h] = await Promise.all([apiAccesosOcupacion(sedeId), apiAccesosHistorial(sedeId, pagina, filtro.trim())]);
      if (mounted.current && current === generation.current) { setOcupacion(o); setHistorial(h.items); }
    } catch (cause) { if (mounted.current && current === generation.current) setError(message(cause)); }
    finally { if (mounted.current && current === generation.current) setLoading(false); }
  }, [sedeId, pagina, filtro]);
  useEffect(() => { void refresh(); }, [refresh]);
  const registrar = async () => {
    if (mutation.current || !sedeId || !socioId.trim()) return;
    mutation.current = true; setSaving(true); setNotice(''); setError('');
    const op = pendiente ?? { clave: crypto.randomUUID(), body: { sedeId, socioId: socioId.trim(), tipo } };
    try {
      // Guardar ANTES del HTTP. Si no se puede conservar, no enviar una escritura incierta.
      sessionStorage.setItem(storageKey, JSON.stringify(op)); setPendiente(op);
      await apiAccesosRegistrar(op.body, op.clave);
      sessionStorage.removeItem(storageKey); setPendiente(null);
      if (mounted.current) setNotice(op.body.tipo === 'INGRESO' ? 'Ingreso registrado.' : 'Egreso registrado.');
      await refresh();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) {
        // Rechazo definitivo. 401 conserva la operación para retomar tras iniciar sesión.
        if (cause.status !== 401) { sessionStorage.removeItem(storageKey); setPendiente(null); }
        if (['INGRESO_YA_ABIERTO', 'SIN_INGRESO_ABIERTO', 'MEMBRESIA_NO_HABILITADA'].includes(cause.codigo ?? '')) await refresh();
      }
      if (mounted.current) setError(message(cause));
    } finally { mutation.current = false; if (mounted.current) setSaving(false); }
  };
  return <section className="py-6 space-y-5" aria-labelledby="accesos-heading">
    <h1 id="accesos-heading" className="font-headline text-2xl font-bold">Recepción y Ocupación</h1>
    <p className="text-sm text-on-surface-variant">Registrá ingresos y egresos por socio y sede. El ingreso requiere una membresía habilitada; el egreso cierra una presencia abierta.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label>Sede<select aria-label="Sede" value={sedeId} disabled={saving || !!pendiente} onChange={e => { setSedeId(e.target.value); setPagina(1); }} className="block bg-surface-container border border-outline-variant rounded-lg p-2">
        {sedes.map(s => <option key={s.sedeId} value={s.sedeId}>{s.nombre}</option>)}
      </select></label>
      <button type="button" className={button} disabled={loading || saving || !sedeId} onClick={() => void refresh()}>Actualizar</button>
      <div role="status">{loading ? 'Consultando ocupación…' : ocupacion ? <><strong className="text-primary text-2xl">{ocupacion.ocupacion}</strong> {ocupacion.ocupacion === 1 ? 'persona' : 'personas'} · {new Date(ocupacion.consultadoEn).toLocaleTimeString('es-AR')}</> : 'Ocupación no disponible'}</div>
    </div>
    <form onSubmit={e => { e.preventDefault(); void registrar(); }} className="rounded-xl border border-outline-variant p-4 flex flex-wrap items-end gap-3">
      <label>ID de socio<input aria-label="ID de socio" required pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,99}" value={socioId} disabled={saving || !!pendiente} onChange={e => setSocioId(e.target.value)} className="block bg-surface-container rounded-lg border border-outline-variant p-2" /></label>
      <label>Movimiento<select aria-label="Movimiento" value={tipo} disabled={saving || !!pendiente} onChange={e => setTipo(e.target.value as AccesosOrden['tipo'])} className="block bg-surface-container rounded-lg border border-outline-variant p-2"><option value="INGRESO">Ingreso</option><option value="EGRESO">Egreso</option></select></label>
      <button className={primaryButton} disabled={saving || !sedeId || !socioId.trim()}>{saving ? 'Registrando…' : pendiente ? 'Reintentar la misma operación' : 'Registrar movimiento'}</button>
    </form>
    {pendiente && <p role="status" className="text-sm">La operación se conserva hasta conocer el resultado. El reintento usa la misma clave y los mismos datos, incluso tras recargar y volver a iniciar sesión.</p>}
    {notice && <p role="status" className="text-secondary">{notice}</p>}
    {error && <p role="alert" className="text-error">{error}</p>}
    <div className="flex flex-wrap items-end gap-3"><h2 className="font-bold text-lg">Historial de movimientos</h2>
      <label>Filtrar por ID de socio<input aria-label="Filtrar por ID de socio" value={filtro} disabled={saving} onChange={e => { setFiltro(e.target.value); setPagina(1); }} className="block bg-surface-container rounded-lg border border-outline-variant p-2" /></label>
    </div>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['Fecha', 'Socio', 'Tipo', 'Resultado'].map(label => <th key={label} className="text-left p-2">{label}</th>)}</tr></thead>
      <tbody>{historial.map(m => <tr key={m.movimientoId} className="border-t border-outline-variant"><td className="p-2">{new Date(m.fecha).toLocaleString('es-AR')}</td><td>{m.socioId}</td><td>{m.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'}</td><td>{m.aceptado ? 'Aceptado' : 'Rechazado'} · {resultLabels[m.codigo] ?? 'Resultado desconocido'}</td></tr>)}</tbody></table></div>
    {!loading && !error && !historial.length && <p>No hay movimientos para esta consulta.</p>}
    <div className="flex items-center gap-3"><button className={button} disabled={loading || saving || pagina === 1} onClick={() => setPagina(p => p - 1)}>Anterior</button><span>Página {pagina}</span><button className={button} disabled={loading || saving || historial.length < 20} onClick={() => setPagina(p => p + 1)}>Siguiente</button></div>
  </section>;
}
