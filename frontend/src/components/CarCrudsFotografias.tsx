import { useEffect, useRef, useState } from 'react';
import {
  ApiError, apiCarCrudsEnviarFotografia, apiCarCrudsFotografias, apiCarCrudsPrepararFotografia,
} from '../services/api';
import type { CarCrudsFotografia } from '../services/api';

const button = 'rounded-lg border border-outline-variant px-3 py-2 text-sm font-semibold hover:bg-surface-container-high disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary';
const primaryButton = button + ' bg-primary text-on-primary hover:bg-primary-hover';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'No se pudo completar la operación.';
const formatDate = (value: string) => new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
const boolText = (value: boolean | null) => value === null ? 'Desconocido (null)' : value ? 'Sí' : 'No';
const amountText = (value: number | null) => value === null ? 'Desconocido (null)' : `${value} centavos de ARS`;
const labels: Record<CarCrudsFotografia['estado'], string> = {
  PREPARADA: 'Preparada, sin enviar', ENVIANDO: 'Envío en curso', PENDIENTE: 'Pendiente de reintento',
  RECIBIDA: 'Recibida por Car Cruds', REQUIERE_REVISION: 'Requiere revisión',
};
function currentArgentinaMonth() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}

export function CarCrudsFotografias({ employeeId, versionVinculo, socioId, onBusyChange }: {
  employeeId: string; versionVinculo: number; socioId: string | null; onBusyChange: (busy: boolean) => void;
}) {
  const [period, setPeriod] = useState(currentArgentinaMonth);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; items: CarCrudsFotografia[] } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewLink, setReviewLink] = useState(false);
  const [reviewSending, setReviewSending] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const validPeriod = /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && period >= '0001-01' && period <= currentArgentinaMonth();
  const key = JSON.stringify([employeeId, period, versionVinculo, socioId]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const mounted = useRef(false);
  const busy = loading || saving;
  const items = result?.key === key ? result.items : null;
  const latest = items?.[0];
  const selected = items?.find(item => item.fotografiaId === selectedId) ?? latest;
  const oldLink = !!latest && (latest.versionVinculo !== versionVinculo || latest.socioId !== socioId);
  const blockedPreparation = !!latest && !oldLink && !['RECIBIDA', 'PREPARADA'].includes(latest.estado);
  const activeLease = items?.some(item => item.estado === 'ENVIANDO' && item.leaseHasta !== null && Date.parse(item.leaseHasta) > Date.now());
  const canPrepare = !!socioId && !!items && !busy && !needsRefresh && !activeLease && !blockedPreparation && (!oldLink || reviewLink);
  const currentSelection = selected && selected.versionVinculo === versionVinculo && selected.socioId === socioId;
  const canSend = !!socioId && !!selected && currentSelection && selected.fotografiaId === latest?.fotografiaId
    && selected.estado !== 'RECIBIDA' && !busy && !needsRefresh
    && !(selected.estado === 'ENVIANDO' && selected.leaseHasta !== null && Date.parse(selected.leaseHasta) > Date.now())
    && (selected.estado !== 'REQUIERE_REVISION' || reviewSending);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    let current = true;
    setResult(null); setSelectedId(null); setError(''); setNotice(''); setSaving(false);
    setReviewLink(false); setReviewSending(false); setConfirmSend(false); setNeedsRefresh(false);
    if (!validPeriod) { setLoading(false); return; }
    setLoading(true);
    apiCarCrudsFotografias(employeeId, period).then(data => {
      if (current && currentKey.current === key) setResult({ key, items: [...data.items].sort((a, b) => b.payload.version - a.payload.version) });
    }).catch(cause => { if (current && currentKey.current === key) setError(errorMessage(cause)); })
      .finally(() => { if (current && currentKey.current === key) setLoading(false); });
    return () => { current = false; };
  }, [employeeId, period, key, reload, validPeriod]);

  const acceptRecord = (record: CarCrudsFotografia, actionKey: string) => {
    if (!mounted.current || currentKey.current !== actionKey) return false;
    setResult(previous => ({ key: actionKey, items: [record, ...(previous?.key === actionKey ? previous.items : [])
      .filter(item => item.fotografiaId !== record.fotografiaId)].sort((a, b) => b.payload.version - a.payload.version) }));
    setSelectedId(record.fotografiaId); setConfirmSend(false); setReviewSending(false); setReviewLink(false);
    return true;
  };

  const failedMutation = (cause: unknown, actionKey: string) => {
    if (!mounted.current || currentKey.current !== actionKey) return;
    setError(errorMessage(cause)); setConfirmSend(false);
    // Una respuesta perdida no prueba que la preparación o el envío hayan fallado.
    if (!(cause instanceof ApiError) || cause.status === 0 || cause.status === 409 || cause.status >= 500) setNeedsRefresh(true);
  };

  const prepare = async () => {
    if (!canPrepare) return;
    const actionKey = key;
    setSaving(true); setError(''); setNotice(''); setConfirmSend(false);
    try {
      const record = await apiCarCrudsPrepararFotografia(employeeId, {
        period, versionVinculoEsperada: versionVinculo, versionAnteriorEsperada: latest?.payload.version ?? 0,
        ...(oldLink ? { confirmarCambioVinculo: reviewLink } : {}),
      });
      if (acceptRecord(record, actionKey)) setNotice('Fotografía guardada. Revisá esta vista previa y confirmá el envío por separado.');
    } catch (cause) { failedMutation(cause, actionKey); }
    finally { if (mounted.current && currentKey.current === actionKey) setSaving(false); }
  };

  const send = async () => {
    if (!canSend || !confirmSend || !selected) return;
    const actionKey = key;
    setSaving(true); setError(''); setNotice('');
    try {
      const record = await apiCarCrudsEnviarFotografia(selected.fotografiaId, {
        versionVinculoEsperada: versionVinculo,
        ...(selected.estado === 'REQUIERE_REVISION' ? { confirmarRevision: reviewSending } : {}),
      });
      if (record.socioId !== selected.socioId || record.versionVinculo !== selected.versionVinculo
        || JSON.stringify(record.payload) !== JSON.stringify(selected.payload)) {
        throw new ApiError('La respuesta no coincide con la fotografía guardada. Actualizá antes de continuar.', 502, 'RESPUESTA_INVALIDA');
      }
      if (acceptRecord(record, actionKey)) setNotice(record.estado === 'RECIBIDA'
        ? 'Car Cruds confirmó la recepción de esta fotografía.'
        : 'El envío no quedó confirmado. Revisá el estado guardado antes de continuar.');
    } catch (cause) { failedMutation(cause, actionKey); }
    finally { if (mounted.current && currentKey.current === actionKey) setSaving(false); }
  };

  return <section className="space-y-3 border-t border-outline-variant pt-5" aria-labelledby="car-cruds-fotografias-heading">
    <h3 id="car-cruds-fotografias-heading" className="font-bold">Información mensual para Car Cruds</h3>
    <p className="text-xs text-on-surface-variant">Elegí el mes calendario de Argentina. Primero guardá y revisá la fotografía; después confirmá el envío. No hay envíos programados.</p>
    <div className="flex flex-wrap items-end gap-2">
      <label className="block text-sm font-semibold">Mes
        <input type="month" value={period} min="0001-01" max={currentArgentinaMonth()} disabled={busy} onChange={event => setPeriod(event.target.value)} className="mt-1 block rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-sm disabled:opacity-50" />
      </label>
      <button type="button" className={button} disabled={busy || !validPeriod} onClick={() => setReload(value => value + 1)}>Actualizar fotografías</button>
    </div>
    {!validPeriod && <p role="alert" className="text-sm text-error">Seleccioná un mes válido, hasta el mes actual de Argentina.</p>}
    {loading && <p role="status" className="text-sm">Consultando fotografías guardadas…</p>}
    {error && <p role="alert" className="text-sm text-error">{error}</p>}
    {notice && <p role="status" className="text-sm text-secondary">{notice}</p>}
    {needsRefresh && <p role="alert" className="text-sm text-error">Actualizá las fotografías y, si cambió la relación, el vínculo. Revisá nuevamente antes de repetir la acción; no se creó otra versión automáticamente.</p>}
    {!socioId && <p className="text-sm text-on-surface-variant">No hay socio vinculado. Podés consultar el historial; para preparar o enviar se necesita un vínculo vigente.</p>}
    {items?.length === 0 && <p className="text-sm text-on-surface-variant">No hay fotografías guardadas para este mes.</p>}

    {oldLink && <label className="flex items-start gap-2 rounded-lg border border-outline-variant p-3 text-sm">
      <input type="checkbox" checked={reviewLink} disabled={busy || needsRefresh} onChange={event => setReviewLink(event.target.checked)} />
      <span>Revisé el cambio de vínculo: las fotografías anteriores pertenecen al socio {latest?.socioId} y se conservarán. Confirmo preparar una nueva versión para el socio actual {socioId ?? '(sin vínculo)'}.</span>
    </label>}
    {activeLease && <p role="status" className="text-sm text-on-surface-variant">Hay un envío en curso. Actualizá su estado antes de preparar otra fotografía.</p>}
    {blockedPreparation && <p className="text-xs text-on-surface-variant">La última fotografía sigue abierta. Revisala y completá su envío; los reintentos usan el mismo contenido guardado.</p>}
    <button type="button" className={button} disabled={!canPrepare} onClick={prepare}>{saving ? 'Procesando…' : latest?.estado === 'PREPARADA' ? 'Actualizar vista previa' : latest ? 'Preparar nueva versión para revisar' : 'Preparar vista previa'}</button>

    {!!items?.length && <div className="space-y-2">
      <h4 className="text-sm font-semibold">Historial del mes</h4>
      <div className="flex flex-wrap gap-2">
        {items.map(item => <button type="button" key={item.fotografiaId} disabled={busy} className={button + (selected?.fotografiaId === item.fotografiaId ? ' border-primary' : '')}
          aria-pressed={selected?.fotografiaId === item.fotografiaId} onClick={() => { setSelectedId(item.fotografiaId); setConfirmSend(false); setReviewSending(false); }}>
          Versión {item.payload.version} · {labels[item.estado]}
        </button>)}
      </div>
    </div>}
    {selected && <div className="rounded-lg border border-outline-variant bg-surface-container p-3 space-y-3">
      <h4 className="font-semibold text-sm">Vista previa guardada · versión {selected.payload.version}</h4>
      <dl className="space-y-2 text-xs break-words">
        <div><dt className="text-on-surface-variant">Empleado y mes</dt><dd>{selected.payload.employeeId} · {selected.payload.period}</dd></div>
        <div><dt className="text-on-surface-variant">Socio y versión del vínculo al preparar</dt><dd>{selected.socioId} · {selected.versionVinculo}</dd></div>
        <div><dt className="text-on-surface-variant">Referencia estable y versión de fotografía</dt><dd>{selected.payload.sourceReference} · {selected.payload.version}</dd></div>
        <div><dt className="text-on-surface-variant">Corte de información (observedAt)</dt><dd>{formatDate(selected.payload.observedAt)}</dd></div>
        <div><dt className="text-on-surface-variant">Membresía vigente en algún tramo del mes</dt><dd>{boolText(selected.payload.member)}</dd></div>
        <div><dt className="text-on-surface-variant">Al menos un ingreso efectivo</dt><dd>{boolText(selected.payload.used)}</dd></div>
        <div><dt className="text-on-surface-variant">Costo mensual del plan</dt><dd>{amountText(selected.payload.costMinor)}</dd></div>
        <div><dt className="text-on-surface-variant">Pagos efectivos del mes</dt><dd>{amountText(selected.payload.spendingMinor)}</dd></div>
        <div><dt className="text-on-surface-variant">Estado e intentos</dt><dd>{labels[selected.estado]} · {selected.intentos} intento(s)</dd></div>
        <div><dt className="text-on-surface-variant">Preparada por</dt><dd>{selected.administradorId} · {formatDate(selected.creadaEn)}</dd></div>
        {selected.ultimoIntentoEn && <div><dt className="text-on-surface-variant">Último intento</dt><dd>{formatDate(selected.ultimoIntentoEn)}</dd></div>}
        {selected.recibidaEn && <div><dt className="text-on-surface-variant">Recepción confirmada</dt><dd>{formatDate(selected.recibidaEn)}</dd></div>}
        {selected.leaseHasta && selected.estado === 'ENVIANDO' && <div><dt className="text-on-surface-variant">Reserva del intento hasta</dt><dd>{formatDate(selected.leaseHasta)}</dd></div>}
        {selected.codigoError && <div><dt className="text-on-surface-variant">Código del último problema</dt><dd>{selected.codigoError}</dd></div>}
      </dl>
      <p className="text-xs text-on-surface-variant">Desconocido (null) no significa “No” ni cero. Reservar una clase no acredita asistencia. Los hechos se obtienen del backend y no se editan en esta pantalla.</p>
      {selected.estado === 'RECIBIDA' && <p className="text-sm text-secondary">{selected.applied === true
        ? 'Car Cruds informó que aplicó esta versión.'
        : 'Car Cruds recibió la fotografía sin aplicarla: puede ser una repetición o una versión atrasada. Esto no confirma cuál versión está vigente allí.'}</p>}
      {!currentSelection && <p className="text-sm text-on-surface-variant">Esta fotografía corresponde a otro vínculo. Se conserva como historial y no se volverá a enviar desde la relación actual.</p>}
      {selected.fotografiaId !== latest?.fotografiaId && <p className="text-xs text-on-surface-variant">Es una versión anterior. Para una corrección se prepara una fotografía completa con una versión nueva.</p>}
      {selected.estado === 'REQUIERE_REVISION' && currentSelection && <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={reviewSending} disabled={busy || needsRefresh} onChange={event => { setReviewSending(event.target.checked); setConfirmSend(false); }} />
        <span>Revisé el problema y autorizo reintentar esta misma fotografía. No se cambiarán sus datos, referencia, versión ni fecha de corte.</span>
      </label>}
      {canSend && !confirmSend && <button type="button" className={primaryButton} onClick={() => setConfirmSend(true)}>{selected.estado === 'PREPARADA' ? 'Revisar y enviar esta fotografía' : 'Revisar reintento de la misma fotografía'}</button>}
      {confirmSend && canSend && <div role="group" aria-label="Confirmación de envío mensual" className="space-y-3 rounded-lg border border-primary p-3">
        <p className="text-sm">Confirmo enviar a Car Cruds la fotografía guardada de {period}, versión {selected.payload.version}, para el empleado {employeeId} y socio {selected.socioId}. Los datos desconocidos se enviarán como null.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButton} onClick={send}>Confirmar envío</button>
          <button type="button" className={button} onClick={() => setConfirmSend(false)}>Volver a revisar</button>
        </div>
      </div>}
    </div>}
  </section>;
}
