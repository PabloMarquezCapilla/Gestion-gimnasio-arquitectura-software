import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from './PageHeader';
import { ApiError, apiConsultarStockTienda, apiRegistrarVentaTienda, retirarVentaTiendaPendiente } from '../services/api';
import type { StockItemTienda, VentaPendienteTienda, VentaTienda } from '../services/api';

const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-surface-container-high';
const primaryButton = 'rounded-lg border border-primary px-4 py-2 text-sm font-semibold disabled:opacity-50 bg-primary text-on-primary hover:bg-primary-hover';
const input = 'block w-full rounded-lg border border-outline-variant bg-surface-container p-2';
type Operacion = VentaPendienteTienda;
type Recuperacion = { pendiente: Operacion | null; error: string };
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'No se pudo completar la operación.';

function recuperar(storageKey: string): Recuperacion {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (raw === null) return { pendiente: null, error: '' };
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || typeof value.clave !== 'string' || !value.clave.trim()
      || /[\r\n]/.test(value.clave) || !value.body || typeof value.body !== 'object'
      || Object.keys(value.body).sort().join(',') !== 'productoCodigo,unidades'
      || typeof value.body.productoCodigo !== 'string' || !value.body.productoCodigo.trim()
      || !Number.isSafeInteger(value.body.unidades) || value.body.unidades < 1) {
      return { pendiente: null, error: 'Hay una venta guardada que no se pudo interpretar. Revisá su registro antes de iniciar otra venta; no borres sus datos para volver a enviarla.' };
    }
    return { pendiente: { clave: value.clave, body: { productoCodigo: value.body.productoCodigo, unidades: value.body.unidades } }, error: '' };
  } catch {
    return { pendiente: null, error: 'No se pudo recuperar la venta guardada. Habilitá el almacenamiento de esta pestaña antes de registrar ventas.' };
  }
}

// La clave fuerza un estado separado al cambiar de administrador.
export function TiendaStockPanel({ actorId }: { actorId: string }) {
  return <StockPorAdministrador key={actorId} actorId={actorId} />;
}

function StockPorAdministrador({ actorId }: { actorId: string }) {
  const storageKey = 'pulse.tienda.venta-pendiente.' + actorId;
  const [recuperacion] = useState(() => recuperar(storageKey));
  const [pendiente, setPendiente] = useState<Operacion | null>(recuperacion.pendiente);
  const [storageError, setStorageError] = useState(recuperacion.error);
  const [items, setItems] = useState<StockItemTienda[] | null>(null);
  const [productoCodigo, setProductoCodigo] = useState(recuperacion.pendiente?.body.productoCodigo ?? '');
  const [unidades, setUnidades] = useState(String(recuperacion.pendiente?.body.unidades ?? ''));
  const [confirmada, setConfirmada] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stockError, setStockError] = useState('');
  const [ventaError, setVentaError] = useState('');
  const [recibo, setRecibo] = useState<VentaTienda | null>(null);
  const alive = useRef(false), epoch = useRef(0), query = useRef(0), mutation = useRef(false);

  const refresh = useCallback(async () => {
    const version = ++query.current, currentEpoch = epoch.current;
    setLoading(true); setStockError(''); setItems(null);
    try {
      const data = await apiConsultarStockTienda();
      if (alive.current && currentEpoch === epoch.current && version === query.current) setItems(data.items);
    } catch (cause) {
      if (alive.current && currentEpoch === epoch.current && version === query.current) setStockError(message(cause));
    } finally {
      if (alive.current && currentEpoch === epoch.current && version === query.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true; epoch.current++;
    void refresh();
    return () => { alive.current = false; epoch.current++; query.current++; };
  }, [refresh]);

  const seleccionada = items?.find(item => item.productoCodigo === productoCodigo);
  const cantidad = Number(unidades);
  const cantidadValida = unidades.trim() !== '' && Number.isSafeInteger(cantidad) && cantidad > 0;
  const disabledForm = saving || loading || !!pendiente || !!storageError;

  const registrar = async () => {
    if (!alive.current || mutation.current || storageError) return;
    if (!pendiente && (!confirmada || !cantidadValida || !seleccionada || cantidad > seleccionada.unidadesDisponibles)) {
      setVentaError('Seleccioná una variante con existencias suficientes y confirmá las unidades vendidas.'); return;
    }
    const currentEpoch = epoch.current;
    const esActual = () => alive.current && currentEpoch === epoch.current;
    const esReintento = pendiente !== null;
    const op = pendiente ?? { clave: crypto.randomUUID(), body: { productoCodigo, unidades: cantidad } };
    mutation.current = true; setSaving(true); setVentaError(''); setRecibo(null);
    let enviada = false;
    try {
      // Conservar antes del HTTP; una respuesta perdida nunca inicia otra venta.
      sessionStorage.setItem(storageKey, JSON.stringify(op));
      setPendiente(op); enviada = true;
      const result = await apiRegistrarVentaTienda(op.body, op.clave);
      if (!esActual()) return;
      setRecibo(result);
      try {
        if (!retirarVentaTiendaPendiente(sessionStorage, storageKey, op, esActual)) {
          setStorageError('Esta venta fue confirmada, pero hay otro registro local. Volvé a abrir la sección para recuperar la venta pendiente actual.');
          return;
        }
      }
      catch {
        if (esActual()) setVentaError('La venta fue confirmada, pero no se pudo retirar su registro local. Reintentar la misma venta permite recuperar el resultado sin volver a descontar unidades.');
        return;
      }
      if (esActual()) {
        setPendiente(null); setConfirmada(false); setUnidades('');
        // refresh informa su error aparte; no transforma una venta confirmada en fallo.
        await refresh();
      }
    } catch (cause) {
      if (!esActual()) return;
      if (!enviada) {
        setStorageError('No se pudo conservar la venta en esta pestaña. No se envió ninguna solicitud nueva; habilitá el almacenamiento y volvé a abrir esta sección.');
      } else {
        // Solo un rechazo conocido en el primer intento permite editar la orden.
        // Una operación recuperada o un conflicto de clave necesita conservarse.
        const rechazoInicial = !esReintento && cause instanceof ApiError && [
          'SOLICITUD_INVALIDA', 'IDEMPOTENCIA_INVALIDA', 'PRODUCTO_NO_ENCONTRADO', 'STOCK_INSUFICIENTE', 'STOCK_NO_REPRESENTABLE',
        ].includes(cause.codigo ?? '') && [400, 404, 409, 422].includes(cause.status);
        if (rechazoInicial) {
          try {
            if (retirarVentaTiendaPendiente(sessionStorage, storageKey, op, esActual)) {
              setPendiente(null); setConfirmada(false);
            } else {
              setStorageError('El registro local corresponde a otra venta. Volvé a abrir la sección para recuperar la operación actual.');
            }
          }
          catch { setStorageError('La venta fue rechazada, pero no se pudo retirar el registro local. Revisá el almacenamiento antes de registrar otra.'); }
        }
        setVentaError(message(cause));
        if (cause instanceof ApiError && cause.codigo === 'STOCK_INSUFICIENTE') await refresh();
      }
    } finally {
      mutation.current = false;
      if (alive.current && currentEpoch === epoch.current) setSaving(false);
    }
  };

  return <section className="app-page" aria-labelledby="tienda-stock-heading">
    <PageHeader id="tienda-stock-heading" eyebrow="INVENTARIO" title="Tienda y stock"
      description="Consultá las existencias abastecidas por FAV y registrá las unidades vendidas en el gimnasio. Los cobros se realizan en el mostrador." />
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="font-bold text-lg">Stock del gimnasio</h2>
      <button type="button" className={button} disabled={loading || saving} onClick={() => void refresh()}>Actualizar stock</button>
    </div>
    {loading && <p role="status">Consultando existencias…</p>}
    {stockError && <p role="alert" className="text-error">No se pudo consultar el stock: {stockError}</p>}
    {items !== null && <>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Stock de la tienda"><table className="w-full text-sm">
        <thead><tr>{['Código de variante FAV', 'Disponibles', 'Vendidas acumuladas'].map(label => <th className="text-left p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{items.map(item => <tr key={item.productoCodigo} className="border-t border-outline-variant">
          <td className="p-2 break-all">{item.productoCodigo}</td><td className="p-2">{item.unidadesDisponibles}</td><td className="p-2">{item.unidadesVendidas}</td>
        </tr>)}</tbody>
      </table></div>
      {!items.length && <p>No hay variantes recibidas en la tienda. Las reposiciones de FAV incorporan las existencias.</p>}
    </>}
    <form onSubmit={event => { event.preventDefault(); void registrar(); }} className="rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3">
      <h2 className="font-bold text-lg">Registrar venta realizada</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        <label>Variante de FAV<select aria-label="Variante de la venta" className={input} value={productoCodigo} disabled={disabledForm} required onChange={event => { setProductoCodigo(event.target.value); setConfirmada(false); }}>
          <option value="">Seleccioná una variante</option>
          {pendiente && !items?.some(item => item.productoCodigo === pendiente.body.productoCodigo) && <option value={pendiente.body.productoCodigo}>{pendiente.body.productoCodigo}</option>}
          {items?.map(item => <option key={item.productoCodigo} value={item.productoCodigo}>{item.productoCodigo} · {item.unidadesDisponibles} disponibles</option>)}
        </select></label>
        <label>Unidades vendidas<input aria-label="Unidades vendidas" className={input} type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" value={unidades} disabled={disabledForm} required onChange={event => { setUnidades(event.target.value); setConfirmada(false); }} /></label>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmada} disabled={disabledForm} onChange={event => setConfirmada(event.target.checked)} />Confirmo que la venta se realizó y que la variante y las unidades son correctas.</label>
      {!pendiente && <button className={primaryButton} disabled={disabledForm || !confirmada || !cantidadValida || !seleccionada || cantidad > seleccionada.unidadesDisponibles}>{saving ? 'Registrando…' : 'Confirmar registro de venta'}</button>}
    </form>
    {pendiente && <div className="rounded-xl border border-outline-variant p-4 space-y-3" role="status">
      <p>Se conserva una venta de {pendiente.body.unidades} unidades de <strong>{pendiente.body.productoCodigo}</strong>. Reintentar usa los mismos datos y no vuelve a descontar una venta ya confirmada.</p>
      <p className="text-sm">No inicies otra venta para resolver una respuesta incierta. Un conflicto de clave requiere revisar el registro.</p>
      <button type="button" className={button} disabled={saving || !!storageError} onClick={() => void registrar()}>{saving ? 'Consultando el resultado…' : 'Reintentar la misma venta'}</button>
    </div>}
    {recibo && <p role="status" className="text-secondary">Venta registrada: {recibo.unidades} unidades de {recibo.productoCodigo}. Identificador: {recibo.ventaId}.</p>}
    {storageError && <p role="alert" className="text-error">{storageError}</p>}
    {ventaError && <p role="alert" className="text-error">{ventaError}</p>}
  </section>;
}
