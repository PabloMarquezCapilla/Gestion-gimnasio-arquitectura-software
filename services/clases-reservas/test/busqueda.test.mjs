import { test } from 'node:test';
import assert from 'node:assert/strict';
import consultas from '../dist/application/busqueda-clases.service.js';
import appModule from '../dist/app.js';

test('Búsqueda valida filtros, fechas y órdenes antes de consultar el almacenamiento',async()=>{
  assert.deepEqual(consultas.consultaClases({}),{
    texto:undefined,profesor:undefined,sedeId:undefined,desde:undefined,hasta:undefined,
    soloConCupo:false,orden:'inicio_asc',pagina:1,tamanio:20,
  });
  const q = consultas.consultaClases({texto:'  yoga  ',profesor:' Ana ',soloConCupo:'true',orden:'relevancia',pagina:'2',tamanio:'5',desde:'2026-11-08T00:00:00-03:00'});
  assert.equal(q.texto,'yoga');assert.equal(q.profesor,'Ana');assert.equal(q.desde,'2026-11-08T03:00:00.000Z');
  assert.equal(q.pagina,2);assert.equal(q.soloConCupo,true);
  assert.equal(consultas.consultaClases({texto:'😀'.repeat(200)}).texto,'😀'.repeat(200));
  for(const value of [[],null,{extra:'1'},{texto:''},{texto:' '.repeat(2)},{texto:['yoga','pilates']},
    {texto:'a'.repeat(201)},{profesor:'a'.repeat(101)},{sedeId:'a'.repeat(51)},
    {pagina:'0'},{pagina:'1.2'},{pagina:'1e2'},{pagina:'01'},{pagina:'1000001'},
    {tamanio:'101'},{tamanio:['1','2']},{orden:'relevancia'},{orden:'inicio; DROP TABLE clases'},
    {soloConCupo:'1'},{soloConCupo:true},{desde:'2026-02-30T00:00:00Z'},
    {desde:'2026-11-08'},{desde:'2026-11-09T00:00:00Z',hasta:'2026-11-08T00:00:00Z'}]) {
    assert.throws(()=>consultas.consultaClases(value),consultas.BusquedaClasesError);
  }
});

test('Servicio utiliza el puerto propio y no convierte un fallo en resultados vacíos',async()=>{
  const clock = ()=>new Date('2026-11-07T15:00:00Z');
  const service = new consultas.BusquedaClasesService({buscar:async(q,date)=>{
    assert.equal(q.texto,'yoga');assert.equal(date,clock().toISOString());return {items:[],total:0};
  }},clock);
  assert.deepEqual(await service.buscar({texto:'yoga'}),{items:[],total:0,pagina:1,tamanio:20,consultadoEn:clock().toISOString()});
  await assert.rejects(new consultas.BusquedaClasesService(undefined,clock).buscar({}),{statusCode:503});
  await assert.rejects(new consultas.BusquedaClasesService({buscar:async()=>{throw new Error('fuente caída');}},clock).buscar({}),/fuente caída/);
});

test('Ruta de catálogo exige sesión, rechaza filtros inválidos y conserva la API histórica',async()=>{
  const app = appModule.buildApp({apiKey:'tecnica-ficticia',internalApiKey:'interna-ficticia',jwtSecret:'secreto-ficticio-busqueda-'.repeat(3)});
  try {
    await app.ready();
    assert.equal((await app.inject({url:'/api/v1/catalogo/clases',headers:{'x-api-key':'tecnica-ficticia'}})).statusCode,401);
    const token = app.jwt.sign({sub:'socio-demo-01',rol:'SOCIO'});
    const headers = {authorization:'Bearer '+token};
    const result = await app.inject({url:'/api/v1/catalogo/clases',headers});
    assert.equal(result.statusCode,503);assert.equal(result.json().codigo,'BUSQUEDA_NO_DISPONIBLE');
    assert.equal(result.headers['cache-control'],'no-store');
    assert.equal((await app.inject({url:'/api/v1/catalogo/clases?texto=uno&texto=dos',headers})).statusCode,400);
    assert.equal((await app.inject({url:'/api/v1/clases',headers:{'x-api-key':'tecnica-ficticia'}})).statusCode,200);
  } finally { await app.close(); }
});
