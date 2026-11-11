import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { setTimeout as pause } from 'node:timers/promises';
import { connect } from 'amqplib';
import { postgresPrueba } from './membresias/entorno.mjs';
import sociosRepo from '../services/socios-membresias/dist/repository.js';
import gestionModule from '../services/socios-membresias/dist/membresias.postgres.js';
import sociosApp from '../services/socios-membresias/dist/app.js';
import adminModule from '../services/socios-membresias/dist/crear-admin.js';
import outboxModule from '../services/socios-membresias/dist/membresias.eventos.js';
import publicadorModule from '../services/socios-membresias/dist/membresias.rabbit.js';
import clasesRepo from '../services/clases-reservas/dist/repository.js';
import eventosRepo from '../services/clases-reservas/dist/membresias-eventos.postgres.js';
import eventosService from '../services/clases-reservas/dist/application/membresias-eventos.service.js';
import consumidorModule from '../services/clases-reservas/dist/membresias-eventos.rabbit.js';
import reservasModule from '../services/clases-reservas/dist/application/reservas.service.js';
import clientes from '../services/clases-reservas/dist/clients/socios.client.js';

test('Suspensión, Outbox/RabbitMQ/Inbox y recuperación con PostgreSQL reales',{timeout:180000},async t=>{
  const ajv=new Ajv({strict:false});addFormats(ajv);
  const contrato=parse(await readFile('docs/contracts/openapi-membresias-v1.yaml','utf8'));
  const validarSuspension=ajv.compile(contrato.paths['/api/v1/membresias/{id}/suspender'].post.responses['200'].content['application/json'].schema);
  const validarEvento=ajv.compile(JSON.parse(await readFile('docs/contracts/membresia-actualizada-v1.schema.json','utf8')));
  const e=await postgresPrueba();
  const pool=e.pool('socios'),clasesPool=e.pool('clases');
  const rabbitId='pulse-eventos-'+randomUUID(),password=randomBytes(24).toString('hex');
  let rabbitCreated=false,connection,consumer,consumerB,publisher,app;
  const docker=(args,env={})=>{
    const r=spawnSync('docker',args,{encoding:'utf8',windowsHide:true,timeout:60000,env:{...process.env,...env}});
    if(r.status!==0)throw new Error(r.stderr||r.error?.message||'Docker de prueba falló.');return r.stdout.trim();
  };
  const ownedRabbit=()=>{assert.equal(docker(['inspect','--format','{{index .Config.Labels "pulse.eventos.test"}}',rabbitId]),rabbitId);};
  const eventually=async(fn,timeout=15000)=>{const end=Date.now()+timeout;while(Date.now()<end){const r=await fn();if(r)return r;await pause(100);}throw new Error('No se alcanzó el resultado esperado.');};
  const logs=[],logger={info:(data,msg)=>logs.push({data,msg}),warn:(data,msg)=>logs.push({data,msg})};
  try{
    const socket=createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});
    const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
    // Puerto explícito para conservar la misma URL al detener/iniciar el contenedor.
    docker(['run','--detach','--name',rabbitId,'--label','pulse.eventos.test='+rabbitId,'--publish','127.0.0.1:'+port+':5672',
      '--env','RABBITMQ_DEFAULT_USER=prueba','--env','RABBITMQ_DEFAULT_PASS','rabbitmq:4.1-alpine'],{RABBITMQ_DEFAULT_PASS:password});rabbitCreated=true;
    assert.equal(Number(docker(['port',rabbitId,'5672/tcp']).split(':').at(-1)),port);
    const rabbitUrl='amqp://prueba:'+password+'@127.0.0.1:'+port;
    await eventually(async()=>{try{connection=await connect(rabbitUrl,{timeout:1000});connection.on('error',()=>{});return true;}catch{return false;}},60000);
    const repo=new sociosRepo.PostgresSociosRepository(pool),clases=new clasesRepo.PostgresClaseRepository(clasesPool);
    await repo.inicializarEsquema({ cargarDatosDemo: true });await clases.inicializarEsquema();
    const admin=await adminModule.crearAdministrador(repo,{dni:'88009911',nombre:'Admin de prueba',email:'eventos@example.invalid',password:'sintetica-eventos'});
    const auth={jwtSecret:'eventos-sintetico-'.repeat(4),internalApiKey:'servicios-eventos-ficticia'};
    const gestion=new gestionModule.PostgresGestionMembresias(pool);
    app=sociosApp.buildSociosApp({...auth,repository:repo,gestion});await app.listen({host:'127.0.0.1',port:0});
    const base='http://127.0.0.1:'+app.server.address().port;
    const api=async(path,{token,body,method='GET',key=randomUUID()}={})=>{
      const r=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{}),'Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
      return {status:r.status,body:await r.json(),headers:r.headers};
    };
    const token=(await api('/api/v1/auth/login',{method:'POST',body:{emailOrDni:admin.email,password:'sintetica-eventos'}})).body.token;
    const ahora=new Date(),inicio=new Date(ahora.getTime()-3600000).toISOString(),fin=new Date(ahora.getTime()+86400000).toISOString();
    const claseId='evento-clase',socioId='socio-evento';
    const alta=await api('/api/v1/socios',{token,method:'POST',body:{dni:'88990022',nombre:'Socio ficticio',email:'socio-evento@example.invalid',password:'sintetica-eventos'}});
    const persona=alta.body.socio;assert.equal(alta.status,201);
    const socioToken=(await api('/api/v1/auth/login',{method:'POST',body:{emailOrDni:persona.email,password:'sintetica-eventos'}})).body.token;
    await pool.query("INSERT INTO membresias(membresia_id,socio_id,tipo_plan,fecha_inicio,fecha_fin,estado) VALUES($1,$2,'Prueba',$3,$4,'HABILITADA')",['mem-evento',persona.socioId,inicio,fin]);
    await clasesPool.query("INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad,publicada) VALUES($1,'Clase de prueba','sede-demo-01',$2,$3,1,true)",[claseId,new Date(ahora.getTime()+3600000),new Date(ahora.getTime()+7200000)]);
    await clases.reservarCupo(claseId,persona.socioId);
    await clases.ingresarListaEspera(claseId,'socio-demo-02');
    let suspension,evento;
    await t.test('HTTP exige ADMIN, clave y cuerpo vacío; conserva fecha y devuelve suspensión durable',async()=>{
      for(const [who,status] of [[undefined,401],[socioToken,403]])assert.equal((await api('/api/v1/membresias/mem-evento/suspender',{token:who,method:'POST',body:{}})).status,status);
      assert.equal((await api('/api/v1/membresias/mem-evento/suspender',{token,method:'POST',body:{fechaFin:fin}})).status,400);
      const key=randomUUID();const r=await api('/api/v1/membresias/mem-evento/suspender',{token,method:'POST',body:{},key});assert.equal(r.status,200);suspension=r.body;
      assert.ok(validarSuspension(suspension),JSON.stringify(validarSuspension.errors));
      assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(suspension.estado,'SUSPENDIDA');assert.equal(suspension.fechaInicio,inicio);assert.equal(suspension.fechaFin,fin);
      assert.deepEqual((await api('/api/v1/membresias/mem-evento/suspender',{token,method:'POST',body:{},key})).body,suspension);
      assert.deepEqual((await api('/api/v1/membresias/mem-evento/suspender',{token,method:'POST',body:{}})).body,suspension);
      assert.equal(Number((await pool.query('SELECT count(*) FROM membresias_outbox')).rows[0].count),1);
      evento=(await pool.query('SELECT evento FROM membresias_outbox WHERE event_id=$1',[suspension.eventId])).rows[0].evento;
      assert.ok(validarEvento(evento),JSON.stringify(validarEvento.errors));
      assert.equal((await api('/api/v1/socios/'+persona.socioId+'/habilitacion',{token})).body.habilitado,false);
      assert.equal((await api('/api/v1/socios/'+persona.socioId+'/membresias',{token:socioToken})).body.items[0].estado,'SUSPENDIDA');
    });
    await t.test('Fallo antes de guardar idempotencia revierte estado y Outbox juntos',async()=>{
      await pool.query("INSERT INTO membresias(membresia_id,socio_id,tipo_plan,fecha_inicio,fecha_fin,estado) VALUES('mem-rollback',$1,'Prueba',$2,$3,'HABILITADA')",[persona.socioId,inicio,fin]);
      await pool.query("CREATE FUNCTION fallo_evento() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo sintetico'; END; $$; CREATE TRIGGER fallo_evento BEFORE INSERT ON operaciones_membresia FOR EACH ROW EXECUTE FUNCTION fallo_evento()");
      await assert.rejects(gestion.ejecutar(admin.socioId,randomUUID(),'suspenderMembresia',{id:'mem-rollback'}));
      assert.equal((await pool.query("SELECT estado FROM membresias WHERE membresia_id='mem-rollback'")).rows[0].estado,'HABILITADA');
      assert.equal((await pool.query("SELECT 1 FROM membresias_outbox WHERE membresia_id='mem-rollback'")).rowCount,0);
      await pool.query('DROP TRIGGER fallo_evento ON operaciones_membresia; DROP FUNCTION fallo_evento()');
    });
    const eventRepository=new eventosRepo.PostgresMembresiasEventos(clasesPool),service=new eventosService.MembresiasEventosService(eventRepository);
    publisher=new publicadorModule.PublicadorMembresias(rabbitUrl,new outboxModule.PostgresMembresiasOutbox(pool),logger);
    await t.test('Outbox publica a cola durable antes de arrancar el consumidor',async()=>{
      await publisher.paso();
      assert.ok((await pool.query('SELECT publicado_en FROM membresias_outbox WHERE event_id=$1',[evento.eventId])).rows[0].publicado_en);
      assert.equal((await clases.obtenerReservasPorClase(claseId))[0].estado,'CONFIRMADA');
    });
    await t.test('Dos consumidores aplican una sola cancelación y el worker conserva FIFO',async()=>{
      consumer=new consumidorModule.ConsumidorMembresias(rabbitUrl,service,logger);consumerB=new consumidorModule.ConsumidorMembresias(rabbitUrl,service,logger);consumer.iniciar();consumerB.iniciar();
      await eventually(async()=>!!(await clasesPool.query('SELECT 1 FROM membresias_inbox WHERE event_id=$1',[evento.eventId])).rowCount);
      assert.equal((await clases.obtenerReservasPorClase(claseId))[0].estado,'CANCELADA');
      const reservas=new reservasModule.ReservasService(clases,new clientes.HttpSociosClient(base,3000,auth.internalApiKey));
      await reservas.procesarPendientes();
      assert.equal((await clases.obtenerReservasPorClase(claseId)).filter(r=>r.estado==='CONFIRMADA')[0].socioId,'socio-demo-02');
    });
    await t.test('Reentrega después del commit, reinicio y eventId incompatible',async()=>{
      const bytes=Buffer.from(JSON.stringify(evento));assert.equal((await service.procesar(bytes)).repetido,true);
      await consumer.cerrar();consumer=undefined;
      const restarted=new eventosService.MembresiasEventosService(new eventosRepo.PostgresMembresiasEventos(e.pool('clases')));
      assert.equal((await restarted.procesar(bytes)).repetido,true);
      await assert.rejects(restarted.procesar(Buffer.from(JSON.stringify({...evento,fechaFin:new Date(Date.now()+90000000).toISOString()}))),eventosService.EventoInvalido);
      assert.equal((await clasesPool.query('SELECT canceladas FROM membresias_inbox WHERE event_id=$1',[evento.eventId])).rows[0].canceladas,1);
    });
    await t.test('Evaluación HTTP anterior al evento no crea reserva ni promueve una espera suspendida',async()=>{
      const id='evento-carrera';await clasesPool.query("INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad,publicada) VALUES($1,'Carrera','sede-demo-01',$2,$3,1,true)",[id,new Date(Date.now()+3600000),new Date(Date.now()+7200000)]);
      assert.equal((await clases.reservarCupo(id,persona.socioId)).codigo,'MEMBRESIA_NO_HABILITADA');
      await clases.reservarCupo(id,'socio-demo-03');
      // Simula una espera creada antes de que llegara el evento, conservando el adaptador normal al promover.
      await clasesPool.query("INSERT INTO lista_espera(espera_id,clase_id,socio_id,orden,estado) VALUES('esp-antigua',$1,$2,1,'PENDIENTE')",[id,persona.socioId]);
      await clasesPool.query("UPDATE reservas SET estado='CANCELADA' WHERE clase_id=$1",[id]);
      assert.equal((await clases.aplicarEvaluacionEspera(id,'esp-antigua',true,new Date().toISOString())).estado,'RETIRADO');
      assert.equal((await clases.obtenerReservasPorClase(id)).filter(r=>r.estado==='CONFIRMADA').length,0);
    });
    await t.test('Inbox y cancelación retroceden juntos si falla su última escritura',async()=>{
      const failEvent={...evento,eventId:randomUUID(),membresiaId:'mem-otro',socioId};
      await clasesPool.query("INSERT INTO reservas(reserva_id,clase_id,socio_id,estado) VALUES('res-rollback',$1,$2,'CONFIRMADA')",[claseId,socioId]);
      await clasesPool.query("CREATE FUNCTION fallo_inbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fallo sintetico'; END; $$; CREATE TRIGGER fallo_inbox BEFORE INSERT ON membresias_inbox FOR EACH ROW EXECUTE FUNCTION fallo_inbox()");
      await assert.rejects(eventRepository.aplicarSuspension(failEvent));
      assert.equal((await clases.obtenerReserva('res-rollback')).estado,'CONFIRMADA');
      assert.equal((await clasesPool.query('SELECT 1 FROM membresias_suspendidas WHERE membresia_id=$1',[failEvent.membresiaId])).rowCount,0);
      await clasesPool.query('DROP TRIGGER fallo_inbox ON membresias_inbox; DROP FUNCTION fallo_inbox()');
      await clasesPool.query("DELETE FROM reservas WHERE reserva_id='res-rollback'");
    });
    await t.test('Carrera real entre evento y reserva o promoción no deja una reserva suspendida confirmada',async()=>{
      const otraInstancia=new clasesRepo.PostgresClaseRepository(e.pool('clases'));
      for(let n=0;n<8;n++){
        const id='carrera-evento-'+n,personaCarrera='persona-carrera-'+n;
        await clasesPool.query("INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad,publicada) VALUES($1,'Carrera real','sede-demo-01',$2,$3,1,true)",[id,new Date(Date.now()+3600000),new Date(Date.now()+7200000)]);
        const aviso={...evento,eventId:randomUUID(),socioId:personaCarrera,membresiaId:'mem-carrera-'+n};
        const escritura=n%2===0?()=>otraInstancia.reservarCupo(id,personaCarrera):async()=>{
          return otraInstancia.aplicarEvaluacionEspera(id,'esp-carrera-'+n,true,new Date().toISOString());
        };
        if(n%2!==0)await clasesPool.query("INSERT INTO lista_espera(espera_id,clase_id,socio_id,orden,estado) VALUES($1,$2,$3,1,'PENDIENTE')",['esp-carrera-'+n,id,personaCarrera]);
        await Promise.all([escritura(),eventRepository.aplicarSuspension(aviso)]);
        assert.equal((await clases.obtenerReservasPorClase(id)).filter(r=>r.estado==='CONFIRMADA').length,0);
      }
    });
    await t.test('Suspensión de un período futuro conserva reservas de otro período e historial iniciado',async()=>{
      const inicioFuturo=new Date(Date.now()+3*86400000),finFuturo=new Date(Date.now()+4*86400000);
      for(const [id,inicioClase] of [['evento-cerca',new Date(Date.now()+3600000)],['evento-lejos',new Date(Date.now()+3.5*86400000)],['evento-iniciada',new Date(Date.now()-3600000)]]){
        await clasesPool.query("INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad,publicada) VALUES($1,'Período de prueba','sede-demo-01',$2,$3,1,true)",[id,inicioClase,new Date(inicioClase.getTime()+3600000)]);
        await clasesPool.query("INSERT INTO reservas(reserva_id,clase_id,socio_id,estado) VALUES($1,$2,'socio-periodos','CONFIRMADA')",['res-'+id,id]);
      }
      const futuro={...evento,eventId:randomUUID(),membresiaId:'mem-futuro',socioId:'socio-periodos',fechaInicio:inicioFuturo.toISOString(),fechaFin:finFuturo.toISOString()};
      assert.equal((await eventRepository.aplicarSuspension(futuro)).canceladas,1);
      assert.equal((await clases.obtenerReserva('res-evento-cerca')).estado,'CONFIRMADA');
      assert.equal((await clases.obtenerReserva('res-evento-iniciada')).estado,'CONFIRMADA');
      assert.equal((await clases.obtenerReserva('res-evento-lejos')).estado,'CANCELADA');
    });
    await t.test('Mensaje inválido va a DLQ durable; error temporal reintenta y luego aplica',async()=>{
      const channel=await connection.createConfirmChannel();channel.on('error',()=>{});
      const send=async(content,id=randomUUID(),headers={})=>{channel.sendToQueue(consumidorModule.MEMBRESIAS_QUEUE,content,{persistent:true,messageId:id,headers});await channel.waitForConfirms();};
      await send(Buffer.from('{invalido'));
      const dead=await eventually(()=>channel.get(consumidorModule.MEMBRESIAS_DLQ,{noAck:false}));assert.equal(dead.properties.headers['gimnasio-causa'],'EVENTO_INVALIDO');channel.ack(dead);
      await consumerB.cerrar();consumerB=undefined;
      let attempts=0;const intermittent=new eventosService.MembresiasEventosService({aplicarSuspension:async ev=>{attempts++;if(attempts<3)throw new Error('temporal');return eventRepository.aplicarSuspension(ev);}});
      consumer=new consumidorModule.ConsumidorMembresias(rabbitUrl,intermittent,logger);consumer.iniciar();
      const recovery={...evento,eventId:randomUUID()};await send(Buffer.from(JSON.stringify(recovery)),recovery.eventId);
      await eventually(async()=>!!(await clasesPool.query('SELECT 1 FROM membresias_inbox WHERE event_id=$1',[recovery.eventId])).rowCount,20000);assert.equal(attempts,3);
      await consumer.cerrar();consumer=undefined;
      consumer=new consumidorModule.ConsumidorMembresias(rabbitUrl,new eventosService.MembresiasEventosService({aplicarSuspension:async()=>{throw new Error('persistente');}}),logger);consumer.iniciar();
      const exhaustedId=randomUUID();await send(Buffer.from(JSON.stringify({...evento,eventId:exhaustedId})),exhaustedId,{'gimnasio-intento':3});
      const exhausted=await eventually(async()=>{
        const message=await channel.get(consumidorModule.MEMBRESIAS_DLQ,{noAck:false});
        if(message&&message.properties.messageId!==exhaustedId){channel.ack(message);return false;}
        return message;
      });assert.equal(exhausted.properties.headers['gimnasio-causa'],'PROCESAMIENTO_FALLIDO');channel.ack(exhausted);
      await channel.close();
    });
    await t.test('Broker detenido conserva la suspensión nueva; tras reinicio publica y consume',async()=>{
      await consumer.cerrar();consumer=undefined;await publisher.cerrar();publisher=undefined;await connection.close();connection=undefined;
      ownedRabbit();docker(['stop','--time','2',rabbitId]);
      const r=await api('/api/v1/membresias/mem-rollback/suspender',{token,method:'POST',body:{}});assert.equal(r.status,200);
      const failing=new publicadorModule.PublicadorMembresias(rabbitUrl,new outboxModule.PostgresMembresiasOutbox(pool),logger);
      await assert.rejects(failing.paso());await failing.cerrar();
      assert.equal((await pool.query('SELECT publicado_en FROM membresias_outbox WHERE event_id=$1',[r.body.eventId])).rows[0].publicado_en,null);
      ownedRabbit();docker(['start',rabbitId]);
      assert.equal(Number(docker(['port',rabbitId,'5672/tcp']).split(':').at(-1)),port);
      publisher=new publicadorModule.PublicadorMembresias(rabbitUrl,new outboxModule.PostgresMembresiasOutbox(pool),logger);publisher.iniciar();
      consumer=new consumidorModule.ConsumidorMembresias(rabbitUrl,service,logger);consumer.iniciar();
      try { await eventually(async()=>!!(await clasesPool.query('SELECT 1 FROM membresias_inbox WHERE event_id=$1',[r.body.eventId])).rowCount,60000); }
      catch(error) { console.log('Diagnóstico sintético',JSON.stringify(logs.slice(-15)));throw error; }
    });
    console.log('Entorno de eventos. PostgreSQL '+e.version+' y RabbitMQ 4.1, recursos efímeros.');
  }finally{
    await consumer?.cerrar();await consumerB?.cerrar();await publisher?.cerrar();await connection?.close().catch(()=>{});await app?.close();
    await e.close();if(rabbitCreated){ownedRabbit();docker(['rm','--force',rabbitId]);}
  }
});
