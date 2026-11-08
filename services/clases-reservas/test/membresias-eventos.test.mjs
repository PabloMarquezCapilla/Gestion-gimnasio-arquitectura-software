import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import eventos from '../dist/application/membresias-eventos.service.js';

const schema=JSON.parse(await readFile(new URL('../../../docs/contracts/membresia-actualizada-v1.schema.json',import.meta.url),'utf8'));
const ajv=new Ajv();addFormats(ajv);const validar=ajv.compile(schema);
const evento=schema.examples[0];

test('Evento de suspensión respeta el contrato versionado y delega sin depender de RabbitMQ',async()=>{
  assert.equal(validar(evento),true);
  let recibido;
  const service=new eventos.MembresiasEventosService({aplicarSuspension:async valor=>{recibido=valor;return {repetido:false,canceladas:2};}});
  assert.deepEqual(await service.procesar(Buffer.from(JSON.stringify(evento))),{repetido:false,canceladas:2});
  assert.deepEqual(recibido,evento);
});

test('Esquema/cuerpo/versiones inválidas no alcanzan la transacción de cancelación',async()=>{
  const service=new eventos.MembresiasEventosService({aplicarSuspension:async()=>assert.fail('No debe alcanzar persistencia')});
  for(const value of [null,{},[],{...evento,schemaVersion:2},{...evento,estado:'HABILITADA'},
    {...evento,extra:true},{...evento,fechaInicio:'fecha'},{...evento,eventId:'no-uuid'}]){
    assert.equal(validar(value),false);
    await assert.rejects(service.procesar(Buffer.from(JSON.stringify(value))),eventos.EventoInvalido);
  }
  await assert.rejects(service.procesar(Buffer.from('{invalido')),eventos.EventoInvalido);
  await assert.rejects(service.procesar(Buffer.alloc(65537)),eventos.EventoInvalido);
  await assert.rejects(service.procesar(Buffer.from(JSON.stringify({...evento,fechaFin:'2020-01-01T00:00:00Z'}))),eventos.EventoInvalido);
});
