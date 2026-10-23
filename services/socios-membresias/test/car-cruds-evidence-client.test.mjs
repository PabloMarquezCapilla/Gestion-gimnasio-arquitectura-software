import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import clientModule from '../dist/clients/car-cruds.client.js';
import errorsModule from '../dist/errors.js';

const { HttpCarCrudsClient, CarCrudsError } = clientModule;
const { SociosError } = errorsModule;
const token = 'token-ficticio-evidencia-solo-pruebas';
const fotografia = {
  employeeId: 'empleado-ficticio-001', period: '2026-10',
  sourceReference: 'gimnasio-ficticio-001', version: 1,
  observedAt: '2026-10-23T14:15:16.123456-03:00',
  member: true, used: null, costMinor: null, spendingMinor: null,
};

function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function fixture(t, handler, options = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const partes = [];
    for await (const chunk of request) partes.push(chunk);
    requests.push({ method: request.method, url: request.url, headers: { ...request.headers }, body: Buffer.concat(partes).toString('utf8') });
    handler(request, response, requests.length);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    requests, baseUrl,
    client: new HttpCarCrudsClient({ baseUrl, token, ...options }),
  };
}

function expectedError(code, status, reintentable = false) {
  return (error) => {
    assert.ok(error instanceof CarCrudsError);
    assert.ok(error instanceof SociosError);
    assert.equal(error.codigo, code);
    assert.equal(error.statusCode, status);
    assert.equal(error.reintentable, reintentable);
    assert.equal(error.resultadoIncierto, reintentable);
    for (const text of [String(error), JSON.stringify(error), error.stack ?? '']) {
      assert.ok(!text.includes(token), 'No debe publicar la credencial');
      assert.ok(!text.includes('detalle-privado-ficticio'), 'No debe copiar datos del cuerpo externo');
    }
    return true;
  };
}

test('Car Cruds POST entrega una fotografía completa sin alterar identidad, versión, corte ni desconocidos', async (t) => {
  const target = await fixture(t, (_request, response) => json(response, { applied: true }));
  const client = new HttpCarCrudsClient({ baseUrl: target.baseUrl + '/prefijo/', token });
  const original = structuredClone(fotografia);
  assert.deepEqual(await client.enviarEvidencia(fotografia), { applied: true });
  assert.deepEqual(fotografia, original, 'El cliente no modifica la fotografía guardada');
  assert.equal(target.requests.length, 1);
  const [request] = target.requests;
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/prefijo/v1/employees/membership-evidence');
  assert.equal(request.headers.authorization, 'Bearer ' + token);
  assert.equal(request.headers.accept, 'application/json');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['idempotency-key'], undefined);
  assert.equal(request.headers['x-api-key'], undefined);
  assert.equal(request.headers['x-service-key'], undefined);
  assert.equal(request.body, JSON.stringify(original));
});

test('Car Cruds POST acepta recibo applied:false y el reenvío explícito conserva exactamente el mismo cuerpo', async (t) => {
  const { client, requests } = await fixture(t, (_request, response, attempt) => json(response, { applied: attempt === 1 }));
  const known = { ...fotografia, version: 2, costMinor: 0, spendingMinor: 14999, currency: 'ARS' };
  assert.deepEqual(await client.enviarEvidencia(known), { applied: true });
  assert.deepEqual(await client.enviarEvidencia(known), { applied: false });
  assert.equal(requests.length, 2, 'Solo debe efectuar las dos llamadas pedidas por el emisor');
  assert.equal(requests[0].body, requests[1].body);
});

test('Car Cruds POST rechaza fotografías incompatibles antes de efectuar una escritura', async (t) => {
  const { client, requests } = await fixture(t, (_request, response) => json(response, { applied: true }));
  const cases = [
    null, [], {}, { ...fotografia, employeeId: '' },
    { ...fotografia, employeeId: 'x'.repeat(101) },
    { ...fotografia, employeeId: ' empleado' },
    { ...fotografia, sourceReference: 'referencia\u0000oculta' },
    { ...fotografia, sourceReference: 'referencia\u0085oculta' },
    { ...fotografia, period: '2026-10 ' },
    { ...fotografia, version: 0 }, { ...fotografia, version: 1.5 },
    { ...fotografia, version: Number.MAX_SAFE_INTEGER + 1 },
    { ...fotografia, observedAt: 'no-es-una-fecha' },
    { ...fotografia, observedAt: '2026-02-30T12:00:00Z' },
    { ...fotografia, observedAt: '2026-10-23T12:00:00' },
    { ...fotografia, member: 'true' }, { ...fotografia, used: 0 },
    { ...fotografia, costMinor: -1, currency: 'ARS' },
    { ...fotografia, spendingMinor: 1.5, currency: 'ARS' },
    { ...fotografia, spendingMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'ARS' },
    { ...fotografia, costMinor: 0 },
    { ...fotografia, spendingMinor: 0, currency: 'USD' },
    { ...fotografia, actor: 'no-se-elige-el-emisor' },
  ];
  for (const value of cases) {
    await assert.rejects(() => client.enviarEvidencia(value), (error) => {
      assert.ok(error instanceof SociosError);
      assert.equal(error.codigo, 'FOTOGRAFIA_CAR_CRUDS_INVALIDA');
      assert.equal(error.statusCode, 400);
      return true;
    });
  }
  assert.equal(requests.length, 0);
});

test('Car Cruds POST separa rechazo definitivo, conflicto y resultado incierto sin reintento automático', async (t) => {
  for (const [remoteStatus, code, status, retry] of [
    [400, 'CAR_CRUDS_EVIDENCIA_RECHAZADA', 502, false],
    [401, 'CAR_CRUDS_CREDENCIAL_RECHAZADA', 502, false],
    [403, 'CAR_CRUDS_CREDENCIAL_RECHAZADA', 502, false],
    [404, 'CAR_CRUDS_EMPLEADO_NO_ENCONTRADO', 404, false],
    [409, 'CAR_CRUDS_EVIDENCIA_CONFLICTO', 409, false],
    [415, 'CAR_CRUDS_EVIDENCIA_RECHAZADA', 502, false],
    [422, 'CAR_CRUDS_EVIDENCIA_RECHAZADA', 502, false],
    [408, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
    [429, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
    [500, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
    [502, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
    [503, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
    [504, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
    [201, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
    [204, 'CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true],
  ]) {
    await t.test('HTTP ' + remoteStatus, async (subtest) => {
      const { client, requests } = await fixture(subtest, (_request, response) => json(response, {
        code: 'ERROR', message: 'detalle-privado-ficticio ' + token,
      }, remoteStatus));
      await assert.rejects(() => client.enviarEvidencia(fotografia), expectedError(code, status, retry));
      assert.equal(requests.length, 1);
    });
  }
});

test('Car Cruds POST considera incierto un 200 sin recibo válido y no infiere que la escritura falló', async (t) => {
  for (const [contentType, body] of [
    ['application/json', '{'],
    ['application/json', JSON.stringify({ applied: 'true' })],
    ['application/json', JSON.stringify({ applied: true, privado: 'detalle-privado-ficticio' })],
    ['application/json', JSON.stringify(null)],
    ['application/json', JSON.stringify({ applied: true, dato: 'x'.repeat(1024 * 1024) })],
    ['application/json', Buffer.from([0xc3, 0x28])],
    ['text/html', JSON.stringify({ applied: true })],
  ]) {
    const { client, requests } = await fixture(t, (_request, response) => {
      response.writeHead(200, { 'content-type': contentType });
      response.end(body);
    });
    await assert.rejects(() => client.enviarEvidencia(fotografia), expectedError('CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true));
    assert.equal(requests.length, 1);
  }
});

test('Car Cruds POST no sigue redirecciones 307 ni filtra el token a otro destino', async (t) => {
  const target = await fixture(t, (_request, response) => json(response, { applied: true }));
  const source = await fixture(t, (_request, response) => {
    response.writeHead(307, { location: target.baseUrl + '/otro-destino' });
    response.end();
  });
  await assert.rejects(() => source.client.enviarEvidencia(fotografia), expectedError('CAR_CRUDS_EVIDENCIA_RECHAZADA', 502));
  assert.equal(source.requests.length, 1);
  assert.equal(target.requests.length, 0);
});

test('Car Cruds POST trata la desconexión después de recibir el cuerpo como resultado incierto sin repetir', async (t) => {
  const { client, requests } = await fixture(t, (request) => request.socket.destroy());
  await assert.rejects(() => client.enviarEvidencia(fotografia), expectedError('CAR_CRUDS_EVIDENCIA_INCIERTA', 503, true));
  assert.equal(requests.length, 1);
});

test('Car Cruds POST aplica un único timeout hasta completar el cuerpo del recibo', async (t) => {
  const { client, requests } = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    response.write('{"applied":');
  }, { timeoutMs: 250 });
  const started = performance.now();
  await assert.rejects(() => client.enviarEvidencia(fotografia), expectedError('CAR_CRUDS_EVIDENCIA_TIEMPO_AGOTADO', 504, true));
  assert.ok(performance.now() - started < 1500, 'Debe interrumpir también un cuerpo que permanece abierto');
  assert.equal(requests.length, 1);
});

test('Car Cruds POST propaga la traza del envío en un span hijo', async (t) => {
  const { client, requests } = await fixture(t, (_request, response) => json(response, { applied: true }));
  const context = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', traceFlags: '01' };
  await client.enviarEvidencia(fotografia, context);
  const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-01$/.exec(requests[0].headers.traceparent);
  assert.ok(match);
  assert.equal(match[1], context.traceId);
  assert.notEqual(match[2], context.spanId);
  assert.equal(requests[0].headers['x-correlation-id'], context.traceId);
});
