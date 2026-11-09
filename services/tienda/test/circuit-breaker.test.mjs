import assert from 'node:assert/strict';
import test from 'node:test';
import { CircuitBreaker, CircuitoAbiertoError } from '../dist/circuit-breaker.js';

function fixture(opciones = {}) {
  let ahora = 0;
  const cambios = [];
  const breaker = new CircuitBreaker({ umbralFallos: 3, esperaMs: 1000, clock: () => ahora,
    alCambiar: (a, b) => cambios.push(`${a}->${b}`), ...opciones });
  return { breaker, cambios, avanzar: ms => { ahora += ms; } };
}
const falla = () => Promise.reject(new Error('caído'));
const ok = () => Promise.resolve('ok');

test('se abre tras N fallos consecutivos y deja de llamar al proveedor', async () => {
  const { breaker, cambios } = fixture();
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.ejecutar(falla), /caído/);
  assert.equal(breaker.estado, 'ABIERTO');
  let llamadas = 0;
  await assert.rejects(breaker.ejecutar(async () => { llamadas++; }), CircuitoAbiertoError);
  assert.equal(llamadas, 0);
  assert.deepEqual(cambios, ['CERRADO->ABIERTO']);
});

test('un éxito reinicia el conteo de fallos', async () => {
  const { breaker } = fixture();
  await assert.rejects(breaker.ejecutar(falla));
  await assert.rejects(breaker.ejecutar(falla));
  assert.equal(await breaker.ejecutar(ok), 'ok');
  await assert.rejects(breaker.ejecutar(falla));
  assert.equal(breaker.estado, 'CERRADO');
});

test('vencida la espera admite una sola prueba: si sale bien cierra, si falla reabre', async () => {
  const { breaker, cambios, avanzar } = fixture();
  for (let i = 0; i < 3; i++) await assert.rejects(breaker.ejecutar(falla));
  avanzar(1000);
  assert.equal(breaker.estado, 'SEMIABIERTO');
  await assert.rejects(breaker.ejecutar(falla));
  assert.equal(breaker.estado, 'ABIERTO');
  avanzar(1000);
  let liberar;
  const prueba = breaker.ejecutar(() => new Promise(resolve => { liberar = resolve; }));
  // Mientras la prueba está en curso, otras solicitudes no llegan al proveedor.
  await assert.rejects(breaker.ejecutar(ok), CircuitoAbiertoError);
  liberar('ok');
  assert.equal(await prueba, 'ok');
  assert.equal(breaker.estado, 'CERRADO');
  assert.deepEqual(cambios, ['CERRADO->ABIERTO', 'ABIERTO->SEMIABIERTO', 'SEMIABIERTO->ABIERTO', 'ABIERTO->SEMIABIERTO', 'SEMIABIERTO->CERRADO']);
});

test('los errores que no son de disponibilidad no abren el circuito', async () => {
  const { breaker } = fixture({ cuentaComoFallo: error => error.message !== 'contrato' });
  for (let i = 0; i < 5; i++) await assert.rejects(breaker.ejecutar(() => Promise.reject(new Error('contrato'))));
  assert.equal(breaker.estado, 'CERRADO');
});

test('rechaza configuraciones inválidas', () => {
  assert.throws(() => new CircuitBreaker({ umbralFallos: 0 }));
  assert.throws(() => new CircuitBreaker({ esperaMs: -1 }));
});
