import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ApiError, apiCarCrudsBuscarSocios, apiCarCrudsEmpleados, apiCarCrudsEstado, apiCarCrudsGuardarVinculo,
  apiCarCrudsHistorial, apiCarCrudsVinculo, apiCarCrudsVinculos,
} from '../services/api';
import type { CarCrudsEmpleado, CarCrudsEstado, CarCrudsHistorial, CarCrudsPagina, CarCrudsVinculo, SocioPublico } from '../services/api';
import { CarCrudsFotografias } from './CarCrudsFotografias';

const button = 'rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
const primaryButton = button + ' bg-primary text-on-primary hover:bg-primary-hover';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la consulta.';
const formatDate = (value: string) => new Date(value).toLocaleString('es-AR');

function Pagination({ page, pageSize, total, disabled, onChange }: {
  page: number; pageSize: number; total: number; disabled: boolean; onChange: (page: number) => void;
}) {
  return <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-on-surface-variant">
    <span>Página {page} · {total} registro{total === 1 ? '' : 's'}</span>
    <div className="flex gap-2">
      <button type="button" className={button} disabled={disabled || page <= 1} onClick={() => onChange(page - 1)}>Anterior</button>
      <button type="button" className={button} disabled={disabled || page * pageSize >= total} onClick={() => onChange(page + 1)}>Siguiente</button>
    </div>
  </div>;
}

export function CarCrudsPanel({ onNuevoSocio }: { onNuevoSocio: () => void }) {
  const [tab, setTab] = useState<'empleados' | 'vinculos'>('empleados');
  const [employeePage, setEmployeePage] = useState(1);
  const [linkPage, setLinkPage] = useState(1);
  const [employeeReload, setEmployeeReload] = useState(0);
  const [linkReload, setLinkReload] = useState(0);
  const [detailReload, setDetailReload] = useState(0);
  const [employees, setEmployees] = useState<CarCrudsPagina<CarCrudsEmpleado> | null>(null);
  const [links, setLinks] = useState<CarCrudsPagina<CarCrudsVinculo> | null>(null);
  const [employeesError, setEmployeesError] = useState('');
  const [linksError, setLinksError] = useState('');
  const [employeesLoading, setEmployeesLoading] = useState(false);
  const [linksLoading, setLinksLoading] = useState(false);
  const [selected, setSelected] = useState<{ employeeId: string; displayName?: string } | null>(null);
  const employeeId = selected?.employeeId;
  const [link, setLink] = useState<CarCrudsVinculo | null>(null);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState('');
  const [history, setHistory] = useState<CarCrudsHistorial[] | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState<CarCrudsEstado | null>(null);
  const [statusError, setStatusError] = useState('');
  const [statusLoading, setStatusLoading] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [searchResults, setSearchResults] = useState<SocioPublico[] | null>(null);
  const [searchError, setSearchError] = useState('');
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<SocioPublico | null>(null);
  const [confirmation, setConfirmation] = useState<'vincular' | 'quitar' | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [success, setSuccess] = useState('');
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [fotografiasBusy, setFotografiasBusy] = useState(false);
  const mounted = useRef(false);
  const busy = saving || searching || fotografiasBusy;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Cada consulta descarta respuestas de páginas o selecciones anteriores.
  useEffect(() => {
    let current = true;
    setEmployeesLoading(true); setEmployeesError(''); setEmployees(null);
    apiCarCrudsEmpleados(employeePage).then(data => { if (current) setEmployees(data); })
      .catch(error => { if (current) setEmployeesError(errorMessage(error)); })
      .finally(() => { if (current) setEmployeesLoading(false); });
    return () => { current = false; };
  }, [employeePage, employeeReload]);

  useEffect(() => {
    let current = true;
    setLinksLoading(true); setLinksError(''); setLinks(null);
    apiCarCrudsVinculos(linkPage).then(data => { if (current) setLinks(data); })
      .catch(error => { if (current) setLinksError(errorMessage(error)); })
      .finally(() => { if (current) setLinksLoading(false); });
    return () => { current = false; };
  }, [linkPage, linkReload]);

  useEffect(() => {
    setIdentifier(''); setSearchResults(null); setChosen(null); setConfirmation(null);
    setSearchError(''); setSaveError(''); setSuccess(''); setNeedsRefresh(false);
  }, [employeeId]);

  useEffect(() => {
    let current = true;
    setLink(null); setHistory(null); setLinkError(''); setHistoryError('');
    if (!employeeId) { setLinkLoading(false); return; }
    setLinkLoading(true);
    apiCarCrudsVinculo(employeeId).then(data => {
      if (current) { setLink(data); setNeedsRefresh(false); }
    }).catch(error => { if (current) setLinkError(errorMessage(error)); })
      .finally(() => { if (current) setLinkLoading(false); });
    apiCarCrudsHistorial(employeeId).then(data => { if (current) setHistory(data.items); })
      .catch(error => { if (current) setHistoryError(errorMessage(error)); });
    return () => { current = false; };
  }, [employeeId, detailReload]);

  // La indisponibilidad externa no invalida el vínculo o su historial local.
  useEffect(() => {
    let current = true;
    setEmploymentStatus(null); setStatusError('');
    if (!employeeId) { setStatusLoading(false); return; }
    setStatusLoading(true);
    apiCarCrudsEstado(employeeId).then(data => { if (current) setEmploymentStatus(data); })
      .catch(error => { if (current) setStatusError(errorMessage(error)); })
      .finally(() => { if (current) setStatusLoading(false); });
    return () => { current = false; };
  }, [employeeId, detailReload]);

  const selectEmployee = (employee: { employeeId: string; displayName?: string }) => {
    if (busy) return;
    setSelected(employee);
    setConfirmation(null);
  };

  const searchSocio = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!identifier.trim() || busy || !employeeId) return;
    setSearching(true); setSearchError(''); setSearchResults(null); setChosen(null); setConfirmation(null);
    try {
      const data = await apiCarCrudsBuscarSocios(identifier);
      if (mounted.current) setSearchResults(data.items);
    } catch (error) { if (mounted.current) setSearchError(errorMessage(error)); }
    finally { if (mounted.current) setSearching(false); }
  };

  const saveLink = async () => {
    if (!link || !employeeId || !confirmation || busy || needsRefresh || (confirmation === 'vincular' && !chosen)) return;
    const removing = confirmation === 'quitar';
    setSaving(true); setSaveError(''); setSuccess('');
    try {
      const result = await apiCarCrudsGuardarVinculo(employeeId, removing ? null : chosen!.socioId, link.version);
      if (!mounted.current) return;
      setLink(result); setConfirmation(null); setChosen(null); setSearchResults(null);
      setSuccess(removing ? 'Vínculo eliminado. La membresía no se modificó.' : 'Vínculo guardado. La membresía no se modificó.');
      setDetailReload(value => value + 1); setLinkReload(value => value + 1);
    } catch (error) {
      if (!mounted.current) return;
      setSaveError(errorMessage(error)); setConfirmation(null);
      if (error instanceof ApiError && (error.codigo === 'VINCULO_DESACTUALIZADO' || error.status === 0 || error.status >= 500)) {
        setNeedsRefresh(true); setChosen(null);
      }
    } finally { if (mounted.current) setSaving(false); }
  };

  const refreshDetail = () => {
    setChosen(null); setConfirmation(null); setSaveError(''); setSuccess('');
    setDetailReload(value => value + 1);
  };

  return <section className="py-6 space-y-5" aria-labelledby="car-cruds-heading">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="max-w-3xl space-y-2">
        <h1 id="car-cruds-heading" className="font-headline text-2xl font-bold">Empleados Car Cruds</h1>
        <p className="text-sm text-on-surface-variant">Asociá cada empleado con un único socio del gimnasio. La vinculación es manual y no habilita ni cancela membresías.</p>
      </div>
      <button type="button" className={primaryButton} disabled={busy} onClick={onNuevoSocio}>Alta de socio</button>
    </div>
    <p className="text-xs text-on-surface-variant">Para una persona nueva, primero completá el alta; después buscala por DNI o email y confirmá el vínculo. El plan y el pago se gestionan por separado.</p>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4">
        <div className="flex flex-wrap gap-2 mb-4" aria-label="Origen del listado">
          <button type="button" aria-pressed={tab === 'empleados'} disabled={busy} className={tab === 'empleados' ? primaryButton : button} onClick={() => setTab('empleados')}>Empleados</button>
          <button type="button" aria-pressed={tab === 'vinculos'} disabled={busy} className={tab === 'vinculos' ? primaryButton : button} onClick={() => setTab('vinculos')}>Vínculos existentes</button>
        </div>
        {tab === 'empleados' ? <>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-bold">Empleados activos del proveedor</h2>
            <button type="button" className={button} disabled={busy || employeesLoading} onClick={() => setEmployeeReload(value => value + 1)}>Actualizar</button>
          </div>
          <p className="text-xs text-on-surface-variant mb-3">Que una persona no aparezca en esta página no demuestra una baja laboral.</p>
          {employeesLoading && <p role="status" className="text-sm">Consultando empleados…</p>}
          {employeesError && <div role="alert" className="text-sm text-error space-y-2"><p>{employeesError}</p><p>Podés consultar los vínculos existentes aunque Car Cruds no esté disponible.</p></div>}
          {employees && <>
            {employees.items.length === 0 && <p className="text-sm text-on-surface-variant">No se recibieron empleados en esta página.</p>}
            <ul className="space-y-2">
              {employees.items.map(employee => <li key={employee.employeeId}>
                <button type="button" disabled={busy} aria-pressed={employeeId === employee.employeeId} onClick={() => selectEmployee(employee)} className={button + ' w-full text-left ' + (employeeId === employee.employeeId ? 'border-primary bg-surface-container-high' : '')}>
                  <span className="block">{employee.displayName}</span><span className="block text-xs font-mono text-on-surface-variant break-all">{employee.employeeId}</span>
                </button>
              </li>)}
            </ul>
            <Pagination {...employees} disabled={busy || employeesLoading} onChange={setEmployeePage} />
          </>}
        </> : <>
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-bold">Relaciones guardadas en el gimnasio</h2>
            <button type="button" className={button} disabled={busy || linksLoading} onClick={() => setLinkReload(value => value + 1)}>Actualizar</button>
          </div>
          {linksLoading && <p role="status" className="text-sm">Consultando vínculos locales…</p>}
          {linksError && <p role="alert" className="text-sm text-error">{linksError}</p>}
          {links && <>
            {links.items.length === 0 && <p className="text-sm text-on-surface-variant">No hay vínculos en esta página.</p>}
            <ul className="space-y-2">
              {links.items.map(item => <li key={item.employeeId}>
                <button type="button" disabled={busy} aria-pressed={employeeId === item.employeeId} onClick={() => selectEmployee({ employeeId: item.employeeId })} className={button + ' w-full text-left ' + (employeeId === item.employeeId ? 'border-primary bg-surface-container-high' : '')}>
                  <span className="block text-xs font-mono break-all">Empleado: {item.employeeId}</span>
                  <span className="block text-xs font-mono text-on-surface-variant break-all">Socio: {item.socioId ?? 'Sin vínculo actual'}</span>
                </button>
              </li>)}
            </ul>
            <Pagination {...links} disabled={busy || linksLoading} onChange={setLinkPage} />
          </>}
        </>}
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-5">
        {!selected ? <p className="text-sm text-on-surface-variant">Seleccioná un empleado o un vínculo existente para administrarlo y ver su historial.</p> : <>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-bold">{selected.displayName ?? 'Empleado seleccionado'}</h2>
              <button type="button" className={button} disabled={busy || linkLoading} onClick={refreshDetail}>Actualizar vínculo y estado</button>
            </div>
            <p className="text-xs font-mono break-all">Empleado: {selected.employeeId}</p>
            <p className="text-sm">Estado laboral: {statusLoading ? 'consultando…' : employmentStatus ? (employmentStatus.active ? 'Activo' : 'Inactivo') : 'Desconocido'}</p>
            {statusError && <p role="alert" className="text-xs text-error">No se pudo verificar el estado laboral: {statusError}</p>}
            <p className="text-xs text-on-surface-variant">El estado laboral es informativo y no modifica la membresía.</p>
          </div>
          {linkLoading && <p role="status" className="text-sm">Consultando vínculo…</p>}
          {linkError && <p role="alert" className="text-sm text-error">{linkError}</p>}
          {saveError && <p role="alert" className="text-sm text-error">{saveError}</p>}
          {success && <p role="status" className="text-sm text-secondary">{success}</p>}
          {needsRefresh && <p role="alert" className="text-sm text-error">Actualizá el vínculo y revisá los datos antes de volver a confirmar. Otra operación puede haber cambiado la relación.</p>}
          {link && <>
            <div className="rounded-lg border border-outline-variant bg-surface-container p-3 space-y-2">
              <h3 className="font-semibold text-sm">Vínculo actual</h3>
              <p className="text-sm font-mono break-all">{link.socioId ? `Socio: ${link.socioId}` : 'Sin socio vinculado'}</p>
              <p className="text-xs text-on-surface-variant">Versión {link.version}{link.actualizadoEn ? ` · Actualizado: ${formatDate(link.actualizadoEn)}` : ''}</p>
              {link.socioId && <button type="button" className={button + ' text-error'} disabled={busy || needsRefresh} onClick={() => { setConfirmation('quitar'); setSaveError(''); setSuccess(''); }}>Quitar vínculo</button>}
            </div>

            <form onSubmit={searchSocio} className="space-y-2">
              <label htmlFor="car-cruds-socio" className="block text-sm font-semibold">Buscar socio por DNI o email exacto</label>
              <div className="flex flex-wrap gap-2">
                <input id="car-cruds-socio" value={identifier} maxLength={100} disabled={busy || needsRefresh} onChange={event => { setIdentifier(event.target.value); setSearchResults(null); setChosen(null); setConfirmation(null); }} className="min-w-0 flex-1 rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50" autoComplete="off" required />
                <button type="submit" className={button} disabled={busy || needsRefresh || !identifier.trim()}>{searching ? 'Buscando…' : 'Buscar'}</button>
              </div>
              <p className="text-xs text-on-surface-variant">No se vinculan personas por coincidencia de nombre.</p>
            </form>
            {searchError && <p role="alert" className="text-sm text-error">{searchError}</p>}
            {searchResults && <div className="space-y-2">
              {searchResults.length === 0 && <p role="status" className="text-sm text-on-surface-variant">No se encontró un socio con ese DNI o email. Podés darlo de alta y buscarlo nuevamente.</p>}
              {searchResults.map(socio => <button key={socio.socioId} type="button" disabled={busy || needsRefresh} aria-pressed={chosen?.socioId === socio.socioId} className={button + ' block w-full text-left ' + (chosen?.socioId === socio.socioId ? 'border-primary' : '')} onClick={() => { setChosen(socio); setConfirmation(null); setSaveError(''); setSuccess(''); }}>
                <span className="block font-bold">{socio.nombre}</span>
                <span className="block text-xs break-all">DNI: {socio.dni} · {socio.email}</span>
                <span className="block text-xs text-on-surface-variant">Estado: {socio.estado} · ID: {socio.socioId}</span>
              </button>)}
            </div>}
            {chosen && !confirmation && <button type="button" className={primaryButton} disabled={busy || needsRefresh || chosen.socioId === link.socioId} onClick={() => setConfirmation('vincular')}>
              {chosen.socioId === link.socioId ? 'Ya es el socio vinculado' : link.socioId ? 'Revisar corrección' : 'Revisar vinculación'}
            </button>}
            {confirmation && <div role="group" aria-labelledby="car-cruds-confirmar" className="rounded-lg border border-primary bg-surface-container p-4 space-y-3">
              <h3 id="car-cruds-confirmar" className="font-bold">{confirmation === 'quitar' ? 'Confirmar desvinculación' : link.socioId ? 'Confirmar corrección del vínculo' : 'Confirmar vinculación'}</h3>
              <dl className="text-sm space-y-2 break-words">
                <div><dt className="text-on-surface-variant">Empleado Car Cruds</dt><dd>{selected.displayName ? `${selected.displayName} · ` : ''}{employeeId}</dd></div>
                <div><dt className="text-on-surface-variant">Socio actual</dt><dd>{link.socioId ?? 'Sin vínculo'}</dd></div>
                <div><dt className="text-on-surface-variant">Nuevo socio</dt><dd>{confirmation === 'quitar' ? 'Sin vínculo' : `${chosen?.nombre} · DNI ${chosen?.dni} · ${chosen?.email} · ID ${chosen?.socioId}`}</dd></div>
              </dl>
              <p className="text-xs text-on-surface-variant">Se conservará un historial del cambio con el administrador y la fecha. La membresía no se modificará.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || needsRefresh} className={primaryButton} onClick={saveLink}>{saving ? 'Guardando…' : 'Confirmar cambio'}</button>
                <button type="button" disabled={busy} className={button} onClick={() => setConfirmation(null)}>Volver a revisar</button>
              </div>
            </div>}
          </>}

          <section className="space-y-3" aria-labelledby="car-cruds-history">
            <h3 id="car-cruds-history" className="font-bold">Historial de vínculos</h3>
            {historyError && <p role="alert" className="text-sm text-error">{historyError}</p>}
            {!history && !historyError && <p role="status" className="text-sm">Consultando historial…</p>}
            {history?.length === 0 && <p className="text-sm text-on-surface-variant">No hay cambios registrados para este empleado.</p>}
            <ol className="space-y-2">
              {history?.map(item => <li key={item.historialId} className="rounded-lg border border-outline-variant p-3 text-xs space-y-1 break-words">
                <p className="font-semibold">Versión {item.version} · {formatDate(item.createdAt)}</p>
                <p>Socio anterior: {item.socioAnteriorId ?? 'Sin vínculo'}</p>
                <p>Socio nuevo: {item.socioNuevoId ?? 'Sin vínculo'}</p>
                <p className="text-on-surface-variant">Administrador: {item.administradorId}</p>
              </li>)}
            </ol>
          </section>
          {link && <CarCrudsFotografias key={selected.employeeId} employeeId={selected.employeeId}
            versionVinculo={link.version} socioId={link.socioId} onBusyChange={setFotografiasBusy} />}
        </>}
      </div>
    </div>
  </section>;
}
