import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiOperacionMembresia, apiPlanesMembresia, apiSociosAdministracion, apiSolicitudesMembresia } from '../services/api';
import type { PlanMembresia, SolicitudMembresia, SocioAdministrativo } from '../services/api';
const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-surface-container-high';
const input = 'block bg-surface-container border border-outline-variant rounded-lg p-2 w-full';
const box = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const texto = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la operación.';
type Operacion = { path: string; method: 'POST' | 'PUT'; body: object; clave: string };
function recuperar(key: string): Operacion | null {
 try { const p=JSON.parse(sessionStorage.getItem(key)??'null');
  return p && /^\/api\/v1\/(planes|solicitudes|pagos|socios)(\/[A-Za-z0-9_-]+)*$/.test(p.path) && ['POST','PUT'].includes(p.method) && typeof p.body==='object' && p.body && typeof p.clave==='string' ? p : null;
 } catch { return null; }
}
export function SolicitudesVista({ items }: { items: SolicitudMembresia[] }) {
 return <div className="space-y-3">{items.length===0 && <p>Sin solicitudes en esta página.</p>}{items.map(s=><article className={box} key={s.solicitudId}>
  <h3 className="font-bold">{s.nombrePlan} · {s.estado}</h3><p className="text-sm">Solicitud {s.solicitudId} · Socio {s.socioId}</p>
  <p>{new Date(s.fechaInicio).toLocaleString('es-AR')} — {new Date(s.fechaFin).toLocaleString('es-AR')}</p>
  <p>{s.importeMinor} unidades mínimas · {s.moneda}</p><p>Pago: {s.pago?.estado??'SIN REGISTRAR'}{s.pago && ' · Referencia '+s.pago.referencia}</p>
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
export function MembresiasPanel({ actorId,onNuevoSocio,filtro='' }: { actorId: string; onNuevoSocio:()=>void; filtro?:string }) {
 const storageKey='pulse.membresias.pendiente.'+actorId;
 const [pendiente,setPendiente]=useState<Operacion|null>(()=>recuperar(storageKey));
 const [planes,setPlanes]=useState<PlanMembresia[]>([]),[socios,setSocios]=useState<SocioAdministrativo[]>([]),[items,setItems]=useState<SolicitudMembresia[]>([]);
 const [pagina,setPagina]=useState(1),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
 const [socioId,setSocioId]=useState(''),[planId,setPlanId]=useState(''),[inicio,setInicio]=useState(''),[fin,setFin]=useState('');
 const [nombre,setNombre]=useState(''),[importe,setImporte]=useState(''),[moneda,setMoneda]=useState('');
 const [referencias,setReferencias]=useState<Record<string,string>>({}),[verificados,setVerificados]=useState<Record<string,boolean>>({});
 const mutation=useRef(false);
 const refresh=useCallback(async()=>{setLoading(true);setError('');try{
  const [p,s,r]=await Promise.all([apiPlanesMembresia(),apiSociosAdministracion(pagina),apiSolicitudesMembresia(pagina)]);
  setPlanes(p.items);setSocios(s.items);setItems(r.items);
 }catch(e){setError(texto(e));}finally{setLoading(false);}},[pagina]);
 useEffect(()=>{void refresh();},[refresh]);
 const ejecutar=async(op:Operacion)=>{
  if(mutation.current)return;mutation.current=true;setSaving(true);setError('');setStatus('');
  try{sessionStorage.setItem(storageKey,JSON.stringify(op));setPendiente(op);
   await apiOperacionMembresia(op.path,op.method,op.body,op.clave);
   sessionStorage.removeItem(storageKey);setPendiente(null);setStatus('Operación confirmada por el servidor.');setVerificados({});await refresh();
  }catch(e){if(e instanceof ApiError && e.status>=400 && e.status<500 && ![401,408,429].includes(e.status)){sessionStorage.removeItem(storageKey);setPendiente(null);}setError(texto(e));}
  finally{mutation.current=false;setSaving(false);}
 };
 const enviar=(path:string,body:object,method:'POST'|'PUT'='POST')=>ejecutar({path,body,method,clave:crypto.randomUUID()});
 const disabled=saving||!!pendiente||loading;
 return <section className="py-6 space-y-5"><h1 className="font-headline text-2xl font-bold">Planes, pagos y membresías</h1>
  <p>Registrá el cobro manual y confirmalo sólo después de verificarlo. Ninguna solicitud pendiente habilita el uso del gimnasio.</p>
  <div className="flex gap-3"><button className={button} disabled={saving} onClick={()=>void refresh()}>Actualizar gestión</button><button className={button} onClick={onNuevoSocio}>Alta de Socio</button></div>
  {loading&&<p role="status">Consultando gestión…</p>}{error&&<p role="alert" className="text-error">{error}</p>}{status&&<p role="status">{status}</p>}
  {pendiente&&<div className={box}><p>Hay una operación pendiente de respuesta. Conservamos sus datos para evitar duplicaciones.</p><button className={button} disabled={saving} onClick={()=>void ejecutar(pendiente)}>Reintentar la misma operación de membresía</button></div>}
  <div className="grid lg:grid-cols-2 gap-4"><section className={box}><h2 className="font-bold">Planes configurados</h2>
   {planes.length===0&&<p>No hay planes configurados. Administración debe definir nombre, moneda e importe antes de solicitar una membresía.</p>}
   {planes.map(p=><div key={p.planId} className="border-b border-outline-variant py-2"><strong>{p.nombre}</strong> · {p.importeMinor} unidades mínimas {p.moneda} · {p.estado} <button className={button} disabled={disabled} onClick={()=>void enviar('/api/v1/planes/'+p.planId+'/estado',{estado:p.estado==='ACTIVO'?'INACTIVO':'ACTIVO'},'PUT')}>{p.estado==='ACTIVO'?'Desactivar':'Activar'} plan {p.nombre}</button></div>)}
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();void enviar('/api/v1/planes',{nombre,importeMinor:Number(importe),moneda});}}><h3>Crear plan sin tarifa predeterminada</h3>
    <label>Nombre del plan<input aria-label="Nombre del plan" className={input} required maxLength={50} value={nombre} onChange={e=>setNombre(e.target.value)} disabled={disabled}/></label>
    <label>Importe en unidad mínima<input aria-label="Importe en unidad mínima" className={input} required type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" value={importe} onChange={e=>setImporte(e.target.value)} disabled={disabled}/></label>
    <label>Moneda (código de 3 letras)<input aria-label="Moneda" className={input} required pattern="[A-Z]{3}" maxLength={3} value={moneda} onChange={e=>setMoneda(e.target.value.toUpperCase())} disabled={disabled}/></label>
    <p className="text-xs">Administración debe usar la unidad mínima de la moneda definida para el cobro. No se convierten monedas ni se calculan impuestos.</p><button className={button} disabled={disabled}>Crear plan</button></form>
  </section>
  <section className={box}><h2 className="font-bold">Socios registrados — página {pagina}</h2><p className="text-xs">La búsqueda superior filtra esta página.</p>
   {socios.filter(s=>[s.nombre,s.dni,s.email,s.socioId].some(v=>v.toLowerCase().includes(filtro.toLowerCase()))).map(s=><p key={s.socioId}>{s.nombre} · {s.dni} · {s.email} · {s.estado} <button className={button} disabled={disabled} onClick={()=>setSocioId(s.socioId)}>Seleccionar {s.nombre}</button></p>)}
   <form className="space-y-3" onSubmit={e=>{e.preventDefault();void enviar('/api/v1/socios/'+encodeURIComponent(socioId)+'/solicitudes',{planId,fechaInicio:new Date(inicio).toISOString(),fechaFin:new Date(fin).toISOString()});}}><h3>Solicitar alta o nuevo período</h3>
    <label>Socio<select aria-label="Socio de la solicitud" className={input} required value={socioId} onChange={e=>setSocioId(e.target.value)} disabled={disabled}><option value="">Seleccioná un socio</option>{socios.map(s=><option key={s.socioId} value={s.socioId}>{s.nombre} · {s.dni}</option>)}</select></label>
    <label>Plan<select aria-label="Plan de la solicitud" className={input} required value={planId} onChange={e=>setPlanId(e.target.value)} disabled={disabled}><option value="">Seleccioná un plan</option>{planes.filter(p=>p.estado==='ACTIVO').map(p=><option key={p.planId} value={p.planId}>{p.nombre}</option>)}</select></label>
    <label>Inicio de vigencia<input aria-label="Inicio de vigencia" className={input} type="datetime-local" required value={inicio} onChange={e=>setInicio(e.target.value)} disabled={disabled}/></label>
    <label>Fin de vigencia<input aria-label="Fin de vigencia" className={input} type="datetime-local" required min={inicio} value={fin} onChange={e=>setFin(e.target.value)} disabled={disabled}/></label>
    <p className="text-xs">Fechas explícitas en tu zona horaria. No se calculan meses ni se acumulan días. Las superposiciones requieren revisión.</p><button className={button} disabled={disabled||!planId||!socioId}>Crear solicitud</button>
   </form>
  </section></div>
  <section className={box}><h2 className="font-bold">Solicitudes y cobros — página {pagina}</h2><SolicitudesVista items={items}/>
   {items.filter(s=>s.estado==='PENDIENTE').map(s=><div key={s.solicitudId} className={box}><h3>Operar solicitud {s.solicitudId}</h3>
    {!s.pago?<form onSubmit={e=>{e.preventDefault();void enviar('/api/v1/solicitudes/'+s.solicitudId+'/pagos',{referencia:referencias[s.solicitudId]??'',importeMinor:s.importeMinor,moneda:s.moneda});}}><label>Referencia única del cobro<input aria-label={'Referencia '+s.solicitudId} required pattern="[A-Za-z0-9][A-Za-z0-9_-]{7,99}" className={input} value={referencias[s.solicitudId]??''} onChange={e=>setReferencias({...referencias,[s.solicitudId]:e.target.value})} disabled={disabled}/></label><p>Registrar {s.importeMinor} unidades mínimas {s.moneda}. No activa la membresía.</p><button className={button} disabled={disabled}>Registrar pago pendiente</button></form>:<div><label><input type="checkbox" disabled={disabled} checked={verificados[s.solicitudId]??false} onChange={e=>setVerificados({...verificados,[s.solicitudId]:e.target.checked})}/> Verifiqué el cobro completo de esta solicitud</label><button className={button} disabled={disabled||!verificados[s.solicitudId]} onClick={()=>void enviar('/api/v1/pagos/'+s.pago!.pagoId+'/confirmar',{})}>Confirmar pago verificado</button></div>}
    <button className={button} disabled={disabled} onClick={()=>{if(window.confirm('¿Rechazar la solicitud y su pago pendiente? No se generará una membresía.'))void enviar('/api/v1/solicitudes/'+s.solicitudId+'/rechazar',{});}}>Rechazar solicitud</button>
   </div>)}
   <button className={button} disabled={loading||saving||pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button> Página {pagina} <button className={button} disabled={loading||saving||(socios.length<20&&items.length<20)} onClick={()=>setPagina(p=>p+1)}>Siguiente</button>
  </section>
 </section>;
}
