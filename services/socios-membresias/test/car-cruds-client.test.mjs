import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import Ajv from 'ajv';
import clientModule from '../dist/clients/car-cruds.client.js';
import errorsModule from '../dist/errors.js';

const { HttpCarCrudsClient, carCrudsConfigDesdeEntorno } = clientModule;
const { SociosError } = errorsModule;
const token = 'token-ficticio-car-cruds-solo-pruebas';
const contract = JSON.parse(readFileSync(new URL(
  '../../../docs/contracts/car-cruds-employees-0.3.0.openapi.json', import.meta.url,
), 'utf8'));
const ajv = new Ajv({ strict: false, validateFormats: false });
function responseValidator(path) {
  return ajv.compile({
    ...contract.paths[path].get.responses['200'].content['application/json'].schema,
    components: contract.components,
  });
}
const validatePage = responseValidator('/v1/employees');
const validateStatus = responseValidator('/v1/employees/{id}/status');
const employee = { employeeId: 'empleado-ficticio-001', displayName: 'Persona Ficticia Uno' };
function page(items = [employee], overrides = {}) {
  return { items, page: 1, pageSize: 20, total: items.length, ...overrides };
}
function json(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
async function fixture(t, handler, options = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, headers: { ...request.headers } });
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
function expectedError(code, status) {
  return (error) => {
    assert.ok(error instanceof SociosError, 'Debe mantener el error de aplicación de Socios');
    assert.equal(error.codigo, code);
    assert.equal(error.statusCode, status);
    for (const text of [String(error), JSON.stringify(error), error.stack ?? '']) {
      assert.ok(!text.includes(token), 'El error no debe publicar la credencial externa');
      assert.ok(!text.includes('detalle-privado-ficticio'), 'El error no debe copiar el cuerpo externo');
    }
    return true;
  };
}

test('Car Cruds consulta páginas por HTTP con Bearer propio y conserva el prefijo de URL', async (t) => {
  const pages = [
    page([employee], { page: 1, pageSize: 1, total: 2 }),
    page([{ employeeId: 'empleado-ficticio-002', displayName: 'Persona Ficticia Dos' }], { page: 2, pageSize: 1, total: 2 }),
  ];
  const { baseUrl, requests } = await fixture(t, (_request, response, attempt) => json(response, pages[attempt - 1]));
  const client = new HttpCarCrudsClient({ baseUrl: baseUrl + '/prefijo/', token });
  for (let number = 1; number <= pages.length; number++) {
    const result = await client.listarEmpleados(number, 1);
    assert.equal(validatePage(result), true, JSON.stringify(validatePage.errors));
    assert.deepEqual(result, pages[number - 1]);
  }
  assert.deepEqual(requests.map((request) => [request.method, request.url]), [
    ['GET', '/prefijo/v1/employees?page=1&pageSize=1'],
    ['GET', '/prefijo/v1/employees?page=2&pageSize=1'],
  ]);
  for (const request of requests) {
    assert.equal(request.headers.authorization, 'Bearer ' + token);
    assert.equal(request.headers['x-api-key'], undefined);
    assert.equal(request.headers['x-service-key'], undefined);
    assert.ok(!request.url.includes(token));
  }
});

test('Car Cruds conserva identificadores opacos, nombres Unicode de 150 caracteres y una página vacía', async (t) => {
  const opaque = { employeeId: 'id-opaco-'.repeat(20), displayName: 'Á'.repeat(149) + '🧘' };
  assert.equal([...opaque.displayName].length, 150);
  const first = page([opaque]);
  const empty = page([], { page: 2, total: 1 });
  for (const body of [first, empty]) assert.equal(validatePage(body), true);
  const { client, requests } = await fixture(t, (_request, response, attempt) => json(response, attempt === 1 ? first : empty));
  assert.deepEqual(await client.listarEmpleados(), first);
  assert.deepEqual(await client.listarEmpleados(2), empty);
  assert.equal(requests.length, 2, 'Leer no debe ejecutar altas ni escrituras');
});

test('Car Cruds consulta el estado explícito y codifica el ID como un solo segmento sin query', async (t) => {
  const id = 'empleado/ficticio ñ?#%';
  const status = { employeeId: id, active: false };
  assert.equal(validateStatus(status), true);
  const { client, requests } = await fixture(t, (_request, response) => json(response, status));
  assert.deepEqual(await client.consultarEstado(id), status);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].url, '/v1/employees/' + encodeURIComponent(id) + '/status');
  assert.equal(requests[0].headers.authorization, 'Bearer ' + token);
});

test('Car Cruds rechaza paginación e identificadores locales inválidos antes de llamar al proveedor', async (t) => {
  const { client, requests } = await fixture(t, (_request, response) => json(response, page()));
  for (const [number, size] of [[0, 20], [-1, 20], [1.5, 20], [NaN, 20], [Number.MAX_SAFE_INTEGER + 1, 20], [1, 0], [1, 101], [1, 1.5]]) {
    await assert.rejects(async () => client.listarEmpleados(number, size), (error) => error instanceof SociosError && error.statusCode === 400);
  }
  for (const id of ['', '.', '..']) {
    await assert.rejects(async () => client.consultarEstado(id), (error) => error instanceof SociosError && error.statusCode === 400);
  }
  assert.equal(requests.length, 0);
});

test('Car Cruds distingue los errores externos de la sesión JWT y nunca infiere una baja', async (t) => {
  for (const [remoteStatus, code, status, attempts] of [
    [400, 'CAR_CRUDS_SOLICITUD_RECHAZADA', 502, 1],
    [401, 'CAR_CRUDS_CREDENCIAL_RECHAZADA', 502, 1],
    [403, 'CAR_CRUDS_CREDENCIAL_RECHAZADA', 502, 1],
    [404, 'CAR_CRUDS_EMPLEADO_NO_ENCONTRADO', 404, 1],
    [503, 'CAR_CRUDS_NO_DISPONIBLE', 503, 2],
  ]) {
    await t.test('HTTP externo ' + remoteStatus, async (subtest) => {
      const { client, requests } = await fixture(subtest, (_request, response) => json(response, {
        code: remoteStatus === 404 ? 'NOT_FOUND' : 'SERVICE_UNAVAILABLE',
        message: 'detalle-privado-ficticio ' + token,
      }, remoteStatus));
      await assert.rejects(() => client.consultarEstado(employee.employeeId), expectedError(code, status));
      assert.equal(requests.length, attempts);
    });
  }
  const { client, requests } = await fixture(t, (_request, response) => json(response, { code: 'NOT_FOUND', message: 'Ruta desconocida' }, 404));
  await assert.rejects(() => client.listarEmpleados(), expectedError('CAR_CRUDS_RESPUESTA_INVALIDA', 502));
  assert.equal(requests.length, 1);
});

test('Car Cruds valida el contrato importado y rechaza páginas incompatibles o incoherentes sin reintentar', async (t) => {
  const bodies = [
    null, [], {},
    page([{ ...employee, email: 'ficticia@example.invalid' }]),
    page([{ employeeId: employee.employeeId }]),
    page([{ ...employee, employeeId: '' }]),
    page([{ ...employee, displayName: 'x'.repeat(151) }]),
    page([employee], { active: true }),
    page([employee], { page: 2 }),
    page([employee], { pageSize: 100 }),
    page([employee], { total: -1 }),
    page([employee], { total: Number.MAX_SAFE_INTEGER + 1 }),
    page([employee], { total: 0 }),
    page([], { total: 1 }),
    page([employee, employee]),
  ];
  for (const [index, body] of bodies.entries()) {
    await t.test('respuesta incompatible ' + index, async (subtest) => {
      const { client, requests } = await fixture(subtest, (_request, response) => json(response, body));
      await assert.rejects(() => client.listarEmpleados(), expectedError('CAR_CRUDS_RESPUESTA_INVALIDA', 502));
      assert.equal(requests.length, 1);
    });
  }
  const invalidBySchema = bodies.filter((body) => !validatePage(body));
  assert.ok(invalidBySchema.length >= 8, 'Los casos deben cubrir incompatibilidades del OpenAPI fijado');
});

test('Car Cruds exige una respuesta de estado válida para el mismo empleado, incluso en HTTP 200', async (t) => {
  for (const body of [
    null, {}, { employeeId: employee.employeeId },
    { employeeId: employee.employeeId, active: 'false' },
    { employeeId: 'otra-persona-ficticia', active: false },
    { employeeId: employee.employeeId, active: false, displayName: employee.displayName },
  ]) {
    const { client, requests } = await fixture(t, (_request, response) => json(response, body));
    await assert.rejects(() => client.consultarEstado(employee.employeeId), expectedError('CAR_CRUDS_RESPUESTA_INVALIDA', 502));
    assert.equal(requests.length, 1);
  }
});

test('Car Cruds rechaza JSON roto, medios distintos y respuestas mayores a 1 MiB sin reintentar', async (t) => {
  for (const [contentType, body] of [
    ['application/json', '{'],
    ['text/html', JSON.stringify(page())],
    ['application/json', JSON.stringify(page([{ ...employee, employeeId: 'i'.repeat(1024 * 1024) }]))],
  ]) {
    const { client, requests } = await fixture(t, (_request, response) => {
      response.writeHead(200, { 'content-type': contentType });
      response.end(body);
    });
    await assert.rejects(() => client.listarEmpleados(), expectedError('CAR_CRUDS_RESPUESTA_INVALIDA', 502));
    assert.equal(requests.length, 1);
  }
});

test('Car Cruds no sigue redirecciones ni entrega el Bearer a otro destino', async (t) => {
  const target = await fixture(t, (_request, response) => json(response, page()));
  const source = await fixture(t, (_request, response) => {
    response.writeHead(302, { location: target.baseUrl + '/destino' });
    response.end();
  });
  await assert.rejects(() => source.client.listarEmpleados(), expectedError('CAR_CRUDS_RESPUESTA_INVALIDA', 502));
  assert.equal(source.requests.length, 1);
  assert.equal(target.requests.length, 0);
});

test('Car Cruds recupera una lectura transitoria y limita a dos los intentos fallidos', async (t) => {
  for (const remoteStatus of [502, 503, 504]) {
    const recovering = await fixture(t, (_request, response, attempt) => attempt === 1
      ? json(response, { code: 'SERVICE_UNAVAILABLE', message: 'Temporal' }, remoteStatus)
      : json(response, page()));
    assert.deepEqual(await recovering.client.listarEmpleados(), page());
    assert.equal(recovering.requests.length, 2);
  }
  const failing = await fixture(t, (request) => request.socket.destroy());
  await assert.rejects(() => failing.client.listarEmpleados(), expectedError('CAR_CRUDS_NO_DISPONIBLE', 503));
  assert.equal(failing.requests.length, 2);
});

test('Car Cruds conserva la traza y genera un span distinto por intento de consulta', async (t) => {
  const context = { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', traceFlags: '01' };
  const { client, requests } = await fixture(t, (_request, response, attempt) => attempt === 1
    ? json(response, { code: 'SERVICE_UNAVAILABLE', message: 'Temporal' }, 503)
    : json(response, page()));
  await client.listarEmpleados(1, 20, context);
  assert.equal(requests.length, 2);
  const spanIds = requests.map((request) => {
    const match = /^00-([a-f0-9]{32})-([a-f0-9]{16})-01$/.exec(request.headers.traceparent);
    assert.ok(match, 'Debe propagar traceparent W3C válido');
    assert.equal(match[1], context.traceId);
    assert.notEqual(match[2], context.spanId);
    assert.equal(request.headers['x-correlation-id'], context.traceId);
    return match[2];
  });
  assert.notEqual(spanIds[0], spanIds[1]);
});

test('Car Cruds aplica el presupuesto total también si llegan headers pero el cuerpo queda abierto', async (t) => {
  const { client, requests } = await fixture(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.flushHeaders();
    response.write('{');
  }, { timeoutMs: 250 });
  const started = performance.now();
  await assert.rejects(() => client.listarEmpleados(), expectedError('CAR_CRUDS_TIEMPO_AGOTADO', 504));
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1500, 'El timeout debe incluir el consumo del cuerpo, sin esperar indefinidamente');
  assert.equal(requests.length, 1, 'No debe reiniciar el presupuesto después de agotarlo');
});

test('Car Cruds comparte el presupuesto entre la respuesta transitoria, la espera y el reintento', async (t) => {
  const { client, requests } = await fixture(t, (_request, response, attempt) => {
    if (attempt === 1) json(response, { code: 'SERVICE_UNAVAILABLE', message: 'Temporal' }, 503);
    else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.flushHeaders();
      response.write('{');
    }
  }, { timeoutMs: 300 });
  const started = performance.now();
  await assert.rejects(() => client.listarEmpleados(), expectedError('CAR_CRUDS_TIEMPO_AGOTADO', 504));
  assert.ok(performance.now() - started < 1500, 'La espera y el segundo intento comparten un único vencimiento');
  assert.equal(requests.length, 2);
});

test('Car Cruds se configura sin leer secretos del disco y permanece deshabilitado sin URL ni token', () => {
  assert.equal(carCrudsConfigDesdeEntorno({}), undefined);
  assert.equal(carCrudsConfigDesdeEntorno({ CAR_CRUDS_BASE_URL: '', CAR_CRUDS_TOKEN: '' }), undefined);
  const config = carCrudsConfigDesdeEntorno({ CAR_CRUDS_BASE_URL: 'http://127.0.0.1:9876/prefijo', CAR_CRUDS_TOKEN: token });
  assert.equal(config.token, token);
  assert.equal(config.timeoutMs, 3000);
  assert.ok(config.baseUrl.includes('/prefijo'));
  const custom = carCrudsConfigDesdeEntorno({ CAR_CRUDS_BASE_URL: 'https://car-cruds.example.invalid', CAR_CRUDS_TOKEN: token, CAR_CRUDS_TIMEOUT_MS: '1500' });
  assert.equal(custom.timeoutMs, 1500);
});

test('Car Cruds rechaza configuración incompleta o insegura sin publicar valores sensibles', () => {
  const complete = { CAR_CRUDS_BASE_URL: 'https://car-cruds.example.invalid', CAR_CRUDS_TOKEN: token };
  for (const env of [
    { CAR_CRUDS_TOKEN: token },
    { CAR_CRUDS_BASE_URL: complete.CAR_CRUDS_BASE_URL },
    ...['file:///privado', 'ftp://car-cruds.example.invalid', 'https://usuario:clave@car-cruds.example.invalid', 'https://car-cruds.example.invalid?privado=1', 'https://car-cruds.example.invalid#privado', 'no-es-una-url'].map((url) => ({ ...complete, CAR_CRUDS_BASE_URL: url })),
    ...[token + ' otro', token + '\n', token + '\r'].map((value) => ({ ...complete, CAR_CRUDS_TOKEN: value })),
    ...['0', '-1', '1.5', 'no-numero'].map((value) => ({ ...complete, CAR_CRUDS_TIMEOUT_MS: value })),
  ]) {
    assert.throws(() => carCrudsConfigDesdeEntorno(env), (error) => {
      assert.ok(error instanceof Error);
      assert.ok(!String(error).includes(token));
      assert.ok(!String(error).includes('usuario:clave'));
      return true;
    });
  }
});
