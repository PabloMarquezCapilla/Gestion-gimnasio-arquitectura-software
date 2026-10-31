import { test } from 'node:test';
import assert from 'node:assert/strict';
import gestion from '../dist/membresias.gestion.js';
const { datosGestion,claveGestion,paginaGestion }=gestion;
test('Planes: importe exacto, nombre obligatorio y rechazo de campos económicos no definidos',()=>{
 assert.deepEqual(datosGestion('crearPlan',{moneda:'ARS',nombre:' Configurado ',importeMinor:12345}),{importeMinor:12345,moneda:'ARS',nombre:'Configurado'});
 for(const body of [{nombre:' ',importeMinor:1,moneda:'ARS'},{nombre:'Plan',importeMinor:1.5,moneda:'ARS'},{nombre:'Plan',importeMinor:-1,moneda:'ARS'},{nombre:'Plan',importeMinor:Number.MAX_SAFE_INTEGER+1,moneda:'ARS'},{nombre:'Plan',importeMinor:1,moneda:'ars'},{nombre:'Plan',importeMinor:1,moneda:'ZZZ'},{nombre:'Plan',importeMinor:1,moneda:'ARS',descuento:0}])assert.throws(()=>datosGestion('crearPlan',body));
});
test('Vigencia explícita: RFC3339 real con zona, normalización y orden; sin períodos implícitos',()=>{
 const body={planId:'plan-prueba',fechaInicio:'2040-01-01T10:00:00-03:00',fechaFin:'2040-02-01T13:00:00Z'};
 assert.equal(datosGestion('solicitar',body).fechaInicio,'2040-01-01T13:00:00.000Z');
 for(const b of [{...body,fechaInicio:'2040-02-30T10:00:00Z'},{...body,fechaFin:'2039-01-01T10:00:00Z'},{...body,fechaInicio:'2040-01-01'},{...body,dias:30}])assert.throws(()=>datosGestion('solicitar',b));
});
test('Confirmar es comando sin bandera de estado ni habilitación enviada por React',()=>{
 assert.deepEqual(datosGestion('confirmarPago',{}),{});
 for(const body of [{estado:'CONFIRMADO'},{pagoConfirmado:true},{membresia:{estado:'HABILITADA'}}])assert.throws(()=>datosGestion('confirmarPago',body));
 assert.throws(()=>datosGestion('registrarPago',{referencia:'corta',importeMinor:2,moneda:'ARS'}));
});
test('Claves y paginación acotadas sin filtros silenciosamente ignorados',()=>{
 assert.equal(claveGestion('operacion-123'),'operacion-123');assert.throws(()=>claveGestion(''));
 assert.deepEqual(paginaGestion({pagina:'2',tamanio:'10'}),{pagina:2,tamanio:10});
 for(const q of [{pagina:0},{tamanio:101},{pagina:1.5},{estado:'CONFIRMADA'}])assert.throws(()=>paginaGestion(q));
});
