import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, apiHistorialMembresias, apiOperacionMembresia, apiPlanesMembresia, apiSociosAdministracion, apiSolicitudesMembresia } from '../services/api';
import type { MembresiaAdministrativa, PlanMembresia, SolicitudMembresia, SocioAdministrativo } from '../services/api';
import { CajaTienda } from './CajaTienda';
const button = 'rounded-lg border border-outline-variant px-4 py-2 text-sm font-semibold disabled:opacity-50 hover:bg-surface-container-high';
const input = 'block bg-surface-container border border-outline-variant rounded-lg p-2 w-full';
const box = 'rounded-xl border border-outline-variant bg-surface-container-low p-4 space-y-3';
const texto = (e: unknown) => e instanceof Error ? e.message : 'No se pudo completar la operación.';
// Importes en unidad mínima (centavos) mostrados como moneda local.
export const importe = (minor: number, moneda = 'ARS') => (minor / 100).toLocaleString('es-AR', { style: 'currency', currency: moneda });
const duracionTexto = (meses: number) => meses === 1 ? '1 mes' : `${meses} meses`;
// Vigencia de un plan: desde el inicio del día elegido hasta el último segundo antes del mismo día N meses después.
export function vigencia(inicio: string, meses: number): { desde: Date; hasta: Date } | null {
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio); if(!m) return null;
 const desde=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]));
 const hasta=new Date(Number(m[1]),Number(m[2])-1+meses,Number(m[3])); hasta.setSeconds(hasta.getSeconds()-1);
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
 return <section className="py-6 space-y-5"><h1 className="font-headline text-2xl font-bold">{titulo}</h1>
  <p>{descripcion}</p>
  <div className="flex gap-3"><button className={button} disabled={saving} onClick={()=>void refresh()}>Actualizar</button>{seccion==='socios'&&<button className={button} onClick={onNuevoSocio}>Alta de Socio</button>}</div>
  {loading&&<p role="status">Consultando gestión…</p>}{error&&<p role="alert" className="text-error">{error}</p>}{status&&<p role="status">{status}</p>}
  {pendiente&&<div ref={recuperacionRef} tabIndex={-1} role="alert" className={box}>
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
  {seccion==='socios'&&<><div className="grid lg:grid-cols-2 gap-4">
  <section className={box}><h2 className="font-bold">Socios registrados — página {pagina}</h2><p className="text-xs">La búsqueda superior filtra esta página.</p>
   {socios.filter(s=>[s.nombre,s.dni,s.email,s.socioId].some(v=>v.toLowerCase().includes(filtro.toLowerCase()))).map(s=><p key={s.socioId}>{s.nombre} · {s.dni} · {s.email} · {s.estado} <button className={button} disabled={saving||loading} onClick={()=>setSocioId(s.socioId)}>Seleccionar {s.nombre}</button></p>)}
   <button className={button} disabled={loading||saving||pagina===1} onClick={()=>setPagina(p=>p-1)}>Anterior</button> Página {pagina} <button className={button} disabled={loading||saving||socios.length<20} onClick={()=>setPagina(p=>p+1)}>Siguiente</button>
  </section>
  <section className={box}><form className="space-y-3" onSubmit={e=>{e.preventDefault();if(periodo)void enviar('/api/v1/socios/'+encodeURIComponent(socioId)+'/solicitudes',{planId,fechaInicio:periodo.desde.toISOString(),fechaFin:periodo.hasta.toISOString()});}}><h2 className="font-bold">Solicitar alta o nuevo período</h2>
    <label>Socio<select aria-label="Socio de la solicitud" className={input} required value={socioId} onChange={e=>setSocioId(e.target.value)} disabled={saving||loading}><option value="">Seleccioná un socio</option>{socios.map(s=><option key={s.socioId} value={s.socioId}>{s.nombre} · {s.dni}</option>)}</select></label>
    <label>Plan<select aria-label="Plan de la solicitud" className={input} required value={planId} onChange={e=>setPlanId(e.target.value)} disabled={disabled}><option value="">Seleccioná un plan</option>{planes.filter(p=>p.estado==='ACTIVO').map(p=><option key={p.planId} value={p.planId}>{p.nombre} · {importe(p.importeMinor,p.moneda)} · {duracionTexto(p.duracionMeses)}</option>)}</select></label>
    <label>Inicio de vigencia<input aria-label="Inicio de vigencia" className={input} type="date" required value={inicio} onChange={e=>setInicio(e.target.value)} disabled={disabled}/></label>
    {periodo&&planElegido&&<p className="text-sm">Vigencia: <strong>{periodo.desde.toLocaleDateString('es-AR')} al {periodo.hasta.toLocaleDateString('es-AR')}</strong> · A cobrar: <strong>{importe(planElegido.importeMinor,planElegido.moneda)}</strong></p>}
    <button className={button} disabled={disabled||!planId||!socioId||!periodo}>Crear solicitud</button>
   </form>
  </section></div>
  {socioId&&<section className={box}><h2 className="font-bold">Membresías del socio seleccionado</h2>
   <button className={button} disabled={saving||loading} onClick={()=>setRevisionMembresias(r=>r+1)}>Actualizar membresías</button>
   {errorMembresias&&<p role="alert">{errorMembresias}</p>}
   {membresias.length===0&&!errorMembresias&&<p>Sin membresías registradas.</p>}
   {membresias.map(m=><article key={m.membresiaId} className={box}><p>{m.tipoPlan} · {m.estado} · {m.membresiaId}</p>
    <p>{new Date(m.fechaInicio).toLocaleDateString('es-AR')} — {new Date(m.fechaFin).toLocaleDateString('es-AR')}</p>
    {m.estado==='HABILITADA'&&<button className={button} disabled={disabled} onClick={()=>{
     if(window.confirm('¿Suspender esta membresía inmediatamente? Se mantienen sus fechas y se cancelarán las reservas futuras afectadas.'))void enviar('/api/v1/membresias/'+encodeURIComponent(m.membresiaId)+'/suspender',{});
    }}>Suspender membresía</button>}
   </article>)}
  </section>}</>}
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
