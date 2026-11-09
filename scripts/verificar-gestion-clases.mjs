import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { postgresPrueba } from './membresias/entorno.mjs';
import { entornoMongo } from './cache/entorno.mjs';
import sociosModule from '../services/socios-membresias/dist/app.js';
import sociosRepos from '../services/socios-membresias/dist/repository.js';
import accesosModule from '../services/accesos-ocupacion/dist/app.js';
import accesosRepos from '../services/accesos-ocupacion/dist/repository.js';
import appsModule from '../services/clases-reservas/dist/app.js';
import repos from '../services/clases-reservas/dist/repository.js';
import gestores from '../services/clases-reservas/dist/gestion-clases.postgres.js';
import buscadores from '../services/clases-reservas/dist/busqueda-clases.postgres.js';
import sedesModule from '../services/clases-reservas/dist/clients/sedes.client.js';
import sociosClientModule from '../services/clases-reservas/dist/clients/socios.client.js';

test('Publicación/edición con dos instancias, PostgreSQL, Accesos/MongoDB y Socios HTTP reales', {timeout:120000}, async t=>{
  const e=await postgresPrueba();
  let mongo;
  const apps=[];
  const pool=e.pool('clases'),secondPool=e.pool('clases');
  const instant=Date.now();let now=instant;
  const at=hours=>new Date(instant+hours*3600000).toISOString();
  const clock=()=>new Date(now);
  const auth={jwtSecret:randomBytes(32).toString('hex'),internalApiKey:randomBytes(24).toString('hex'),jwtTtlSeconds:604800,clock};
  const contract=parse(await readFile('docs/contracts/openapi-catalogo-v1.yaml','utf8'));
  const ajv=new Ajv({strict:false});addFormats(ajv,{mode:'full'});
  const resolve=value=>value.$ref?value.$ref.slice(2).split('/').reduce((part,key)=>part[key],contract):value;
  const validators=new Map();
  const datos={nombre:'Yoga galio',actividad:'MOVILIDAD',profesor:'Profesora ficticia',sedeId:'sede-gestion',inicio:at(24),fin:at(25),capacidad:3};
  const repo=new repos.PostgresClaseRepository(pool);
  const start=async app=>{apps.push(app);await app.listen({host:'127.0.0.1',port:0});return {app,url:'http://127.0.0.1:'+app.server.address().port};};
  let a,b,adminToken,socioToken,otroToken,accesos;
  const request=async(method,path,{body,clave=randomUUID(),token=adminToken,base=a.url}={})=>{
    const response=await fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),
      ...(body?{'Content-Type':'application/json'}:{}),'Idempotency-Key':clave},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
    const value=await response.json();
    const esRetiro = /^\/api\/v1\/clases\/[^/]+\/espera\/[^/]+\/retirar$/.test(path);
    const route=esRetiro?'/api/v1/clases/{claseId}/espera/{esperaId}/retirar'
      :path.startsWith('/api/v1/admin/clases/')?'/api/v1/admin/clases/{claseId}':path.split('?')[0];
    const operation=contract.paths[route]?.[method.toLowerCase()];
    if(operation){
      const key=route+method+response.status;
      if(!validators.has(key)){
        assert.ok(operation.responses[response.status],key);
        const schema=resolve(operation.responses[response.status]).content['application/json'].schema;
        validators.set(key,ajv.compile({...schema,components:contract.components}));
      }
      const validate=validators.get(key);assert.ok(validate(value),JSON.stringify(validate.errors));
      assert.equal(response.headers.get('cache-control'),'no-store');
    }
    return {status:response.status,body:value};
  };
  const publicar=async(body=datos,options={})=>{
    const result=await request('POST','/api/v1/admin/clases',{...options,body});
    assert.equal(result.status,201,JSON.stringify(result.body));return result.body;
  };
  const editar=(clase,changes={},options={})=>request('PUT','/api/v1/admin/clases/'+clase.claseId,{
    ...options,body:{nombre:clase.nombre,actividad:clase.actividad,profesor:clase.profesor,sedeId:clase.sedeId,
      inicio:clase.inicio,fin:clase.fin,capacidad:clase.capacidad,versionEsperada:clase.version,...changes},
  });
  const esperarBloqueo=async()=>{
    for(let n=0;n<100;n++){
      const row=(await secondPool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND state='active') AS esperando")).rows[0];
      if(row.esperando)return;
      await pause(20);
    }
    throw new Error('No se observó el bloqueo de la operación concurrente.');
  };
  try {
    mongo=await entornoMongo();
    // Simula datos creados antes de la migración, con campos opcionales nulos.
    await pool.query(`CREATE TABLE clases(clase_id VARCHAR(50) PRIMARY KEY,nombre VARCHAR(100) NOT NULL,
      sede_id VARCHAR(50) NOT NULL,profesor VARCHAR(100),actividad VARCHAR(50),inicio TIMESTAMPTZ NOT NULL,
      fin TIMESTAMPTZ NOT NULL,capacidad INT NOT NULL,publicada BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await pool.query("INSERT INTO clases(clase_id,nombre,sede_id,inicio,fin,capacidad) VALUES('clase-anterior','Clase anterior','sede-gestion',$1,$2,3)",[at(48),at(49)]);
    await Promise.all([repo.inicializarEsquema(),new repos.PostgresClaseRepository(secondPool).inicializarEsquema()]);
    const sociosRepo=new sociosRepos.PostgresSociosRepository(e.pool('socios'));await sociosRepo.inicializarEsquema();
    for(const id of ['socio-gestion','otro-socio-gestion']){
      await sociosRepo.crearSocio({socioId:id,dni:id==='socio-gestion'?'90000701':'90000702',nombre:'Persona ficticia',email:id+'@example.invalid',rol:'SOCIO',estado:'ACTIVO',createdAt:at(0)});
      await sociosRepo.crearMembresia({membresiaId:'mem-'+id,socioId:id,tipoPlan:'PRUEBA',fechaInicio:at(-1),fechaFin:at(24*40),estado:'HABILITADA',createdAt:at(0),updatedAt:at(0)});
    }
    const socios=await start(sociosModule.buildSociosApp({...auth,repository:sociosRepo}));
    const accesosRepo=new accesosRepos.MongoAccesosRepository(mongo.client);
    await accesosRepo.inicializar([{sedeId:'sede-gestion',nombre:'Sede de prueba'},{sedeId:'sede-otra',nombre:'Otra sede'}]);
    accesos=await start(accesosModule.buildAccesosApp({...auth,repository:accesosRepo,socios:{verificar:async()=>{throw new Error('Fuera del ensayo de sedes');}}}));
    const remote=new sociosClientModule.HttpSociosClient(socios.url,2000,auth.internalApiKey);
    const build=(activePool,client=remote)=>appsModule.buildApp({...auth,apiKey:'historica-ficticia',repository:new repos.PostgresClaseRepository(activePool),
      gestionClases:new gestores.PostgresGestionClases(activePool),buscador:new buscadores.PostgresBuscadorClases(activePool),
      sedesClient:new sedesModule.HttpSedesClient(accesos.url,1500),sociosClient:client});
    a=await start(build(pool));b=await start(build(secondPool));
    adminToken=a.app.jwt.sign({sub:'admin-gestion',rol:'ADMIN'});
    socioToken=a.app.jwt.sign({sub:'socio-gestion',rol:'SOCIO'});otroToken=a.app.jwt.sign({sub:'otro-socio-gestion',rol:'SOCIO'});

    await t.test('Datos anteriores conservados y permisos de administrador',async()=>{
      const old=await request('GET','/api/v1/admin/clases/clase-anterior');
      assert.equal(old.body.version,1);assert.equal(old.body.actividad,null);assert.equal(old.body.profesor,null);
      for(const token of ['',socioToken]) {
        assert.equal((await request('POST','/api/v1/admin/clases',{body:datos,token})).status,token?403:401);
      }
    });
    await t.test('Entradas inválidas, sede inexistente y fechas no producen altas',async()=>{
      const count=(await pool.query('SELECT count(*)::int AS n FROM clases')).rows[0].n;
      for(const body of [{...datos,extra:true},{...datos,profesor:' '},{...datos,capacidad:0},{...datos,inicio:'2026-02-30T00:00:00Z'}]) {
        assert.equal((await request('POST','/api/v1/admin/clases',{body})).status,400);
      }
      assert.equal((await request('POST','/api/v1/admin/clases',{body:{...datos,sedeId:'inexistente'}})).status,422);
      assert.equal((await request('POST','/api/v1/admin/clases',{body:{...datos,inicio:at(-1)}})).body.codigo,'CLASE_INICIADA');
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM clases')).rows[0].n,count);
    });
    let primera,claveAlta;
    await t.test('Alta concurrente en dos instancias crea una sola clase y respuesta durable',async()=>{
      claveAlta=randomUUID();
      const results=await Promise.all(Array.from({length:16},(_,n)=>publicar(datos,{clave:claveAlta,base:n%2?a.url:b.url})));
      primera=results[0];for(const item of results)assert.deepEqual(item,primera);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM clases_operaciones WHERE clave=$1',[claveAlta])).rows[0].n,1);
      assert.equal((await request('GET','/api/v1/catalogo/clases?texto=galio')).body.total,1);
      assert.equal((await request('POST','/api/v1/admin/clases',{clave:claveAlta,body:{...datos,nombre:'Otro'}})).body.codigo,'IDEMPOTENCIA_CONFLICTO');
      const restarted=await start(build(secondPool));
      assert.deepEqual(await publicar(datos,{clave:claveAlta,base:restarted.url}),primera);
    });
    await t.test('Edición actualiza índice, incrementa versión y rechaza sobrescritura concurrente',async()=>{
      const clave=randomUUID();
      const result=await editar(primera,{nombre:'Pilates circonio',actividad:'PILATES'},{clave});
      assert.equal(result.status,200);assert.equal(result.body.version,2);
      assert.deepEqual((await editar(primera,{nombre:'Pilates circonio',actividad:'PILATES'},{clave})).body,result.body);
      assert.equal((await request('GET','/api/v1/catalogo/clases?texto=galio')).body.total,0);
      assert.equal((await request('GET','/api/v1/catalogo/clases?texto=circonio')).body.total,1);
      const edits=await Promise.all(Array.from({length:10},(_,n)=>editar(result.body,{profesor:'Docente '+n},{base:n%2?a.url:b.url})));
      assert.equal(edits.filter(r=>r.status===200).length,1);
      assert.ok(edits.filter(r=>r.status!==200).every(r=>r.body.codigo==='VERSION_CONFLICTO'));
      assert.equal((await request('GET','/api/v1/admin/clases/'+primera.claseId)).body.version,3);
      assert.deepEqual(await publicar(datos,{clave:claveAlta}),primera);
    });
    await t.test('Publicación, edición y consultas reales conservan resultados y reservas durante REINDEX concurrente',async()=>{
      const clases = [];
      for (let n = 0; n < 3; n++) {
        clases.push(await publicar({ ...datos, nombre: 'Control praseodimio ' + n,
          profesor: 'Docente de mantenimiento', actividad: 'RECONSTRUCCION',
          inicio: at(26 + n), fin: at(27 + n), capacidad: n === 0 ? 1 : 3 }));
      }
      const editada = await editar(clases[0], { nombre: 'Control neodimio' });
      assert.equal(editada.status, 200);
      clases[0] = editada.body;
      assert.equal((await request('POST', '/api/v1/reservas', {
        token: socioToken, body: { claseId: clases[0].claseId },
      })).status, 201);
      assert.equal((await request('POST', '/api/v1/clases/' + clases[0].claseId + '/espera', {
        token: otroToken, body: {},
      })).status, 201);
      const filtrosCombinados = { profesor: 'Docente de mantenimiento', sedeId: 'sede-gestion',
        desde: at(25), hasta: at(30), orden: 'inicio_asc' };
      const consultas = [
        { texto: 'neodimio', orden: 'relevancia' },
        { texto: 'praseodimio', orden: 'inicio_desc', tamanio: '1', pagina: '1' },
        { texto: 'praseodimio', orden: 'inicio_desc', tamanio: '1', pagina: '2' },
        { ...filtrosCombinados, soloConCupo: 'true' },
        { ...filtrosCombinados, tamanio: '2', pagina: '2' },
      ];
      const buscar = (consulta, base = a.url) => request('GET',
        '/api/v1/catalogo/clases?' + new URLSearchParams(consulta), { token: socioToken, base });
      const anteriores = await Promise.all(consultas.map(consulta => buscar(consulta)));
      for (const resultado of anteriores) assert.equal(resultado.status, 200);
      assert.deepEqual(anteriores[0].body.items.map(item => item.claseId), [clases[0].claseId]);
      assert.equal(anteriores[0].body.items[0].reservaDirectaDisponible, false);
      assert.equal(anteriores[1].body.total, 2);
      assert.deepEqual(anteriores[3].body.items.map(item => item.claseId), clases.slice(1).map(item => item.claseId));
      const ids = clases.map(item => item.claseId);
      const estadoNegocio = async () => ({
        clases: (await pool.query('SELECT * FROM clases WHERE clase_id=ANY($1::varchar[]) ORDER BY clase_id', [ids])).rows,
        reservas: (await pool.query('SELECT * FROM reservas WHERE clase_id=ANY($1::varchar[]) ORDER BY reserva_id', [ids])).rows,
        espera: (await pool.query('SELECT * FROM lista_espera WHERE clase_id=ANY($1::varchar[]) ORDER BY espera_id', [ids])).rows,
        operaciones: (await pool.query("SELECT * FROM clases_operaciones WHERE respuesta->>'claseId'=ANY($1::text[]) ORDER BY actor_id,clave", [ids])).rows,
      });
      const estadoAnterior = await estadoNegocio();
      const indiceAnterior = (await pool.query("SELECT 'idx_clases_fts'::regclass::oid AS oid")).rows[0].oid;
      const snapshot = await pool.connect();
      const mantenimientoPool = e.pool('clases');
      let mantenimiento, reconstruccion, errorReconstruccion, terminada = false;
      let faseObservada;
      try {
        mantenimiento = await mantenimientoPool.connect();
        await mantenimiento.query('SET statement_timeout=15000');
        await mantenimiento.query('SET lock_timeout=10000');
        const pid = (await mantenimiento.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await snapshot.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        try {
          // Un lector antiguo mantiene abierta una fase real de REINDEX. Las
          // consultas HTTP deben terminar antes de liberar esta transacción.
          await snapshot.query('SELECT documento_busqueda FROM clases WHERE clase_id=ANY($1::varchar[])', [ids]);
          reconstruccion = mantenimiento.query('REINDEX INDEX CONCURRENTLY idx_clases_fts').then(
            () => { terminada = true; },
            error => { errorReconstruccion = error; terminada = true; },
          );
          for (let intento = 0; intento < 150; intento++) {
            const progreso = (await secondPool.query(
              'SELECT command,phase FROM pg_stat_progress_create_index WHERE pid=$1', [pid],
            )).rows[0];
            if (progreso?.command === 'REINDEX CONCURRENTLY' && progreso.phase === 'waiting for old snapshots') {
              faseObservada = progreso.phase;
              break;
            }
            if (terminada) break;
            await pause(20);
          }
          assert.equal(faseObservada, 'waiting for old snapshots', String(errorReconstruccion ?? 'No se observó REINDEX esperando al lector antiguo.'));
          assert.equal(terminada, false);
          const durante = await Promise.all(Array.from({ length: 20 }, (_, n) =>
            buscar(consultas[n % consultas.length], n % 2 ? a.url : b.url)));
          durante.forEach((resultado, n) => assert.deepEqual(resultado, anteriores[n % consultas.length]));
          assert.equal(terminada, false, 'Las veinte lecturas debían terminar durante REINDEX.');
        } finally {
          await snapshot.query('ROLLBACK');
        }
        await reconstruccion;
        assert.ifError(errorReconstruccion);
        for (let n = 0; n < consultas.length; n++) {
          assert.deepEqual(await buscar(consultas[n], b.url), anteriores[n]);
        }
        assert.deepEqual(await estadoNegocio(), estadoAnterior);
        const indice = (await pool.query(`SELECT c.oid,i.indisvalid,i.indisready,am.amname
          FROM pg_class c JOIN pg_index i ON i.indexrelid=c.oid JOIN pg_am am ON am.oid=c.relam
          WHERE c.oid='idx_clases_fts'::regclass`)).rows[0];
        assert.notEqual(indice.oid, indiceAnterior);
        assert.equal(indice.indisvalid, true); assert.equal(indice.indisready, true);
        assert.equal(indice.amname, 'gin');
        assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'idx_clases_fts_cc%'")).rows[0].n, 0);
        assert.equal((await editar(clases[0])).body.codigo, 'CLASE_CON_INSCRIPTOS');
        console.log(JSON.stringify({ cierreBusqueda: true, postgres: e.version, consultasComparadas: consultas.length,
          lecturasDuranteReindex: 20, instancias: 2, faseObservada, indiceReemplazado: true, indiceValido: true,
          clasesReservasEsperaYOperacionesConservadas: true }));
      } finally {
        snapshot.release();
        await reconstruccion;
        mantenimiento?.release();
      }
    });
    await t.test('Reservas confirmadas y espera pendiente bloquean edición; historial cerrado la permite',async()=>{
      const clase=await publicar({...datos,nombre:'Clase para espera',capacidad:1});
      const reserve=await request('POST','/api/v1/reservas',{body:{claseId:clase.claseId},token:socioToken});
      assert.equal(reserve.status,201);
      assert.equal((await editar(clase)).body.codigo,'CLASE_CON_INSCRIPTOS');
      assert.equal((await request('POST','/api/v1/clases/'+clase.claseId+'/espera',{body:{},token:otroToken})).status,201);
      assert.equal((await request('POST','/api/v1/reservas/'+reserve.body.reservaId+'/cancelar',{token:socioToken})).status,200);
      assert.equal((await editar(clase)).body.codigo,'CLASE_CON_INSCRIPTOS');
      // Retiro técnico del fixture, la retirada voluntaria sigue siendo el paso 6.
      await pool.query("UPDATE lista_espera SET estado='CANCELADO' WHERE clase_id=$1",[clase.claseId]);
      assert.equal((await editar(clase)).status,200);
    });
    await t.test('Una reserva confirmada mientras la edición espera el bloqueo evita modificar la clase',async()=>{
      const clase=await publicar({...datos,nombre:'Clase carrera con reserva'});
      const client=await pool.connect();let edit;
      try {
        await client.query('BEGIN');await client.query('SELECT 1 FROM clases WHERE clase_id=$1 FOR UPDATE',[clase.claseId]);
        await client.query("INSERT INTO reservas(reserva_id,clase_id,socio_id,estado) VALUES($1,$2,'socio-gestion','CONFIRMADA')",['res-'+randomUUID(),clase.claseId]);
        edit=editar(clase,{nombre:'Cambio rechazado'},{base:b.url});await esperarBloqueo();
        await client.query('COMMIT');assert.equal((await edit).body.codigo,'CLASE_CON_INSCRIPTOS');
      } finally {await client.query('ROLLBACK');client.release();await edit;}
      assert.equal((await request('GET','/api/v1/admin/clases/'+clase.claseId)).body.nombre,clase.nombre);
    });
    await t.test('Cambiar el horario descarta una habilitación anterior al reservar o ingresar en espera',async()=>{
      for(const enEspera of [false,true]){
        const clase=await publicar({...datos,nombre:enEspera?'Carrera espera':'Carrera reserva',capacidad:1});
        let reserva;
        if(enEspera) reserva=await request('POST','/api/v1/reservas',{body:{claseId:clase.claseId},token:socioToken});
        let abrir;const gate=new Promise(r=>{abrir=r;});
        let evaluadas;const ready=new Promise(r=>{evaluadas=r;});let verificaciones=0;
        const delayed={verificarHabilitacion:async(...args)=>{
          const result=await remote.verificarHabilitacion(...args);
          if(++verificaciones===2)evaluadas();
          await gate;return result;
        }};
        const delayedApp=await start(build(secondPool,delayed));
        const path=enEspera?'/api/v1/clases/'+clase.claseId+'/espera':'/api/v1/reservas';
        const attempt=request('POST',path,{base:delayedApp.url,token:otroToken,body:enEspera?{}:{claseId:clase.claseId}});
        try {
          await ready;
          if(enEspera)await request('POST','/api/v1/reservas/'+reserva.body.reservaId+'/cancelar',{token:socioToken});
          assert.equal((await editar(clase,{inicio:at(48),fin:at(49)})).status,200);
        } finally {abrir();}
        const result=await attempt;assert.equal(result.status,409);assert.equal(result.body.codigo,'CLASE_MODIFICADA');
      }
    });
    await t.test('Clase y respuesta idempotente revierten juntas ante un fallo antes del commit',async()=>{
      const clave='fallo-'+randomUUID();
      await pool.query(`CREATE FUNCTION fallo_gestion_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.clave='${clave}' THEN RAISE EXCEPTION 'fallo deliberado del fixture'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fallo_gestion_fixture BEFORE INSERT ON clases_operaciones FOR EACH ROW EXECUTE FUNCTION fallo_gestion_fixture()`);
      const body={...datos,nombre:'Clase rollback ficticia'};
      assert.equal((await request('POST','/api/v1/admin/clases',{clave,body})).status,503);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM clases WHERE nombre=$1',[body.nombre])).rows[0].n,0);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM clases_operaciones WHERE clave=$1',[clave])).rows[0].n,0);
      await pool.query('DROP TRIGGER fallo_gestion_fixture ON clases_operaciones; DROP FUNCTION fallo_gestion_fixture()');
      assert.equal((await publicar(body,{clave})).version,1);
    });
    await t.test('El inicio se vuelve a evaluar después de esperar un bloqueo; replay conserva resultado pasado',async()=>{
      const clave=randomUUID(),client=await pool.connect();let attempt;
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['admin-gestion',clave])]);
        attempt=request('POST','/api/v1/admin/clases',{clave,body:{...datos,inicio:at(1),fin:at(2)}});
        await esperarBloqueo();now=instant+3600000;
        await client.query('COMMIT');assert.equal((await attempt).body.codigo,'CLASE_INICIADA');
        now=instant+24*3600000;
        assert.equal((await editar(primera,{versionEsperada:3,inicio:at(48),fin:at(49)})).body.codigo,'CLASE_INICIADA');
        assert.deepEqual(await publicar(datos,{clave:claveAlta}),primera);
      } finally {now=instant;await client.query('ROLLBACK');client.release();await attempt;}
    });
    await t.test('Retiro HTTP conserva historial, reintentos, propietario y una nueva inscripción independiente', async () => {
      const clase = await publicar({ ...datos, nombre: 'Retiro durable', capacidad: 1 });
      await request('POST', '/api/v1/reservas', { token: socioToken, body: { claseId: clase.claseId } });
      const entrada = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera', { token: otroToken, body: {} });
      assert.equal(entrada.status, 201);
      const path = '/api/v1/clases/' + clase.claseId + '/espera/' + entrada.body.esperaId + '/retirar';
      assert.equal((await request('POST', path, { token: '' })).status, 401);
      assert.equal((await request('POST', path, { token: socioToken })).status, 403);
      assert.equal((await request('POST', path.replace(clase.claseId, 'otra-clase'), { token: otroToken })).status, 404);
      const retiros = await Promise.all(Array.from({ length: 20 }, (_, n) => request('POST', path, { token: otroToken, base: n % 2 ? a.url : b.url })));
      for (const retiro of retiros) { assert.equal(retiro.status, 200); assert.deepEqual(retiro.body, retiros[0].body); }
      assert.equal((await repo.obtenerEntradaEspera(entrada.body.esperaId)).estado, 'CANCELADO');
      assert.equal((await request('POST', path)).status, 200);
      const otra = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera', { token: otroToken, body: {} });
      assert.equal(otra.status, 201); assert.notEqual(otra.body.esperaId, entrada.body.esperaId);
      assert.ok(otra.body.orden > entrada.body.orden);
      const restarted = await start(build(secondPool));
      assert.equal((await request('POST', path, { token: otroToken, base: restarted.url })).status, 200);
      assert.equal((await repo.obtenerEntradaEspera(otra.body.esperaId)).estado, 'PENDIENTE');
      try {
        now = Date.parse(clase.inicio);
        const nuevoPath = '/api/v1/clases/' + clase.claseId + '/espera/' + otra.body.esperaId + '/retirar';
        assert.equal((await request('POST', nuevoPath, { token: otroToken })).body.codigo, 'CLASE_INICIADA');
        assert.equal((await request('POST', path, { token: otroToken })).status, 200);
      } finally { now = instant; }
      assert.equal((await repo.obtenerReservasPorClase(clase.claseId)).filter(item => item.estado === 'CONFIRMADA').length, 1);
    });
    await t.test('Retirar al candidato evaluado conserva FIFO y el cupo se reasigna al siguiente', async () => {
      const clase = await publicar({ ...datos, nombre: 'Retiro y recuperación FIFO', capacidad: 1 });
      const reserva = await request('POST', '/api/v1/reservas', { token: socioToken, body: { claseId: clase.claseId } });
      const primeraEspera = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera', { token: otroToken, body: {} });
      await request('POST', '/api/v1/reservas/' + reserva.body.reservaId + '/cancelar', { token: socioToken });
      const segundaEspera = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera', { token: socioToken, body: {} });
      assert.equal(segundaEspera.status, 201);
      const candidato = await repo.obtenerPrimerCandidato(clase.claseId);
      await Promise.all([remote.verificarHabilitacion(candidato.espera.socioId, at(0)), remote.verificarHabilitacion(candidato.espera.socioId, clase.inicio)]);
      const result = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera/' + primeraEspera.body.esperaId + '/retirar', { token: otroToken });
      assert.equal(result.status, 200); assert.equal(result.body.reasignacionPendiente, true);
      const repositorioB = new repos.PostgresClaseRepository(secondPool);
      assert.equal((await repositorioB.aplicarEvaluacionEspera(clase.claseId, candidato.espera.esperaId, true, at(0))).estado, 'CAMBIO');
      assert.equal((await request('POST', '/api/v1/reservas', { token: otroToken, body: { claseId: clase.claseId } })).status, 409);
      await Promise.all([a.app.reservasService.procesarPendientes(), b.app.reservasService.procesarPendientes()]);
      const confirmadas = (await repo.obtenerReservasPorClase(clase.claseId)).filter(item => item.estado === 'CONFIRMADA');
      assert.equal(confirmadas.length, 1); assert.equal(confirmadas[0].socioId, 'socio-gestion');
      assert.equal((await repo.obtenerEntradaEspera(primeraEspera.body.esperaId)).estado, 'CANCELADO');
      assert.equal((await repo.obtenerEntradaEspera(segundaEspera.body.esperaId)).estado, 'PROMOVIDO');
    });
    await t.test('Promoción que confirma mientras el retiro espera produce conflicto y conserva la reserva', async () => {
      const clase = await publicar({ ...datos, nombre: 'Promoción gana al retiro', capacidad: 1 });
      const ocupada = await request('POST', '/api/v1/reservas', { token: socioToken, body: { claseId: clase.claseId } });
      const espera = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera', { token: otroToken, body: {} });
      await request('POST', '/api/v1/reservas/' + ocupada.body.reservaId + '/cancelar', { token: socioToken });
      const reservaId = 'res-' + randomUUID(), client = await pool.connect();
      let retiro;
      try {
        // Ventana controlada del fixture con el mismo cambio atómico de promoción.
        await client.query('BEGIN'); await client.query('SELECT 1 FROM clases WHERE clase_id=$1 FOR UPDATE', [clase.claseId]);
        await client.query("UPDATE lista_espera SET estado='PROMOVIDO',updated_at=$2 WHERE espera_id=$1", [espera.body.esperaId, at(0)]);
        await client.query("INSERT INTO reservas(reserva_id,clase_id,socio_id,estado,created_at,updated_at) VALUES($1,$2,'otro-socio-gestion','CONFIRMADA',$3,$3)", [reservaId, clase.claseId, at(0)]);
        retiro = request('POST', '/api/v1/clases/' + clase.claseId + '/espera/' + espera.body.esperaId + '/retirar', { token: otroToken, base: b.url });
        await esperarBloqueo(); await client.query('COMMIT');
        const result = await retiro;
        assert.equal(result.status, 409); assert.equal(result.body.codigo, 'ESPERA_PROMOVIDA');
        assert.equal(result.body.reserva.reservaId, reservaId);
        assert.equal((await repo.obtenerReserva(reservaId)).estado, 'CONFIRMADA');
        await request('POST', '/api/v1/reservas/' + reservaId + '/cancelar', { token: otroToken });
        assert.equal((await repo.obtenerReserva(reservaId)).estado, 'CANCELADA');
      } finally { await client.query('ROLLBACK'); client.release(); await retiro; }
    });
    await t.test('Fallo de almacenamiento revierte el retiro y permite reintentar la misma entrada', async () => {
      const clase = await publicar({ ...datos, nombre: 'Retiro con rollback', capacidad: 1 });
      await request('POST', '/api/v1/reservas', { token: socioToken, body: { claseId: clase.claseId } });
      const espera = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera', { token: otroToken, body: {} });
      const path = '/api/v1/clases/' + clase.claseId + '/espera/' + espera.body.esperaId + '/retirar';
      await pool.query(`CREATE FUNCTION fallo_retiro_fixture() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF OLD.espera_id='${espera.body.esperaId}' AND NEW.estado='CANCELADO' THEN RAISE EXCEPTION 'fallo deliberado'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fallo_retiro_fixture BEFORE UPDATE ON lista_espera FOR EACH ROW EXECUTE FUNCTION fallo_retiro_fixture()`);
      try {
        assert.equal((await request('POST', path, { token: otroToken })).status, 500);
        assert.equal((await repo.obtenerEntradaEspera(espera.body.esperaId)).estado, 'PENDIENTE');
      } finally { await pool.query('DROP TRIGGER fallo_retiro_fixture ON lista_espera; DROP FUNCTION fallo_retiro_fixture()'); }
      assert.equal((await request('POST', path, { token: otroToken })).status, 200);
    });
    await t.test('Retiro local funciona con Socios caído y deja cupo directo si ya no hay espera', async () => {
      const clase = await publicar({ ...datos, nombre: 'Retiro sin dependencia', capacidad: 1 });
      const reserva = await request('POST', '/api/v1/reservas', { token: socioToken, body: { claseId: clase.claseId } });
      const espera = await request('POST', '/api/v1/clases/' + clase.claseId + '/espera', { token: otroToken, body: {} });
      await socios.app.close();
      assert.equal((await request('POST', '/api/v1/reservas/' + reserva.body.reservaId + '/cancelar', { token: socioToken })).status, 200);
      assert.equal((await request('POST', '/api/v1/clases/' + clase.claseId + '/espera/' + espera.body.esperaId + '/retirar', { token: otroToken })).status, 200);
      const disponibles = await request('GET', '/api/v1/catalogo/clases?texto=Retiro%20dependencia&soloConCupo=true', { token: otroToken });
      assert.equal(disponibles.body.items[0].claseId, clase.claseId);
    });
    await t.test('Accesos caído rechaza operaciones nuevas y permite recuperar una confirmada',async()=>{
      await accesos.app.close();
      const result=await request('POST','/api/v1/admin/clases',{body:{...datos,nombre:'No crear sin sede'}});
      assert.equal(result.status,503);assert.equal(result.body.codigo,'SEDES_NO_DISPONIBLES');
      assert.deepEqual(await publicar(datos,{clave:claveAlta}),primera);
      assert.equal((await request('GET','/api/v1/admin/clases/'+primera.claseId)).status,200);
    });
  } finally {
    for(const app of apps.reverse())await app.close();
    await mongo?.close();await e.close();
  }
});
