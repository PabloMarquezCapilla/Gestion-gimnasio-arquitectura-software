import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import { postgresPrueba } from './membresias/entorno.mjs';
import appModule from '../services/clases-reservas/dist/app.js';
import repos from '../services/clases-reservas/dist/repository.js';
import busqueda from '../services/clases-reservas/dist/busqueda-clases.postgres.js';
import dominio from '../services/clases-reservas/dist/application/busqueda-clases.service.js';

test('Búsqueda HTTP con PostgreSQL FTS/GIN real',{timeout:120000},async t=>{
  const e = await postgresPrueba();
  const pool = e.pool('clases');
  const secondPool = e.pool('clases');
  pool.on('error',()=>{});
  secondPool.on('error',()=>{});
  const apps = [];
  const instant = new Date().toISOString();
  const despues = hours=>new Date(Date.parse(instant)+hours*3600000).toISOString();
  const contract = parse(await readFile('docs/contracts/openapi-catalogo-v1.yaml','utf8'));
  const ajv = new Ajv({strict:false});addFormats(ajv);
  const operation = contract.paths['/api/v1/catalogo/clases'].get;
  const validators = new Map(Object.entries(operation.responses).map(([code,response])=>[
    Number(code),ajv.compile({...response.content['application/json'].schema,components:contract.components}),
  ]));
  const repository = new repos.PostgresClaseRepository(pool);
  const clock = ()=>new Date(instant);
  const build = async activePool=>{
    const app = appModule.buildApp({apiKey:'historica-ficticia',internalApiKey:'interna-ficticia',
      jwtSecret:'secreto-de-busqueda-ficticio-'.repeat(3),clock,
      repository:new repos.PostgresClaseRepository(activePool),buscador:new busqueda.PostgresBuscadorClases(activePool)});
    apps.push(app);
    await app.listen({host:'127.0.0.1',port:0});
    return {app,url:'http://127.0.0.1:'+app.server.address().port};
  };
  try {
    await repository.inicializarEsquema();
    const fixtures = [
      ['bus-001','Yoga cobalto','MOVILIDAD','Ana López','sede-busqueda',1,3,true],
      ['bus-002','Pilates','cobalto','Ana López','sede-busqueda',2,1,true],
      ['bus-003','Movilidad','MOVILIDAD','cobalto','sede-busqueda',3,2,true],
      ['bus-004','Natación','ACUATICA','Bruno Ríos','sede-otra',4,4,true],
      ['bus-005','Yoga cobalto','YOGA','Ana López','sede-busqueda',-1,3,true],
      ['bus-006','Yoga cobalto','YOGA','Ana López','sede-busqueda',5,3,false],
      ['bus-007','Cobalto clásico',null,null,'sede-antigua',6,2,true],
      ['bus-008','Yoga','YOGA','Ana López','sede-busqueda',1,3,true],
      ['bus-009','Yoga cobalto','YOGA','Ana López','sede-busqueda',0,3,true],
    ];
    for(const [id,nombre,actividad,profesor,sede,hours,capacidad,publicada] of fixtures){
      await pool.query(`INSERT INTO clases(clase_id,nombre,actividad,profesor,sede_id,inicio,fin,capacidad,publicada)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id,nombre,actividad,profesor,sede,despues(hours),despues(hours+1),capacidad,publicada]);
    }
    await pool.query("INSERT INTO reservas(reserva_id,clase_id,socio_id,estado) VALUES('res-bus-002','bus-002','persona-ficticia','CONFIRMADA')");
    await pool.query("INSERT INTO lista_espera(espera_id,clase_id,socio_id,orden,estado) VALUES('esp-bus-003','bus-003','persona-ficticia',1,'PENDIENTE')");
    const first = await build(pool),second = await build(secondPool);
    const token = rol=>first.app.jwt.sign({sub:'persona-busqueda',rol});
    const socioToken = token('SOCIO'),adminToken = token('ADMIN');
    const get = async(query={},who=socioToken,base=first.url)=>{
      const response = await fetch(base+'/api/v1/catalogo/clases?'+new URLSearchParams(query),{
        headers:who?{Authorization:'Bearer '+who}:{},signal:AbortSignal.timeout(10000),
      });
      const body = await response.json();
      const validate = validators.get(response.status);
      assert.ok(validate,'HTTP declarado '+response.status);
      assert.ok(validate(body),JSON.stringify(validate.errors));
      assert.equal(response.headers.get('cache-control'),'no-store');
      return {status:response.status,body};
    };
    const ids = result=>result.body.items.map(item=>item.claseId);

    await t.test('Contrato exige JWT y permite consultar a SOCIO y ADMIN',async()=>{
      assert.equal((await get({},'')).status,401);
      for(const who of [socioToken,adminToken])assert.equal((await get({texto:'cobalto'},who)).status,200);
    });
    await t.test('Texto busca nombre, actividad y profesor con relevancia y excluye clases iniciadas/no publicadas',async()=>{
      assert.deepEqual(ids(await get({texto:'cobalto',orden:'relevancia'})),['bus-001','bus-007','bus-002','bus-003']);
      assert.deepEqual(ids(await get({texto:'cobalto',orden:'inicio_asc'})),['bus-001','bus-002','bus-003','bus-007']);
      assert.deepEqual(ids(await get({texto:'cobalto',orden:'inicio_desc'})),['bus-007','bus-003','bus-002','bus-001']);
    });
    await t.test('Filtros combinados, igualdad de profesor y límites temporales se aplican antes de paginar',async()=>{
      const result = await get({texto:'cobalto',profesor:'ana lópez',sedeId:'sede-busqueda',desde:despues(1),hasta:despues(2)});
      assert.deepEqual(ids(result),['bus-001']);assert.equal(result.body.total,1);
      const tied = await get({sedeId:'sede-busqueda',desde:despues(1),hasta:despues(2)});
      assert.deepEqual(ids(tied),['bus-001','bus-008']);
    });
    await t.test('Disponibilidad directa distingue clase llena y cupo protegido para FIFO',async()=>{
      const result = await get({texto:'cobalto'});
      const full = result.body.items.find(item=>item.claseId==='bus-002');
      const waiting = result.body.items.find(item=>item.claseId==='bus-003');
      assert.equal(full.cuposDisponibles,0);assert.equal(full.reservaDirectaDisponible,false);
      assert.equal(waiting.cuposDisponibles,2);assert.equal(waiting.reservaDirectaDisponible,false);
      assert.deepEqual(ids(await get({texto:'cobalto',soloConCupo:'true'})),['bus-001','bus-007']);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM lista_espera WHERE espera_id='esp-bus-003' AND estado='PENDIENTE'")).rows[0].n,1);
    });
    await t.test('Paginación estable, total de página fuera de rango y texto sin resultados',async()=>{
      const found = [];
      for(let pagina=1;pagina<=4;pagina++){
        const result = await get({texto:'cobalto',pagina:String(pagina),tamanio:'1'});
        assert.equal(result.body.total,4);assert.equal(result.body.pagina,pagina);found.push(...ids(result));
      }
      assert.equal(new Set(found).size,4);
      const outside = await get({texto:'cobalto',pagina:'99',tamanio:'1'});
      assert.deepEqual(outside.body.items,[]);assert.equal(outside.body.total,4);
      for(const texto of ['inexistentequimera','la y el','😀'.repeat(200)]){
        const empty = await get({texto});assert.deepEqual(empty.body.items,[]);assert.equal(empty.body.total,0);
      }
    });
    await t.test('Los datos anteriores sin actividad/profesor conservan null y se buscan por nombre',async()=>{
      const result = await get({sedeId:'sede-antigua',texto:'clásico'});
      assert.deepEqual(ids(result),['bus-007']);
      assert.equal(result.body.items[0].actividad,null);assert.equal(result.body.items[0].profesor,null);
    });
    await t.test('Entradas inválidas se rechazan y el SQL parametrizado conserva las tablas',async()=>{
      for(const query of [{orden:'relevancia'},{pagina:'0'},{tamanio:'101'},{nivel:'alto'},
        {desde:'2026-02-30T00:00:00Z'},{soloConCupo:'sí'},{texto:' '},{texto:'a'.repeat(201)}])assert.equal((await get(query)).status,400);
      assert.equal((await get({sedeId:"x' OR true --"})).body.total,0);
      assert.equal((await get({texto:"' OR 1=1; DROP TABLE clases --"})).status,200);
      assert.ok((await pool.query('SELECT count(*) FROM clases')).rowCount);
    });
    await t.test('Modificación, commit y rollback mantienen el vector actualizado entre dos instancias',async()=>{
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("UPDATE clases SET nombre='Fuerza rubidio' WHERE clase_id='bus-001'");
        assert.equal((await get({texto:'rubidio'},socioToken,second.url)).body.total,0);
        await client.query('COMMIT');
        assert.deepEqual(ids(await get({texto:'rubidio'},socioToken,second.url)),['bus-001']);
        await client.query('BEGIN');
        await client.query("UPDATE clases SET nombre='Neón efímero' WHERE clase_id='bus-001'");
        await client.query('ROLLBACK');
        assert.deepEqual(ids(await get({texto:'rubidio'})),['bus-001']);
      } finally { await client.query('ROLLBACK');client.release(); }
    });
    await t.test('Plan real usa GIN para término selectivo y REINDEX conserva resultados',async()=>{
      await pool.query(`INSERT INTO clases(clase_id,nombre,sede_id,actividad,inicio,fin,capacidad,publicada)
        SELECT 'bus-volumen-'||n,CASE WHEN n=12000 THEN 'hipertermoficticio' ELSE 'Entrenamiento general '||n END,
          'sede-volumen','Acondicionamiento',$1::timestamptz,$2::timestamptz,20,true FROM generate_series(1,12000) n`,[despues(10),despues(11)]);
      // VACUUM procesa también la lista pendiente de GIN tras la carga masiva sintética.
      await pool.query('VACUUM (ANALYZE) clases');
      const consulta = busqueda.consultaBusquedaSql(dominio.consultaClases({texto:'hipertermoficticio'}),instant);
      const plan = (await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+consulta.text,consulta.values)).rows[0]['QUERY PLAN'][0];
      const indices = [];
      const visit = node=>{if(node['Index Name'])indices.push(node['Index Name']);for(const child of node.Plans??[])visit(child);};
      visit(plan.Plan);assert.ok(indices.includes('idx_clases_fts'),JSON.stringify(plan.Plan));
      const before = await get({texto:'hipertermoficticio'});
      assert.deepEqual(ids(before),['bus-volumen-12000']);
      await Promise.all([pool.query('REINDEX INDEX CONCURRENTLY idx_clases_fts'),get({texto:'hipertermoficticio'},socioToken,second.url)]);
      const after = await get({texto:'hipertermoficticio'});
      assert.deepEqual(after.body,before.body);
      assert.equal((await pool.query("SELECT indisvalid FROM pg_index WHERE indexrelid='idx_clases_fts'::regclass")).rows[0].indisvalid,true);
      console.log(JSON.stringify({postgres:e.version,filasSinteticas:12000,indices,tiempoConsultaMs:plan['Execution Time']}));
    });
    await t.test('Reservas propias conservan el detalle de clases fuera de las primeras cien',async()=>{
      await pool.query("INSERT INTO reservas(reserva_id,clase_id,socio_id,estado) VALUES('res-bus-personal','bus-volumen-12000','persona-busqueda','CONFIRMADA')");
      const personal = async (jwt, socioId) => {
        const response = await fetch(first.url+'/api/v1/reservas/clases?socioId='+socioId, {
          headers: { Authorization: 'Bearer '+jwt }, signal: AbortSignal.timeout(10000),
        });
        return { status: response.status, body: await response.json() };
      };
      const result = await personal(socioToken,'persona-busqueda');
      assert.equal(result.status,200);
      assert.equal(result.body.items.length,100);
      assert.ok(!result.body.items.some(item=>item.claseId==='bus-volumen-12000'));
      assert.ok(result.body.reservasSocio.some(item=>item.reservaId==='res-bus-personal'));
      assert.deepEqual(result.body.clasesPersonales,[{
        claseId:'bus-volumen-12000',nombre:'hipertermoficticio',sedeId:'sede-volumen',inicio:despues(10),
      }]);
      const otherToken = first.app.jwt.sign({sub:'otra-persona-busqueda',rol:'SOCIO'});
      assert.deepEqual((await personal(otherToken,'otra-persona-busqueda')).body.clasesPersonales,[]);
      assert.equal((await personal(otherToken,'persona-busqueda')).status,403);
    });
    await t.test('Recreación de aplicación conserva búsquedas y la API histórica',async()=>{
      const restarted = await build(secondPool);
      assert.deepEqual(ids(await get({texto:'rubidio'},socioToken,restarted.url)),['bus-001']);
      const legacy = await fetch(restarted.url+'/api/v1/clases?sedeId=sede-busqueda',{headers:{'X-API-Key':'historica-ficticia'}});
      assert.equal(legacy.status,200);
      const body = await legacy.json();
      assert.ok(body.items.some(item=>item.claseId==='bus-005'));
      assert.ok(!('actividad' in body.items[0]));
    });
    await t.test('Base detenida produce 503 y no fabrica una página vacía',async()=>{
      const label = execFileSync('docker',['inspect','--format','{{index .Config.Labels "pulse.membresias.test"}}',e.id],{encoding:'utf8',windowsHide:true}).trim();
      assert.equal(label,e.id);
      execFileSync('docker',['stop','--time','1',e.id],{encoding:'utf8',windowsHide:true});
      const result = await get({texto:'rubidio'});
      assert.equal(result.status,503);assert.equal(result.body.codigo,'BUSQUEDA_NO_DISPONIBLE');
      assert.equal(result.body.items,undefined);
    });
  } finally {
    await Promise.all(apps.map(app=>app.close()));
    await e.close();
  }
});
