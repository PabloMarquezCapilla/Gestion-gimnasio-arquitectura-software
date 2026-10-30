import { hostname } from 'node:os';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Identidad } from './types';
import { ComandoGestion, GestionRepository, claveGestion, datosGestion, falloGestion, identificadorGestion, paginaGestion } from './membresias.gestion';

type Control = (r: FastifyRequest) => Promise<void>;
export function registrarGestionMembresias(app: FastifyInstance, repository: GestionRepository | undefined,
 autenticar: Control, administrador: Control, identidad: (r: FastifyRequest) => Identidad) {
 const counters = new Map<string, number>();
 const repo = () => { if (!repository) throw falloGestion('GESTION_POSTGRES_REQUERIDO','La gestión de planes y pagos requiere PostgreSQL configurado.',503); return repository; };
 const noStore = async (_r: FastifyRequest, reply: FastifyReply) => { reply.header('Cache-Control','no-store'); };
 const lectura = [noStore,autenticar]; const admin = [...lectura,administrador];
 const operar = async (r: FastifyRequest, op: ComandoGestion, extra: Record<string, unknown> = {}) => {
  try {
   const body = datosGestion(op,r.body); const clave = claveGestion(r.headers['idempotency-key']);
   let repetida = false;
   const result = await repo().ejecutar(identidad(r).socioId,clave,op,{ ...body,...extra }, () => { repetida = true; });
   const dato = result as { solicitudId?: string; planId?: string; estado?: string };
   const key = `operacion="${op}",resultado="${repetida ? 'repetida' : 'resuelta'}"`; counters.set(key,(counters.get(key)??0)+1);
   r.log.info({ operacion: op, repetida, solicitudId: dato.solicitudId, planId: dato.planId, estado: dato.estado },'Gestión de membresía resuelta'); return result;
  } catch (e) {
   const key = `operacion="${op}",resultado="fallida"`; counters.set(key,(counters.get(key)??0)+1);
   r.log.warn({ operacion: op, codigo: (e as { codigo?: string }).codigo ?? 'PERSISTENCIA_FALLIDA' },'Operación de membresía no confirmada; consultar/reintentar con misma clave'); throw e;
  }
 };
 app.get('/api/v1/planes',{ onRequest: lectura },async () => ({ items: await repo().planes() }));
 app.post('/api/v1/planes',{ onRequest: admin },async (r,reply) => reply.code(201).send(await operar(r,'crearPlan')));
 app.put<{ Params: { id: string } }>('/api/v1/planes/:id/estado',{ onRequest: admin },async r => operar(r,'estadoPlan',{ id: identificadorGestion(r.params.id) }));
 app.get('/api/v1/socios',{ onRequest: admin },async r => { const p=paginaGestion(r.query); return { ...p,items:await repo().socios(p.pagina,p.tamanio) }; });
 app.get('/api/v1/solicitudes',{ onRequest: admin },async r => { const p=paginaGestion(r.query); return { ...p,items:await repo().solicitudes(undefined,p.pagina,p.tamanio) }; });
 app.get<{ Params: { socioId: string } }>('/api/v1/socios/:socioId/solicitudes',{ onRequest: lectura },async r => {
  const id=identificadorGestion(r.params.socioId), who=identidad(r);
  if (who.rol!=='ADMIN' && who.socioId!==id) throw falloGestion('ACCESO_DENEGADO','Sólo puede consultar sus solicitudes.',403);
  const p=paginaGestion(r.query); return { ...p,items:await repo().solicitudes(id,p.pagina,p.tamanio) };
 });
 app.post<{ Params: { socioId: string } }>('/api/v1/socios/:socioId/solicitudes',{ onRequest: admin },async (r,reply) => reply.code(201).send(await operar(r,'solicitar',{ socioId:identificadorGestion(r.params.socioId) })));
 app.get<{ Params: { id: string } }>('/api/v1/solicitudes/:id',{ onRequest: lectura },async r => {
  const s=await repo().solicitud(identificadorGestion(r.params.id)),who=identidad(r);
  if(who.rol!=='ADMIN' && who.socioId!==s.socioId) throw falloGestion('ACCESO_DENEGADO','Sólo puede consultar sus solicitudes.',403);
  return s;
 });
 app.post<{ Params: { id: string } }>('/api/v1/solicitudes/:id/pagos',{ onRequest: admin },async (r,reply) => reply.code(201).send(await operar(r,'registrarPago',{id:identificadorGestion(r.params.id)})));
 app.post<{ Params: { id: string } }>('/api/v1/solicitudes/:id/rechazar',{ onRequest: admin },async r => operar(r,'rechazarSolicitud',{id:identificadorGestion(r.params.id)}));
 app.post<{ Params: { id: string } }>('/api/v1/pagos/:id/confirmar',{ onRequest: admin },async r => operar(r,'confirmarPago',{id:identificadorGestion(r.params.id)}));
 return () => ['# TYPE membresias_operaciones_total counter',...Array.from(counters,([labels,n])=>`membresias_operaciones_total{service="socios-membresias",instance="${hostname()}",${labels}} ${n}`)].join('\n');
}
