import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
// Sólo PostgreSQL efímero propio. No lee .env ni llama proveedores/pasarelas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { postgresPrueba } from './membresias/entorno.mjs';
import sociosModule from '../services/socios-membresias/dist/app.js';
import repos from '../services/socios-membresias/dist/repository.js';
import gestionModule from '../services/socios-membresias/dist/membresias.postgres.js';
import adminModule from '../services/socios-membresias/dist/crear-admin.js';
import clasesModule from '../services/clases-reservas/dist/app.js';
import clasesRepos from '../services/clases-reservas/dist/repository.js';
import clientes from '../services/clases-reservas/dist/clients/socios.client.js';

test('Planes, pagos y membresías: PostgreSQL real y HTTP entre dos instancias', {timeout:120000},async t=>{
 const contract=parse(await readFile('docs/contracts/openapi-membresias-v1.yaml','utf8')),ajv=new Ajv2020({strict:false});addFormats(ajv);const validators=new Map();
 const e=await postgresPrueba();const apps=[];const pool=e.pool('socios'),poolB=e.pool('socios');
 const logs=[];let buffer='';const logStream=new Writable({write(chunk,_encoding,done){buffer+=chunk.toString();const lines=buffer.split('\n');buffer=lines.pop();for(const line of lines)if(line.trim())logs.push(JSON.parse(line));done();}});
 const auth={jwtSecret:'clave-ficticia-membresias-'.repeat(3),internalApiKey:'interna-ficticia-membresias'};
 const repo=new repos.PostgresSociosRepository(pool),repoB=new repos.PostgresSociosRepository(poolB);
 const api=async(base,path,{method='GET',token,body,key}={})=>{
  const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{}),traceparent:'00-'+'c'.repeat(32)+'-'+'d'.repeat(16)+'-01'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const bodyResult=await r.json();
  const pathname=new URL(base+path).pathname;
  const entry=Object.entries(contract.paths).find(([template])=>new RegExp('^'+template.replace(/\{[^}]+\}/g,'[^/]+')+'$').test(pathname));
  const schema=entry?.[1][method.toLowerCase()]?.responses?.[r.status]?.content?.['application/json']?.schema;
  if(schema){const id=entry[0]+method+r.status;if(!validators.has(id))validators.set(id,ajv.compile({...schema,components:contract.components}));const v=validators.get(id);assert.ok(v(bodyResult),JSON.stringify(v.errors));}
  return {status:r.status,body:bodyResult,headers:r.headers};
 };
 const start=async(repository,p)=>{const app=sociosModule.buildSociosApp({...auth,repository,gestion:new gestionModule.PostgresGestionMembresias(p),logger:{stream:logStream,level:'info'}});apps.push(app);await app.listen({host:'127.0.0.1',port:0});return {app,url:'http://127.0.0.1:'+app.server.address().port};};
 try{
  await Promise.all([repo.inicializarEsquema(),repoB.inicializarEsquema()]);
  const admin=await adminModule.crearAdministrador(repo,{dni:'90000800',nombre:'Admin sintético',email:'admin-membresias@example.invalid',password:'clave-sintetica'});
  const a=await start(repo,pool),b=await start(repoB,poolB);
  const login=async(email,password='clave-sintetica')=>{const r=await api(a.url,'/api/v1/auth/login',{method:'POST',body:{emailOrDni:email,password}});assert.equal(r.status,200);return r.body.token;};
  const token=await login(admin.email);
  const mutate=(path,body={},key=randomUUID(),base=a.url,who=token,method='POST')=>api(base,path,{method,body,key,token:who});
  let sequence=0;
  const alta=async()=>{const n=++sequence;const r=await mutate('/api/v1/socios',{dni:'80000'+n,nombre:'Persona sintética '+n,email:'persona-'+n+'@example.invalid',password:'clave-sintetica'});assert.equal(r.status,201);assert.equal(r.body.membresia,null);return r.body.socio;};
  const socio=await alta(),otro=await alta();const socioToken=await login(socio.email),otroToken=await login(otro.email);
  const startDate=new Date(Date.now()-86400000).toISOString(),endDate=new Date(Date.now()+30*86400000).toISOString();
  let plan,sol,pago,rollbackKey;
  const solicitar=(socioId=socio.socioId,more={},key=randomUUID(),base=a.url)=>mutate('/api/v1/socios/'+socioId+'/solicitudes',{planId:plan.planId,fechaInicio:startDate,fechaFin:endDate,...more},key,base);
  const registrar=async(s,referencia='ref-'+randomUUID())=>{const r=await mutate('/api/v1/solicitudes/'+s.solicitudId+'/pagos',{referencia,importeMinor:s.importeMinor,moneda:s.moneda});assert.equal(r.status,201);return r.body;};
  const habilitado=async(id,fecha)=>{const r=await api(a.url,'/api/v1/socios/'+id+'/habilitacion'+(fecha?'?fecha='+encodeURIComponent(fecha):''),{token});return r.body.habilitado;};

  await t.test('Base vacía: no se inventan planes ni membresía para alta administrativa',async()=>{
   assert.deepEqual((await api(a.url,'/api/v1/planes',{token})).body.items,[]);assert.equal(await habilitado(socio.socioId),false);
   const list=await api(a.url,'/api/v1/socios',{token});assert.equal(list.status,200);assert.ok(list.body.items.some(s=>s.socioId===socio.socioId));assert.ok(!JSON.stringify(list.body).includes('password'));
  });
  await t.test('Permisos reales: SOCIO/clave técnica/no autenticado no administran ni leen terceros',async()=>{
   for(const path of ['/api/v1/planes','/api/v1/socios/'+socio.socioId+'/solicitudes','/api/v1/solicitudes/no-existe/pagos','/api/v1/pagos/no-existe/confirmar'])assert.equal((await mutate(path,{},undefined,a.url,socioToken)).status,403);
   assert.equal((await api(a.url,'/api/v1/socios',{token:socioToken})).status,403);
   assert.equal((await api(a.url,'/api/v1/planes')).status,401);
   assert.equal((await api(a.url,'/api/v1/socios/'+socio.socioId+'/solicitudes',{token:otroToken})).status,403);
  });
  await t.test('Plan configurado por ADMIN, replay durable y clave incompatible',async()=>{
   const key=randomUUID(),body={nombre:'Plan sintético de integración',importeMinor:12345,moneda:'ARS'};
   const r=await mutate('/api/v1/planes',body,key);assert.equal(r.status,201);plan=r.body;
   assert.deepEqual((await mutate('/api/v1/planes',body,key,b.url)).body,plan);
   assert.equal((await mutate('/api/v1/planes',{...body,importeMinor:12346},key)).status,409);
   assert.equal((await mutate('/api/v1/planes',{...body,importeMinor:1.5})).status,400);
  });
  await t.test('Plan inexistente/no disponible y fechas inválidas no crean solicitud',async()=>{
   assert.equal((await solicitar(undefined,{planId:'ausente'})).status,404);
   assert.equal((await solicitar(undefined,{fechaInicio:'fecha-invalida'})).status,400);
   assert.equal((await solicitar(undefined,{fechaFin:'2000-01-01T00:00:00Z'})).status,400);
   await mutate('/api/v1/planes/'+plan.planId+'/estado',{estado:'INACTIVO'},randomUUID(),a.url,token,'PUT');
   assert.equal((await solicitar()).status,422);
   await mutate('/api/v1/planes/'+plan.planId+'/estado',{estado:'ACTIVO'},randomUUID(),a.url,token,'PUT');
  });
  await t.test('Solicitud concurrente por claves diferentes deja una sola pendiente',async()=>{
   const responses=await Promise.all([solicitar(),solicitar(undefined,{},randomUUID(),b.url)]);
   assert.deepEqual(responses.map(r=>r.status).sort(),[201,409]);sol=responses.find(r=>r.status===201).body;
   assert.equal(sol.estado,'PENDIENTE');assert.equal(await habilitado(socio.socioId),false);
   const own=await api(a.url,'/api/v1/solicitudes/'+sol.solicitudId,{token:socioToken});assert.equal(own.status,200);assert.equal(own.headers.get('cache-control'),'no-store');
   assert.equal((await api(a.url,'/api/v1/solicitudes/'+sol.solicitudId,{token:otroToken})).status,403);
  });
  await t.test('Registro manual no habilita; importe/moneda incompatibles se rechazan',async()=>{
   for(const more of [{importeMinor:1},{moneda:'USD'}])assert.equal((await mutate('/api/v1/solicitudes/'+sol.solicitudId+'/pagos',{referencia:'ref-'+randomUUID(),importeMinor:sol.importeMinor,moneda:sol.moneda,...more})).status,422);
   const key=randomUUID(),body={referencia:'pago-sintetico-'+randomUUID(),importeMinor:sol.importeMinor,moneda:sol.moneda};
   const r=await mutate('/api/v1/solicitudes/'+sol.solicitudId+'/pagos',body,key);assert.equal(r.status,201);pago=r.body.pago;
   assert.deepEqual((await mutate('/api/v1/solicitudes/'+sol.solicitudId+'/pagos',body,key,b.url)).body,r.body);
   assert.equal(await habilitado(socio.socioId),false);assert.equal(r.body.comprobante,null);
  });
  const clasePool=e.pool('clases'),claseRepo=new clasesRepos.PostgresClaseRepository(clasePool);await claseRepo.inicializarEsquema();
  const claseInicio=new Date(Date.now()+86400000).toISOString(),claseFuera=new Date(Date.now()+60*86400000).toISOString();
  for(const [id,inicio] of [['membresia-cupo',claseInicio],['fuera-vigencia',claseFuera],['socios-caido',claseInicio]])await clasePool.query('INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad,publicada) VALUES($1,$1,$2,$3,$4,2,true)',[id,'sede-prueba',inicio,new Date(Date.parse(inicio)+3600000).toISOString()]);
  const clases=clasesModule.buildApp({...auth,apiKey:'externa-ficticia',repository:claseRepo,sociosClient:new clientes.HttpSociosClient(a.url,300,auth.internalApiKey)});apps.push(clases);await clases.listen({host:'127.0.0.1',port:0});const clasesUrl='http://127.0.0.1:'+clases.server.address().port;
  const reservar=claseId=>api(clasesUrl,'/api/v1/reservas',{method:'POST',token:socioToken,body:{claseId,ingresarEsperaSiLlena:false}});
  await t.test('Reserva antes de confirmar pago se rechaza',async()=>{assert.equal((await reservar('membresia-cupo')).status,422);});
  await t.test('Fallo real al insertar comprobante revierte pago, membresía, solicitud e idempotencia',async()=>{
   await pool.query(`CREATE FUNCTION prueba_fallo_comprobante() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Fallo sintético de comprobante'; END $$;
    CREATE TRIGGER prueba_rollback BEFORE INSERT ON comprobantes_membresia FOR EACH ROW EXECUTE FUNCTION prueba_fallo_comprobante();`);
   const key='rollback-'+randomUUID();rollbackKey=key;const r=await mutate('/api/v1/pagos/'+pago.pagoId+'/confirmar',{},key);assert.equal(r.status,500);
   assert.equal((await pool.query('SELECT estado FROM pagos_membresia WHERE pago_id=$1',[pago.pagoId])).rows[0].estado,'PENDIENTE');
   assert.equal((await repo.obtenerMembresias(socio.socioId)).length,0);
   assert.equal((await pool.query('SELECT 1 FROM operaciones_membresia WHERE clave=$1',[key])).rowCount,0);
   await pool.query('DROP TRIGGER prueba_rollback ON comprobantes_membresia; DROP FUNCTION prueba_fallo_comprobante()');
   assert.equal((await pool.query('SELECT estado FROM solicitudes_planes WHERE solicitud_id=$1',[sol.solicitudId])).rows[0].estado,'PENDIENTE');
   assert.equal((await pool.query('SELECT 1 FROM comprobantes_membresia WHERE pago_id=$1',[pago.pagoId])).rowCount,0);
  });
  await t.test('Confirmación concurrente/reintento y respuesta perdida no duplican efectos',async()=>{
   const results=await Promise.all(Array.from({length:12},(_,i)=>mutate('/api/v1/pagos/'+pago.pagoId+'/confirmar',{},i<4?rollbackKey:randomUUID(),i%2?a.url:b.url)));
   assert.ok(results.every(r=>r.status===200));assert.equal(new Set(results.map(r=>r.body.comprobante.comprobanteId)).size,1);
   assert.equal((await repo.obtenerMembresias(socio.socioId)).length,1);
   assert.equal((await pool.query('SELECT 1 FROM comprobantes_membresia WHERE pago_id=$1',[pago.pagoId])).rowCount,1);
   assert.equal((await mutate('/api/v1/pagos/'+pago.pagoId+'/confirmar',{pagoConfirmado:true})).status,400);
   assert.equal((await mutate('/api/v1/solicitudes/'+sol.solicitudId+'/rechazar')).status,409);
  });
  await t.test('Membresía confirmada permite reservar; duplicada y fuera de vigencia se rechazan',async()=>{
   assert.equal(await habilitado(socio.socioId),true);
   assert.equal((await reservar('membresia-cupo')).status,201);assert.equal((await reservar('membresia-cupo')).status,409);
   assert.equal((await reservar('fuera-vigencia')).status,422);
   const own=await api(a.url,'/api/v1/socios/'+socio.socioId,{token:socioToken});assert.equal(own.body.membresia.estado,'HABILITADA');
  });
  await t.test('Referencia de cobro única entre socios; rechazo impide habilitar y confirmar',async()=>{
   const solicitud=(await solicitar(otro.socioId)).body;
   assert.equal((await mutate('/api/v1/solicitudes/'+solicitud.solicitudId+'/pagos',{referencia:pago.referencia,importeMinor:solicitud.importeMinor,moneda:solicitud.moneda})).status,409);
   const registrado=await registrar(solicitud);const rejected=await mutate('/api/v1/solicitudes/'+solicitud.solicitudId+'/rechazar');assert.equal(rejected.body.pago.estado,'RECHAZADO');
   assert.equal((await mutate('/api/v1/pagos/'+registrado.pago.pagoId+'/confirmar')).status,409);assert.equal(await habilitado(otro.socioId),false);
  });
  await t.test('Nuevo período explícito no superpuesto; renovación futura conserva cobertura actual',async()=>{
   const inicio=new Date(Date.parse(endDate)+1).toISOString(),fin=new Date(Date.parse(endDate)+30*86400000).toISOString();
   const s=(await solicitar(undefined,{fechaInicio:inicio,fechaFin:fin})).body;const r=await registrar(s);
   assert.equal((await mutate('/api/v1/pagos/'+r.pago.pagoId+'/confirmar')).status,200);
   assert.equal((await repo.obtenerMembresias(socio.socioId)).length,2);assert.equal(await habilitado(socio.socioId),true);assert.equal(await habilitado(socio.socioId,inicio),true);
  });
  await t.test('Período superpuesto queda bloqueado sin confirmar pago ni activar de nuevo',async()=>{
   const s=(await solicitar()).body,r=await registrar(s);
   const result=await mutate('/api/v1/pagos/'+r.pago.pagoId+'/confirmar');assert.equal(result.status,422);assert.equal(result.body.codigo,'VIGENCIA_REQUIERE_REVISION');
   assert.equal((await pool.query('SELECT estado FROM pagos_membresia WHERE pago_id=$1',[r.pago.pagoId])).rows[0].estado,'PENDIENTE');
   assert.equal((await mutate('/api/v1/solicitudes/'+s.solicitudId+'/rechazar')).status,200);
  });
  await t.test('Cambio de plan a inactivo entre solicitud y confirmación bloquea sin efectos',async()=>{
   const s=(await solicitar(otro.socioId)).body,r=await registrar(s);
   await mutate('/api/v1/planes/'+plan.planId+'/estado',{estado:'INACTIVO'},randomUUID(),a.url,token,'PUT');
   assert.equal((await mutate('/api/v1/pagos/'+r.pago.pagoId+'/confirmar')).status,422);assert.equal(await habilitado(otro.socioId),false);
   await mutate('/api/v1/planes/'+plan.planId+'/estado',{estado:'ACTIVO'},randomUUID(),a.url,token,'PUT');
   await mutate('/api/v1/solicitudes/'+s.solicitudId+'/rechazar');
  });
  await t.test('Solicitud vencida no confirma; rechazo repetido conserva estado y claves incompatibles se detectan',async()=>{
   const s=(await solicitar(otro.socioId)).body,r=await registrar(s);
   // Sólo fixture efímero: representa el paso del tiempo sin una espera prolongada.
   await pool.query('UPDATE solicitudes_planes SET fecha_inicio=$1,fecha_fin=$2 WHERE solicitud_id=$3',['2020-01-01','2020-01-02',s.solicitudId]);
   const confirm=await mutate('/api/v1/pagos/'+r.pago.pagoId+'/confirmar');assert.equal(confirm.status,422);assert.equal(confirm.body.codigo,'SOLICITUD_VENCIDA');
   assert.equal(await habilitado(otro.socioId),false);
   const key=randomUUID();assert.equal((await mutate('/api/v1/solicitudes/'+s.solicitudId+'/rechazar',{},key)).status,200);
   assert.equal((await mutate('/api/v1/solicitudes/'+s.solicitudId+'/rechazar',{},randomUUID(),b.url)).body.estado,'RECHAZADA');
   assert.equal((await mutate('/api/v1/pagos/'+r.pago.pagoId+'/confirmar',{},key)).status,409);
  });
  await t.test('Reconstruir aplicación conserva comprobantes y solicitudes en PostgreSQL',async()=>{
   const c=await start(new repos.PostgresSociosRepository(poolB),poolB);
   const result=await api(c.url,'/api/v1/solicitudes/'+sol.solicitudId,{token:socioToken});assert.equal(result.body.estado,'CONFIRMADA');assert.ok(result.body.comprobante.comprobanteId);
   const metricas=await api(a.url,'/api/v1/socios/'+socio.socioId+'/solicitudes',{token:socioToken});assert.equal(metricas.status,200);
   assert.equal((await mutate('/api/v1/solicitudes/'+sol.solicitudId+'/rechazar',{},randomUUID(),a.url,otroToken)).status,403);
  });
  await t.test('Observabilidad: replay, rechazos y fallo transaccional correlacionados sin importes/credenciales',async()=>{
   const response=await fetch(a.url+'/metrics'),metrics=await response.text();assert.equal(response.status,200);
   assert.match(metrics,/membresias_operaciones_total/);assert.match(metrics,/resultado="repetida"/);assert.match(metrics,/resultado="fallida"/);
   assert.equal(metrics.includes(socio.socioId),false);
   const business=logs.filter(l=>l.operacion);assert.ok(business.some(l=>l.operacion==='confirmarPago'&&l.repetida===true&&l.trace_id==='c'.repeat(32)));
   assert.ok(business.some(l=>l.codigo==='PERSISTENCIA_FALLIDA'));assert.ok(business.some(l=>l.estado==='RECHAZADA'));
   assert.ok(business.every(l=>!('importeMinor' in l)&&!('password' in l)&&!('clave' in l)));
  });
  await t.test('Actualización desde DDL previo conserva socios, solicitudes externas y membresías',async()=>{
   const old=execFileSync('git',['show','db13cee:services/socios-membresias/src/repository.ts'],{encoding:'utf8'});
   const ddl=old.match(/await client.query\(`([\s\S]*?)`\);/)[1];const upgrade=e.pool('actualizacion');await upgrade.query(ddl);
   await upgrade.query("INSERT INTO socios(socio_id,dni,nombre,email,rol,estado) VALUES('anterior','70000000','Anterior','anterior@example.invalid','SOCIO','ACTIVO')");
   await upgrade.query("INSERT INTO solicitudes_membresia VALUES('anterior-sol','anterior','PENDIENTE',now())");
   await upgrade.query("INSERT INTO membresias(membresia_id,socio_id,tipo_plan,fecha_inicio,fecha_fin,estado) VALUES('anterior-mem','anterior','Plan histórico','2020-01-01','2020-02-01','VENCIDA')");
   const before=(await upgrade.query("SELECT row_to_json(s) datos FROM socios s WHERE socio_id='anterior'")).rows[0];
   await new repos.PostgresSociosRepository(upgrade).inicializarEsquema();await new repos.PostgresSociosRepository(upgrade).inicializarEsquema();
   assert.deepEqual((await upgrade.query("SELECT row_to_json(s) datos FROM socios s WHERE socio_id='anterior'")).rows[0],before);
   assert.equal((await upgrade.query("SELECT * FROM solicitudes_membresia WHERE solicitud_id='anterior-sol'")).rowCount,1);
   assert.equal((await upgrade.query("SELECT * FROM membresias WHERE membresia_id='anterior-mem'")).rowCount,1);
  });
  if(process.env.MEMBRESIAS_PLAYWRIGHT_MODULE)await t.test('Navegador real: alta, plan, solicitud, cobro, confirmación, portal y reserva', {timeout:60000},async()=>{
   const { verificarMembresiasWeb }=await import('./membresias/web.mjs');await verificarMembresiasWeb({sociosUrl:a.url,clasesUrl,adminEmail:admin.email,adminPassword:'clave-sintetica',claseId:'socios-caido'});
  });
  await t.test('Socios temporalmente indisponible: Clases no interpreta habilitación',async()=>{
   await a.app.close();assert.equal((await reservar('socios-caido')).status,503);
  });
  console.log('PostgreSQL real '+e.version+'; Node '+process.version+'; fixtures de importe/moneda explícitamente sintéticos, no tarifas desplegadas.');
 }finally{for(const app of apps.reverse())await app.close();await e.close();}
});
