import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiAccesosSedes, apiBuscarClases, apiGuardarClase, apiObtenerClaseAdmin, validarOperacionClase } from '../services/api';
import type { ClaseAdministrada, ClaseCatalogo, DatosPublicacionClase, OperacionClasePendiente } from '../services/api';

const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm disabled:opacity-50';
const primary = button + ' bg-primary text-on-primary font-bold';
const input = 'block w-full rounded-lg border border-outline-variant bg-surface-container p-2';
const inicial = { nombre: '', actividad: '', profesor: '', sedeId: '', inicio: '', fin: '', capacidad: '' };
const mensaje = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
function fechaLocal(iso: string) {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function formulario(datos: Omit<DatosPublicacionClase, 'actividad' | 'profesor'> & { actividad: string | null; profesor: string | null }) {
  return { nombre: datos.nombre, actividad: datos.actividad ?? '', profesor: datos.profesor ?? '', sedeId: datos.sedeId,
    inicio: fechaLocal(datos.inicio), fin: fechaLocal(datos.fin), capacidad: String(datos.capacidad) };
}
function recuperar(storageKey: string) {
  try {
    const raw = sessionStorage.getItem(storageKey);
    return { operacion: raw === null ? null : validarOperacionClase(JSON.parse(raw)), error: '' };
  } catch {
    return { operacion: null, error: 'No se pudo recuperar la operación guardada en esta pestaña. Revisá su estado antes de iniciar otra publicación o edición.' };
  }
}
function retirar(storageKey: string, operacion: OperacionClasePendiente) {
  const raw = sessionStorage.getItem(storageKey);
  if (raw === null || JSON.stringify(validarOperacionClase(JSON.parse(raw))) !== JSON.stringify(operacion)) {
    throw new Error('El registro local cambió. Volvé a abrir esta sección para recuperar la operación actual.');
  }
  sessionStorage.removeItem(storageKey);
}

export function ClasesPanel({ actorId }: { actorId: string }) {
  const storageKey = 'pulse-clases-pendiente:' + actorId;
  const [recuperada] = useState(() => recuperar(storageKey));
  const [pendiente, setPendiente] = useState(recuperada.operacion);
  const [storageError, setStorageError] = useState(recuperada.error);
  const [form, setForm] = useState(() => recuperada.operacion ? formulario(recuperada.operacion.datos) : inicial);
  const [seleccionada, setSeleccionada] = useState<ClaseAdministrada | null>(null);
  const [sedes, setSedes] = useState<{ sedeId: string; nombre: string }[]>([]);
  const [sedesError, setSedesError] = useState('');
  const [items, setItems] = useState<ClaseCatalogo[]>([]);
  const [texto, setTexto] = useState('');
  const [consulta, setConsulta] = useState({ texto: '', pagina: 1 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [resultado, setResultado] = useState('');
  const alive = useRef(false), mutation = useRef(false);
  const epoch = useRef(0), reads = useRef(0), details = useRef(0), sedesReads = useRef(0);

  useEffect(() => {
    alive.current = true;
    epoch.current++;
    return () => { alive.current = false; epoch.current++; reads.current++; details.current++; sedesReads.current++; };
  }, []);
  const cargarSedes = useCallback(async () => {
    const id = ++sedesReads.current;
    try {
      const data = await apiAccesosSedes();
      if (alive.current && id === sedesReads.current) { setSedes(data.items); setSedesError(''); }
    } catch (cause) { if (alive.current && id === sedesReads.current) setSedesError(mensaje(cause)); }
  }, []);
  useEffect(() => { void cargarSedes(); }, [cargarSedes]);
  const refresh = useCallback(async () => {
    const id = ++reads.current;
    setLoading(true);
    setError('');
    try {
      const data = await apiBuscarClases({ ...(consulta.texto ? { texto: consulta.texto } : {}), pagina: consulta.pagina, tamanio: 20 });
      if (alive.current && id === reads.current) { setItems(data.items); setTotal(data.total); }
    } catch (cause) { if (alive.current && id === reads.current) setError(mensaje(cause)); }
    finally { if (alive.current && id === reads.current) setLoading(false); }
  }, [consulta]);
  useEffect(() => { void refresh(); }, [refresh]);

  const editar = async (claseId: string) => {
    if (mutation.current || pendiente || storageError) return;
    const id = ++details.current;
    setDetailLoading(true); setSaveError(''); setResultado('');
    try {
      const clase = await apiObtenerClaseAdmin(claseId);
      if (alive.current && id === details.current) { setSeleccionada(clase); setForm(formulario(clase)); }
    } catch (cause) { if (alive.current && id === details.current) setSaveError(mensaje(cause)); }
    finally { if (alive.current && id === details.current) setDetailLoading(false); }
  };
  const guardar = async () => {
    if (!alive.current || mutation.current || storageError || detailLoading) return;
    let op: OperacionClasePendiente;
    try {
      op = pendiente ?? validarOperacionClase({ clave: crypto.randomUUID(), claseId: seleccionada?.claseId ?? null,
        datos: { ...form,
          inicio: seleccionada && form.inicio === fechaLocal(seleccionada.inicio) ? seleccionada.inicio : new Date(form.inicio).toISOString(),
          fin: seleccionada && form.fin === fechaLocal(seleccionada.fin) ? seleccionada.fin : new Date(form.fin).toISOString(), capacidad: Number(form.capacidad),
          ...(seleccionada ? { versionEsperada: seleccionada.version } : {}) } });
    } catch { setSaveError('Completá todos los campos, revisá las fechas y usá una capacidad entera positiva.'); return; }
    const actual = epoch.current;
    const esActual = () => alive.current && epoch.current === actual;
    mutation.current = true;
    setSaving(true); setSaveError(''); setResultado('');
    let enviada = false;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(op));
      setPendiente(op); enviada = true;
      const clase = await apiGuardarClase(op);
      if (!esActual()) return;
      setResultado(op.claseId === null ? 'Clase publicada. Ya puede encontrarse en el catálogo.' : 'Cambios de la clase guardados.');
      setSeleccionada(clase); setForm(formulario(clase));
      try { retirar(storageKey, op); setPendiente(null); }
      catch (cause) { setStorageError(mensaje(cause)); return; }
      await refresh();
    } catch (cause) {
      if (!esActual()) return;
      if (!enviada) {
        setStorageError('No se pudo guardar la operación en esta pestaña. Habilitá el almacenamiento y volvé a abrir la sección.');
        return;
      }
      // Estos rechazos se emiten antes del commit. Una operación ya aplicada
      // recupera su respuesta guardada, incluso si cambiaron fecha o versión.
      if (cause instanceof ApiError && [400, 404, 409, 422].includes(cause.status) && [
        'PARAMETROS_INVALIDOS', 'IDEMPOTENCIA_INVALIDA', 'FECHAS_INVALIDAS', 'CLASE_NO_ENCONTRADA',
        'CLASE_INICIADA', 'CLASE_CON_INSCRIPTOS', 'VERSION_CONFLICTO', 'VERSION_AGOTADA', 'SEDE_NO_ENCONTRADA',
      ].includes(cause.codigo ?? '')) {
        try { retirar(storageKey, op); setPendiente(null); }
        catch (storageCause) { setStorageError(mensaje(storageCause)); }
      }
      setSaveError(mensaje(cause));
    } finally {
      mutation.current = false;
      if (esActual()) setSaving(false);
    }
  };
  const disabled = saving || detailLoading || !!pendiente || !!storageError;
  const nueva = () => { details.current++; setSeleccionada(null); setForm(inicial); setSaveError(''); setResultado(''); };
  return <section className="py-6 space-y-5" aria-labelledby="clases-admin-heading">
    <h1 id="clases-admin-heading" className="font-headline text-2xl font-bold">Clases y turnos</h1>
    <p className="text-sm text-on-surface-variant">Publicá clases futuras y editá sus datos antes del inicio, siempre que no tengan reservas confirmadas ni personas en espera.</p>
    <form onSubmit={event => { event.preventDefault(); void guardar(); }} className="rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold">{pendiente ? 'Operación pendiente de confirmar' : seleccionada ? 'Editar clase' : 'Publicar clase'}</h2>
        <button type="button" className={button} disabled={disabled} onClick={nueva}>Nueva clase</button>
      </div>
      {seleccionada && <p className="text-xs text-on-surface-variant">{seleccionada.nombre} · versión {seleccionada.version}</p>}
      <fieldset disabled={disabled} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
        {(['nombre', 'actividad', 'profesor'] as const).map(campo => <label key={campo}>
          {{ nombre: 'Nombre de la clase', actividad: 'Actividad', profesor: 'Profesor' }[campo]}
          <input aria-label={{ nombre: 'Nombre de la clase', actividad: 'Actividad', profesor: 'Profesor' }[campo]} className={input} required value={form[campo]}
            onChange={event => setForm({ ...form, [campo]: event.target.value })} />
        </label>)}
        <label>Sede<select aria-label="Sede de la clase" className={input} required value={form.sedeId} onChange={event => setForm({ ...form, sedeId: event.target.value })}>
          <option value="">Seleccioná una sede</option>
          {form.sedeId && !sedes.some(sede => sede.sedeId === form.sedeId) && <option value={form.sedeId}>{form.sedeId} · pendiente de validar</option>}
          {sedes.map(sede => <option key={sede.sedeId} value={sede.sedeId}>{sede.nombre} · {sede.sedeId}</option>)}
        </select></label>
        <label>Inicio<input aria-label="Inicio de la clase" className={input} type="datetime-local" required value={form.inicio} onChange={event => setForm({ ...form, inicio: event.target.value })} /></label>
        <label>Fin<input aria-label="Fin de la clase" className={input} type="datetime-local" required value={form.fin} onChange={event => setForm({ ...form, fin: event.target.value })} /></label>
        <label>Capacidad<input aria-label="Capacidad de la clase" className={input} type="number" required min="1" max="2147483647" step="1" value={form.capacidad} onChange={event => setForm({ ...form, capacidad: event.target.value })} /></label>
      </fieldset>
      <p className="text-xs text-on-surface-variant">Fechas y horas de tu equipo. Al publicar, la clase queda disponible para los socios.</p>
      {detailLoading && <p role="status">Consultando datos actuales de la clase…</p>}
      <div className="flex flex-wrap gap-3 items-center">
        <button type="submit" className={primary} disabled={saving || detailLoading || !!storageError || (!pendiente && (!!sedesError || !sedes.some(sede => sede.sedeId === form.sedeId)))}>
          {saving ? 'Guardando…' : pendiente ? 'Reintentar la misma operación' : seleccionada ? 'Guardar cambios' : 'Publicar clase'}
        </button>
        <button type="button" className={button} disabled={saving} onClick={() => void cargarSedes()}>Actualizar sedes</button>
      </div>
      {pendiente && <p role="status" className="text-sm">Conservamos los datos enviados. Reintentar recupera el resultado de esa operación.</p>}
      {storageError && <p role="alert" className="text-error">{storageError}</p>}
      {sedesError && <p role="alert" className="text-error">No se pudieron actualizar las sedes. {sedesError}</p>}
      {saveError && <p role="alert" className="text-error">{saveError}</p>}
      {resultado && <p role="status" className="text-secondary">{resultado}</p>}
    </form>
    <form className="flex flex-wrap gap-3 items-end" onSubmit={event => { event.preventDefault(); if (mutation.current) return; setLoading(true); setConsulta({ texto: texto.trim(), pagina: 1 }); }}>
      <label className="text-sm">Buscar clases publicadas<input aria-label="Buscar clases para administrar" className={input} value={texto} onChange={event => setTexto(event.target.value)} /></label>
      <button type="submit" className={button} disabled={saving}>Buscar clases</button>
      <button type="button" className={button} disabled={loading || saving} onClick={() => void refresh()}>Actualizar clases</button>
    </form>
    {loading && <p role="status">Consultando clases…</p>}
    {error && <p role="alert" className="text-error">{error}</p>}
    {!loading && !error && <>
      <p role="status" className="text-sm">{total} clases futuras · Página {consulta.pagina} de {Math.max(1, Math.ceil(total / 20))}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>
        {['Clase', 'Profesor', 'Sede', 'Inicio', 'Capacidad', 'Acción'].map(label => <th className="text-left p-2" key={label}>{label}</th>)}
      </tr></thead><tbody>{items.map(clase => <tr key={clase.claseId} className="border-t border-outline-variant">
        <td className="p-2">{clase.nombre}<span className="block text-xs text-on-surface-variant">{clase.actividad ?? 'Actividad sin informar'}</span></td>
        <td className="p-2">{clase.profesor ?? 'Sin informar'}</td><td className="p-2">{clase.sedeId}</td>
        <td className="p-2">{new Date(clase.inicio).toLocaleString('es-AR', { hour12: false })}</td><td className="p-2">{clase.capacidad}</td>
        <td className="p-2"><button type="button" className={button} disabled={disabled} aria-label={'Editar ' + clase.nombre} onClick={() => void editar(clase.claseId)}>Editar</button></td>
      </tr>)}</tbody></table></div>
      {!items.length && <p>No hay clases futuras para esta búsqueda.</p>}
      <nav aria-label="Páginas de administración de clases" className="flex gap-3">
        <button type="button" className={button} disabled={saving || consulta.pagina <= 1} onClick={() => { setLoading(true); setConsulta({ ...consulta, pagina: consulta.pagina - 1 }); }}>Anterior</button>
        <button type="button" className={button} disabled={saving || consulta.pagina * 20 >= total || consulta.pagina >= 1000000} onClick={() => { setLoading(true); setConsulta({ ...consulta, pagina: consulta.pagina + 1 }); }}>Siguiente</button>
      </nav>
    </>}
  </section>;
}
