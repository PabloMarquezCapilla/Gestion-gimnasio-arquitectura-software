import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiHistorialMembresias, apiOperacionMembresia, apiPlanesMembresia, apiSociosAdministracion, apiSolicitudesMembresia } from '../services/api';
import type { MembresiaAdministrativa, PlanMembresia, SolicitudMembresia, SocioAdministrativo } from '../services/api';
import { CajaTienda } from './CajaTienda';
import { PageHeader } from './PageHeader';
const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-surface-container-high';
const input = 'block bg-surface-container border border-outline-variant rounded-lg p-2 w-full';
const box = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const texto = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la operación.';
// Importes en unidad mínima (centavos) mostrados como moneda local.
export const importe = (minor: number, moneda = 'ARS') => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: moneda });
const duracionTexto = (meses: number) => meses === 1 ? '1 mes' : `${meses} meses`;
// Si falta el día original en el mes de destino, se incluye todo su último día.
export function vigencia(inicio: string, meses: number): { desde: Date; hasta: Date } | null {
 const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio);
 if (!partes || !Number.isInteger(meses) || meses < 1 || meses > 36) return null;
 const anio = Number(partes[1]), mes = Number(partes[2]) - 1, dia = Number(partes[3]);
 const desde = new Date(0);
 desde.setFullYear(anio, mes, dia);
 desde.setHours(0, 0, 0, 0);
 if (desde.getFullYear() !== anio || desde.getMonth() !== mes || desde.getDate() !== dia) return null;
 const hasta = new Date(desde);
 hasta.setDate(1);
 hasta.setMonth(mes + meses + 1, 0);
 const ultimoDia = hasta.getDate();
 hasta.setDate(Math.min(dia, ultimoDia));
 if (dia > ultimoDia) hasta.setHours(23, 59, 59, 999);
 else hasta.setMilliseconds(-1);
 if (hasta.getFullYear() > 9999) return null;
 return { desde, hasta };
}
const hoy = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const referenciaCobro = () => 'COBRO-' + hoy().replace(/-/g,'') + '-' + crypto.randomUUID().slice(0,8).toUpperCase();
type Operacion = { path: string; method: 'POST' | 'PUT'; body: object; clave: string };
function recuperar(key: string): Operacion | null {
 try { const p=JSON.parse(sessionStorage.getItem(key)??'null');
  return p && /^\/api\/v1\/(planes|solicitudes|pagos|socios|membresias)(\/[A-Za-z0-9_-]+)*$/.test(p.path) && ['POST','PUT'].includes(p.method) && typeof p.body==='object' && p.body && typeof p.clave==='string' ? p : null;
 } catch { return null; }
}
export function SolicitudesVista({ items }: { items: SolicitudMembresia[] }) {
 return <div className="space-y-3">{items.length===0 && <p>Sin solicitudes en esta página.</p>}{items.map(s=><article className={box} key={s.solicitudId}>
  <h3 className="font-bold">{s.nombrePlan} · {s.estado}</h3><p className="text-sm">Solicitud {s.solicitudId} · Socio {s.socioId}</p>
  <p>{new Date(s.fechaInicio).toLocaleDateString('es-AR')} — {new Date(s.fechaFin).toLocaleDateString('es-AR')}</p>
  <p className="font-semibold">{importe(s.importeMinor, s.moneda)}</p><p>Pago: {s.pago?.estado??'SIN REGISTRAR'}{s.pago && ' · Referencia '+s.pago.referencia}</p>
  {s.estado==='PENDIENTE' && new Date(s.fechaFin).getTime()<Date.now() && <p>Vigencia finalizada: requiere revisión, no puede confirmarse.</p>}
  {s.comprobante && <div className="border border-primary rounded-lg p-3"><strong>Comprobante interno {s.comprobante.comprobanteId}</strong><p>No es una factura fiscal.</p><p>Pago {s.comprobante.pagoId} · Membresía {s.comprobante.membresiaId}</p><p>Confirmado {new Date(s.comprobante.confirmadoEn).toLocaleString('es-AR')}</p></div>}
 </article>)}</div>;
}
export function MisSolicitudes({ socioId }: { socioId: string }) {
 const [items,setItems]=useState<SolicitudMembresia[]>([]),[error,setError]=useState(''),[pagina,setPagina]=useState(1),[loading,setLoading]=useState(false);
 const refresh=useCallback(async()=>{setLoading(true);setError('');try{setItems((await apiSolicitudesMembresia(pagina,socioId)).items);}catch(e){setError(texto(e));}finally{setLoading(false);}},[pagina,socioId]);
 useEffect(()=>{void refresh();},[refresh]);
 return <section className={box}><h3 className="font-bold">Solicitudes, pagos y comprobantes</h3><button className={button} disabled={loading} onClick={()=>void refresh()}>Actualizar solicitudes</button>{loading&&<p role="status">Consultando…</p>}{error?<p role="alert">{error}</p>:<SolicitudesVista items={items}/>}
 <button className={button} disabled={loading||pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button> Página {pagina} <button className={button} disabled={loading||items.length<20} onClick={()=>setPagina(p=>p+1)}>Siguiente</button></section>;
}
// Vista del socio: planes activos con precio, para elegir antes de ir a recepción.
export function PlanesDisponibles() {
 const [planes,setPlanes]=useState<PlanMembresia[]|null>(null),[error,setError]=useState('');
 useEffect(()=>{let activo=true;apiPlanesMembresia().then(r=>{if(activo)setPlanes(r.items.filter(p=>p.estado==='ACTIVO'));}).catch(e=>{if(activo)setError(texto(e));});return()=>{activo=false;};},[]);
 if(error)return <p role="alert" className="text-xs text-error">{error}</p>;
 if(!planes)return <p role="status" className="text-xs">Consultando planes…</p>;
 return <ul className="space-y-1 text-xs">{planes.map(p=><li key={p.planId} className="flex justify-between gap-2"><span>{p.nombre} · {duracionTexto(p.duracionMeses)}</span><strong>{importe(p.importeMinor,p.moneda)}</strong></li>)}</ul>;
}
export type SeccionMembresias = 'socios' | 'planes' | 'cobros';
const titulos: Record<SeccionMembresias, [string, string]> = {
 socios: ['Socios y membresías', 'Elegí un socio y un plan: la vigencia se calcula sola según la duración del plan. Ninguna solicitud pendiente habilita el uso del gimnasio hasta confirmar el pago.'],
 planes: ['Planes y tarifas', 'Planes vigentes con su precio y duración. Los predeterminados (Mensual, Trimestral, Semestral y Anual) vienen cargados; podés desactivarlos o agregar otros.'],
 cobros: ['Cobros y caja', 'Registrá el cobro de cada solicitud y confirmalo después de verificarlo; al confirmar se habilita la membresía. Abajo, las compras de la tienda a cobrar en el mostrador.'],
};
export function MembresiasPanel({ actorId,onNuevoSocio,filtro='',seccion='socios' }: { actorId: string; onNuevoSocio:()=>void; filtro?:string; seccion?: SeccionMembresias }) {
 const storageKey='pulse.membresias.pendiente.'+actorId;
 const [pendiente,setPendiente]=useState<Operacion|null>(()=>recuperar(storageKey));
 const [planes,setPlanes]=useState<PlanMembresia[]>([]),[socios,setSocios]=useState<SocioAdministrativo[]>([]),[items,setItems]=useState<SolicitudMembresia[]>([]);
 const [pagina,setPagina]=useState(1),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [socioId,setSocioId]=useState(''),[planId,setPlanId]=useState(''),[inicio,setInicio]=useState(hoy);
 const [membresias,setMembresias]=useState<MembresiaAdministrativa[]>([]),[errorMembresias,setErrorMembresias]=useState('');
 const [revisionMembresias,setRevisionMembresias]=useState(0);
 const [estadoCuenta,setEstadoCuenta]=useState('');
 const [nombre,setNombre]=useState(''),[precio,setPrecio]=useState(''),[duracion,setDuracion]=useState('1');
 const [referencias,setReferencias]=useState<Record<string,string>>({}),[verificados,setVerificados]=useState<Record<string,boolean>>({});
 const mutation=useRef(false);
 const recuperacionRef=useRef<HTMLDivElement>(null);
 const generation=useRef(0),refreshId=useRef(0);
 useEffect(()=>{generation.current++;return()=>{generation.current++;refreshId.current++;};},[]);
 useEffect(()=>{
  if(pendiente&&!saving)recuperacionRef.current?.focus();
 },[pendiente,saving]);
 const refresh=useCallback(async()=>{const id=++refreshId.current;setLoading(true);setError('');try{
  const [p,s,r]=await Promise.all([apiPlanesMembresia(),apiSociosAdministracion(pagina),apiSolicitudesMembresia(pagina)]);
  if(id!==refreshId.current)return;
  setPlanes(p.items);setSocios(s.items);setItems(r.items);
 }catch(e){if(id===refreshId.current)setError(texto(e));}finally{if(id===refreshId.current)setLoading(false);}},[pagina]);
 useEffect(()=>{void refresh();},[refresh]);
 useEffect(()=>{
  let actual=true;setMembresias([]);setErrorMembresias('');
  if(socioId)void apiHistorialMembresias(socioId).then(r=>{if(actual)setMembresias(r.items);}).catch(e=>{if(actual)setErrorMembresias(texto(e));});
  return()=>{actual=false;};
 },[socioId,revisionMembresias]);
 const ejecutar=async(op:Operacion)=>{
  if(mutation.current)return;mutation.current=true;setSaving(true);setError('');setStatus('');
  const currentGeneration=generation.current,contenido=JSON.stringify(op);
  const retirar=()=>{if(sessionStorage.getItem(storageKey)===contenido)sessionStorage.removeItem(storageKey);};
  try{sessionStorage.setItem(storageKey,JSON.stringify(op));setPendiente(op);
   await apiOperacionMembresia(op.path,op.method,op.body,op.clave);
   if(currentGeneration!==generation.current)return;
   retirar();setPendiente(null);setStatus(op.path.endsWith('/suspender')?'Suspensión guardada. La cancelación de reservas futuras se procesa mediante eventos.':'Operación confirmada por el servidor.');setVerificados({});setRevisionMembresias(r=>r+1);await refresh();
  }catch(e){if(currentGeneration!==generation.current)return;if(e instanceof ApiError && e.status>=400 && e.status<500 && ![401,408,409,429].includes(e.status)){retirar();setPendiente(null);}setError(texto(e));}
  finally{mutation.current=false;if(currentGeneration===generation.current)setSaving(false);}
 };
 const enviar=(path:string,body:object,method:'POST'|'PUT'='POST')=>ejecutar({path,body,method,clave:crypto.randomUUID()});
 const disabled=saving||!!pendiente||loading;
 const planElegido=planes.find(p=>p.planId===planId);
 const periodo=planElegido?vigencia(inicio,planElegido.duracionMeses):null;
 const [titulo,descripcion]=titulos[seccion];
 const sociosVisibles = socios.filter(socio =>
  (!estadoCuenta || socio.estado === estadoCuenta) &&
  [socio.nombre, socio.dni, socio.email, socio.socioId].some(valor =>
   valor.toLowerCase().includes(filtro.toLowerCase())
  )
 );
 const socioElegido = socios.find(socio => socio.socioId === socioId);
 return <section className={seccion==='socios'?'app-page members-panel':'app-page'}>
  {seccion==='socios'?<>
   <PageHeader eyebrow="GESTIÓN DE SOCIOS" title={titulo}
    description="Administrá perfiles, planes y el historial de cada socio."
    action={<button className="members-primary" onClick={onNuevoSocio}>
     <span className="material-symbols-outlined" aria-hidden="true">add</span>
     Nuevo socio
    </button>} />
   <div className="members-stats">
    {[
     {label:'Socios consultados',value:socios.length,note:'Página '+pagina,icon:'group'},
     {label:'Planes activos',value:planes.filter(p=>p.estado==='ACTIVO').length,note:'Disponibles para nuevas solicitudes',icon:'card_membership'},
     {label:'Solicitudes pendientes',value:items.filter(s=>s.estado==='PENDIENTE').length,note:'Página '+pagina+' de solicitudes',icon:'schedule'},
     {label:'Solicitudes confirmadas',value:items.filter(s=>s.estado==='CONFIRMADA').length,note:'Página '+pagina+' de solicitudes',icon:'task_alt'},
    ].map(stat => <article key={stat.label} className="members-stat">
     <span className="members-stat-icon material-symbols-outlined" aria-hidden="true">{stat.icon}</span>
     <div>
      <p>{stat.label}</p>
      <strong>{loading ? '…' : error ? '—' : stat.value}</strong>
      <small>{stat.note}</small>
     </div>
    </article>)}
   </div>
  </>:<PageHeader eyebrow={seccion==='planes'?'CONFIGURACIÓN COMERCIAL':'FINANZAS'} title={titulo}
   description={descripcion} action={<button className={button} disabled={saving} onClick={()=>void refresh()}>Actualizar</button>} />}
  {loading&&<p role="status">Consultando gestión…</p>}{error&&<p role="alert" className="text-error">{error}</p>}{status&&<p role="status">{status}</p>}
  {pendiente&&<div ref={recuperacionRef} tabIndex={-1} role="alert" className={seccion==='socios'?'members-recovery':box}>
   <p className="font-bold">{saving?'Esperando confirmación del servidor…':'Hay una operación pendiente de confirmación.'}</p>
   <p>Podés consultar socios y su historial. Para habilitar nuevas operaciones, recuperá el resultado con el botón siguiente. Conservamos los datos de la operación para evitar duplicaciones.</p>
   <button className={button} disabled={saving} onClick={()=>void ejecutar(pendiente)}>Reintentar la misma operación de membresía</button>
  </div>}
  {seccion==='planes'&&<div className="grid lg:grid-cols-2 gap-4"><section className={box}><h2 className="font-bold">Planes configurados</h2>
   {planes.length===0&&!loading&&<p>No hay planes configurados.</p>}
   {planes.map(p=><div key={p.planId} className="flex items-center justify-between gap-3 border-b border-outline-variant py-2"><div><strong>{p.nombre}</strong> · {importe(p.importeMinor,p.moneda)} · {duracionTexto(p.duracionMeses)}{p.duracionMeses>1&&<span className="text-xs text-on-surface-variant"> ({importe(Math.round(p.importeMinor/p.duracionMeses),p.moneda)}/mes)</span>} · <span className={p.estado==='ACTIVO'?'text-primary':'text-on-surface-variant'}>{p.estado}</span></div>
    <button className={button} disabled={disabled} onClick={()=>void enviar('/api/v1/planes/'+p.planId+'/estado',{estado:p.estado==='ACTIVO'?'INACTIVO':'ACTIVO'},'PUT')}>{p.estado==='ACTIVO'?'Desactivar':'Activar'}</button></div>)}
  </section>
  <section className={box}><form className="space-y-3" onSubmit={e=>{e.preventDefault();void enviar('/api/v1/planes',{nombre,importeMinor:Math.round(Number(precio)*100),moneda:'ARS',duracionMeses:Number(duracion)});}}><h2 className="font-bold">Agregar otro plan</h2>
    <label>Nombre del plan<input aria-label="Nombre del plan" className={input} required maxLength={50} value={nombre} onChange={e=>setNombre(e.target.value)} disabled={disabled} placeholder="Ej.: Pase libre estudiante"/></label>
    <label>Precio total en pesos<input aria-label="Precio en pesos" className={input} required type="number" min="0" step="0.01" value={precio} onChange={e=>setPrecio(e.target.value)} disabled={disabled}/></label>
    <label>Duración<select aria-label="Duración del plan" className={input} value={duracion} onChange={e=>setDuracion(e.target.value)} disabled={disabled}>{[1,2,3,6,12].map(m=><option key={m} value={m}>{duracionTexto(m)}</option>)}</select></label>
    <button className={button} disabled={disabled}>Crear plan</button></form>
  </section></div>}
  {seccion==='socios'&&<div className="members-workspace">
  <section className="members-list">
   <div className="members-list-heading">
    <div>
     <h2>Listado de socios</h2>
     <p>{sociosVisibles.length} resultados visibles · página {pagina}</p>
    </div>
    <button className={button} disabled={saving || loading} onClick={() => void refresh()}>Actualizar</button>
   </div>
   <div className="members-filters">
    <p>La búsqueda superior y el estado filtran esta página.</p>
    <label>Estado de cuenta
     <select aria-label="Filtrar por estado de cuenta" value={estadoCuenta} onChange={e => setEstadoCuenta(e.target.value)}>
      <option value="">Todos</option>
      <option value="ACTIVO">ACTIVO</option>
      <option value="INACTIVO">INACTIVO</option>
     </select>
    </label>
   </div>
   <div className="members-table-scroll" tabIndex={0} role="region" aria-label="Listado de socios, desplazable horizontalmente">
    <table className="members-table">
     <caption className="sr-only">Socios de la página {pagina}. Seleccioná uno para consultar sus membresías.</caption>
     <thead>
      <tr>
       <th scope="col">Socio</th>
       <th scope="col">DNI</th>
       <th scope="col">Cuenta</th>
       <th scope="col"><span className="sr-only">Acciones</span></th>
      </tr>
     </thead>
     <tbody>
      {sociosVisibles.map(socio => <tr key={socio.socioId} className={socioId === socio.socioId ? 'is-selected' : ''}>
       <td>
        <div className="members-person">
         <span className="members-person-avatar" aria-hidden="true">
          {socio.nombre.trim().split(/\s+/).slice(0, 2).map(parte => parte[0]).join('').toUpperCase()}
         </span>
         <div><strong>{socio.nombre}</strong><span>{socio.email}</span></div>
        </div>
       </td>
       <td>{socio.dni}</td>
       <td><span className={'members-badge ' + (socio.estado === 'ACTIVO' ? 'is-enabled' : 'is-muted')}>{socio.estado}</span></td>
       <td>
        <button className="members-select" aria-label={'Seleccionar ' + socio.nombre}
         aria-pressed={socioId === socio.socioId} disabled={saving || loading}
         onClick={() => setSocioId(socio.socioId)}>
         {socioId === socio.socioId ? 'Seleccionado' : 'Ver detalle'}
        </button>
       </td>
      </tr>)}
     </tbody>
    </table>
   </div>
   {!loading && !error && sociosVisibles.length === 0 && <div className="members-empty">
    <span className="material-symbols-outlined" aria-hidden="true">search_off</span>
    <h3>{socios.length ? 'No encontramos resultados' : 'Sin socios en esta página'}</h3>
    <p>{socios.length ? 'Probá otra búsqueda o cambiá el estado de cuenta.' : 'Podés volver a la página anterior o dar de alta un socio.'}</p>
   </div>}
   <div className="members-pagination">
    <span>Página {pagina} · hasta 20 socios</span>
    <div>
     <button className={button} disabled={loading || saving || pagina === 1} onClick={() => { setSocioId(''); setPagina(p => p - 1); }}>Anterior</button>
     <button className={button} disabled={loading || saving || socios.length < 20} onClick={() => { setSocioId(''); setPagina(p => p + 1); }}>Siguiente</button>
    </div>
   </div>
  </section>
  <div className="members-detail">
  <section className={box}>
   <div className="members-detail-heading">
    <span className="members-eyebrow">DETALLE DEL SOCIO</span>
    <h2>{socioElegido?.nombre ?? 'Seleccioná un socio'}</h2>
    <p>{socioElegido?.email ?? 'Elegí una persona del listado para consultar su historial y solicitar una membresía.'}</p>
   </div>
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();if(periodo)void enviar('/api/v1/socios/'+encodeURIComponent(socioId)+'/solicitudes',{planId,fechaInicio:periodo.desde.toISOString(),fechaFin:periodo.hasta.toISOString()});}}><h3 className="font-bold">Alta o nuevo período</h3>
    <label>Socio<select aria-label="Socio de la solicitud" className={input} required value={socioId} onChange={e=>setSocioId(e.target.value)} disabled={saving||loading}><option value="">Seleccioná un socio</option>{socios.map(s=><option key={s.socioId} value={s.socioId}>{s.nombre} · {s.dni}</option>)}</select></label>
    <label>Plan<select aria-label="Plan de la solicitud" className={input} required value={planId} onChange={e=>setPlanId(e.target.value)} disabled={disabled}><option value="">Seleccioná un plan</option>{planes.filter(p=>p.estado==='ACTIVO').map(p=><option key={p.planId} value={p.planId}>{p.nombre} · {importe(p.importeMinor,p.moneda)} · {duracionTexto(p.duracionMeses)}</option>)}</select></label>
    <label>Inicio de vigencia<input aria-label="Inicio de vigencia" className={input} type="date" required value={inicio} onChange={e=>setInicio(e.target.value)} disabled={disabled}/></label>
    {periodo&&planElegido&&<p className="text-sm">Vigencia: <strong>{periodo.desde.toLocaleDateString('es-AR')} al {periodo.hasta.toLocaleDateString('es-AR')}</strong> · A cobrar: <strong>{importe(planElegido.importeMinor,planElegido.moneda)}</strong></p>}
    <p className="members-help">La vigencia se calcula según el plan. La membresía se habilita al confirmar el pago en Cobros y caja.</p>
    <button className="members-primary" disabled={disabled||!planId||!socioId||!periodo}>Crear solicitud</button>
   </form>
  </section>
  {socioId&&<section className={box}><h2 className="font-bold">Membresías del socio seleccionado</h2>
   <button className={button} disabled={saving||loading} onClick={()=>setRevisionMembresias(r=>r+1)}>Actualizar membresías</button>
   {errorMembresias&&<p role="alert">{errorMembresias}</p>}
   {membresias.length===0&&!errorMembresias&&<p>Sin membresías registradas.</p>}
   {membresias.map(m=><article key={m.membresiaId} className="members-membership"><h3>{m.tipoPlan}</h3><span className={'members-badge '+(m.estado==='HABILITADA'?'is-enabled':'is-muted')}>{m.estado}</span><p className="members-help">{m.membresiaId}</p>
    <p>{new Date(m.fechaInicio).toLocaleDateString('es-AR')} — {new Date(m.fechaFin).toLocaleDateString('es-AR')}</p>
    {m.estado==='HABILITADA'&&<button className="members-danger" disabled={disabled} onClick={()=>{
     if(window.confirm('¿Suspender esta membresía inmediatamente? Se mantienen sus fechas y se cancelarán las reservas futuras afectadas.'))void enviar('/api/v1/membresias/'+encodeURIComponent(m.membresiaId)+'/suspender',{});
    }}>Suspender membresía</button>}
   </article>)}
  </section>}</div></div>}
  {seccion==='cobros'&&<><section className={box}><h2 className="font-bold">Cobros de membresías — página {pagina}</h2>
   <p className="text-sm">Pendientes de cobro: <strong>{items.filter(s=>s.estado==='PENDIENTE').length}</strong> · A cobrar: <strong>{importe(items.filter(s=>s.estado==='PENDIENTE').reduce((t,s)=>t+s.importeMinor,0))}</strong></p>
   {items.filter(s=>s.estado==='PENDIENTE').map(s=><div key={s.solicitudId} className={box}><h3 className="font-bold">{s.nombrePlan} · socio {s.socioId} · {importe(s.importeMinor,s.moneda)}</h3>
    {!s.pago?<form className="space-y-2" onSubmit={e=>{e.preventDefault();void enviar('/api/v1/solicitudes/'+s.solicitudId+'/pagos',{referencia:referencias[s.solicitudId]??referenciaCobro(),importeMinor:s.importeMinor,moneda:s.moneda});}}><label>Referencia del cobro (comprobante del medio de pago)<input aria-label={'Referencia '+s.solicitudId} pattern="[A-Za-z0-9][A-Za-z0-9_-]{7,99}" className={input} value={referencias[s.solicitudId]??''} placeholder="Se genera sola si la dejás vacía" onChange={e=>setReferencias({...referencias,[s.solicitudId]:e.target.value})} onFocus={()=>{if(!referencias[s.solicitudId])setReferencias({...referencias,[s.solicitudId]:referenciaCobro()});}} disabled={disabled}/></label><button className={button} disabled={disabled}>Registrar cobro de {importe(s.importeMinor,s.moneda)}</button></form>:<div className="space-y-2"><p>Cobro registrado · referencia {s.pago.referencia}</p><label><input type="checkbox" disabled={disabled} checked={verificados[s.solicitudId]??false} onChange={e=>setVerificados({...verificados,[s.solicitudId]:e.target.checked})}/> Verifiqué el cobro completo</label> <button className={button} disabled={disabled||!verificados[s.solicitudId]} onClick={()=>void enviar('/api/v1/pagos/'+s.pago!.pagoId+'/confirmar',{})}>Confirmar pago y habilitar membresía</button></div>}
    <button className={button} disabled={disabled} onClick={()=>{if(window.confirm('¿Rechazar la solicitud y su pago pendiente? No se generará una membresía.'))void enviar('/api/v1/solicitudes/'+s.solicitudId+'/rechazar',{});}}>Rechazar solicitud</button>
   </div>)}
   <h3 className="font-bold pt-2">Historial de solicitudes</h3><SolicitudesVista items={items}/>
   <button className={button} disabled={loading||saving||pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button> Página {pagina} <button className={button} disabled={loading||saving||items.length<20} onClick={()=>setPagina(p=>p+1)}>Siguiente</button>
  </section>
  <CajaTienda/></>}
 </section>;
}
