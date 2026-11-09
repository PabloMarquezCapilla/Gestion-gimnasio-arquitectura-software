import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import gestion from '../dist/application/gestion-clases.service.js';
import sedesModule from '../dist/clients/sedes.client.js';
import apps from '../dist/app.js';

const datos = { nombre:' Yoga ',actividad:' YOGA ',profesor:' Ana ',sedeId:'sede-1',
  inicio:'2030-01-02T15:00:00-03:00',fin:'2030-01-02T16:00:00-03:00',capacidad:5 };

test('Publicación valida todos los campos y normaliza datos sin alterar el ID de sede',()=>{
  const parsed = gestion.datosClase(datos,false);
  assert.equal(parsed.datos.nombre,'Yoga'); assert.equal(parsed.datos.inicio,'2030-01-02T18:00:00.000Z');
  assert.equal(parsed.versionEsperada,null);
  assert.equal(gestion.datosClase({...datos,versionEsperada:1},true).versionEsperada,1);
  for(const body of [null,[],{}, {...datos,extra:true},{...datos,profesor:' '},{...datos,actividad:''},
    {...datos,capacidad:1.2},{...datos,capacidad:0},{...datos,capacidad:2147483648},
    {...datos,nombre:'a'.repeat(101)},{...datos,inicio:'2030-02-30T00:00:00Z'},
    {...datos,inicio:'2030-01-02T15:00:00'},{...datos,fin:datos.inicio}]) {
    assert.throws(()=>gestion.datosClase(body,false),gestion.GestionClasesError);
  }
  assert.throws(()=>gestion.datosClase(datos,true),gestion.GestionClasesError);
});

test('Servicio recupera una operación aplicada antes de consultar fecha o dependencia',async()=>{
  const anterior = {claseId:'clase-original',version:1};
  const service = new gestion.GestionClasesService({recuperar:async()=>anterior},undefined,()=>new Date('2031-01-01'));
  assert.equal(await service.guardar('admin','clave-123',null,datos,'Bearer ficticio'),anterior);
  await assert.rejects(service.guardar('admin','corta',null,datos,'Bearer ficticio'),{codigo:'IDEMPOTENCIA_INVALIDA'});
});

test('Servicio no fabrica una sede cuando falta Accesos o el ID no existe',async()=>{
  let guardados=0;
  const repo={recuperar:async()=>null,guardar:async()=>{guardados++;}};
  const clock=()=>new Date('2030-01-01');
  await assert.rejects(new gestion.GestionClasesService(repo,undefined,clock).guardar('admin','clave-123',null,datos,'Bearer ficticio'),{codigo:'SEDES_NO_DISPONIBLES'});
  const client={listar:async()=>[{sedeId:'sede-otra',nombre:'Otra'}]};
  await assert.rejects(new gestion.GestionClasesService(repo,client,clock).guardar('admin','clave-123',null,datos,'Bearer ficticio'),{codigo:'SEDE_NO_ENCONTRADA'});
  assert.equal(guardados,0);
});

test('Administración exige JWT ADMIN incluso cuando el adaptador no está disponible',async()=>{
  const app=apps.buildApp({apiKey:'ficticia',internalApiKey:'interna',jwtSecret:'secreto-local-de-prueba-'.repeat(3)});
  try {
    await app.ready();
    const socio=app.jwt.sign({sub:'socio-prueba',rol:'SOCIO'}),admin=app.jwt.sign({sub:'admin-prueba',rol:'ADMIN'});
    for(const [method,url,body] of [['GET','/api/v1/admin/clases/clase-1',undefined],['POST','/api/v1/admin/clases',datos],['PUT','/api/v1/admin/clases/clase-1',{...datos,versionEsperada:1}]]) {
      assert.equal((await app.inject({method,url,payload:body})).statusCode,401);
      assert.equal((await app.inject({method,url,payload:body,headers:{authorization:'Bearer '+socio}})).statusCode,403);
      const result=await app.inject({method,url,payload:body,headers:{authorization:'Bearer '+admin,'idempotency-key':'clave-prueba'}});
      assert.equal(result.statusCode,503);assert.equal(result.headers['cache-control'],'no-store');
    }
  } finally { await app.close(); }
});

test('Cliente de sedes propaga sesión y traza, controla fallos, cuerpo y presupuesto',async()=>{
  const app=Fastify(); let modo='ok';
  app.get('/api/v1/accesos/sedes',async(req,reply)=>{
    assert.equal(req.headers.authorization,'Bearer jwt-ficticio');
    assert.equal(req.headers.traceparent,'00-'+'a'.repeat(32)+'-'+'b'.repeat(16)+'-01');
    if(modo==='lento') {await new Promise(r=>setTimeout(r,150));return {items:[]};}
    if(modo==='error') return reply.code(401).send({codigo:'NO_AUTENTICADO'});
    if(modo==='redireccion') return reply.redirect('/otra-ruta');
    if(modo==='grande') return {items:[],extra:'x'.repeat(1024*1024)};
    if(modo==='invalido') return {items:[{sedeId:'repetida',nombre:'Sede'},{sedeId:'repetida',nombre:'Otra'}]};
    return {items:[{sedeId:'sede-1',nombre:'Sede ficticia'}]};
  });
  await app.listen({host:'127.0.0.1',port:0});
  try {
    const url='http://127.0.0.1:'+app.server.address().port;
    const client=new sedesModule.HttpSedesClient(url,1000);
    const context={traceId:'a'.repeat(32),spanId:'b'.repeat(16),traceFlags:'01'};
    assert.deepEqual(await client.listar('Bearer jwt-ficticio',context),[{sedeId:'sede-1',nombre:'Sede ficticia'}]);
    for(modo of ['error','redireccion','invalido','grande']) {
      await assert.rejects(client.listar('Bearer jwt-ficticio',context),{statusCode:503,codigo:'SEDES_NO_DISPONIBLES'});
    }
    modo='lento';
    await assert.rejects(new sedesModule.HttpSedesClient(url,30).listar('Bearer jwt-ficticio',context),{codigo:'SEDES_NO_DISPONIBLES'});
  } finally { await app.close(); }
});
