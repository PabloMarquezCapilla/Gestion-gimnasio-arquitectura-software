import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse } from 'yaml';
import appModule from '../dist/app.js';

const { buildApp } = appModule;
const contract = parse(readFileSync(new URL('../../../docs/contracts/openapi-v1.yaml', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ strict: false });
addFormats(ajv, { mode: 'full' });
const apiKey = 'clave-ficticia-solo-pruebas';
const instant = '2026-10-07T15:00:00.000Z';

function resolveReference(value) {
  if (!value) return value;
  return value.$ref
    ? value.$ref.slice(2).split('/').reduce((current, part) => current[part], contract)
    : value;
}

function verifyResponse(response, path) {
  const definition = resolveReference(contract.paths[path].get.responses[String(response.statusCode)]);
  assert.ok(definition, `El contrato debe declarar HTTP ${response.statusCode}.`);
  const schema = definition.content['application/json'].schema;
  const validate = ajv.compile({ ...schema, components: contract.components });
  assert.equal(validate(response.json()), true, JSON.stringify(validate.errors));
  for (const [name, original] of Object.entries(definition.headers ?? {})) {
    const header = resolveReference(original);
    if (header.required) assert.ok(response.headers[name.toLowerCase()], `Falta ${name}.`);
    if (header.schema?.const !== undefined) {
      assert.equal(response.headers[name.toLowerCase()], header.schema.const);
    }
  }
  return response.json();
}

async function withApp(run, options = {}) {
  const app = buildApp({ apiKey, clock: () => new Date(instant), ...options });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

const get = (app, url, headers = { 'x-api-key': apiKey }) => app.inject({ method: 'GET', url, headers });

test('el listado cumple el contrato, ordena y devuelve una instantánea ficticia', async () => {
  await withApp(async (app) => {
    const response = await get(app, '/api/v1/clases');
    assert.equal(response.statusCode, 200);
    const body = verifyResponse(response, '/api/v1/clases');
    assert.equal(body.pagina, 1);
    assert.equal(body.tamanio, 20);
    assert.equal(body.total, 4);
    assert.deepEqual(body.items.map((item) => item.claseId), [
      'clase-demo-004', 'clase-demo-001', 'clase-demo-002', 'clase-demo-003',
    ]);
    assert.ok(body.items.every((item) => item.consultadoEn === instant && item.cuposDisponibles <= item.capacidad));
    assert.equal(response.headers['x-mock'], 'true');
  });
});

test('filtra como instantes, incluye desde, excluye hasta y pagina después de filtrar', async () => {
  await withApp(async (app) => {
    const query = new URLSearchParams({
      sedeId: 'sede-demo-01',
      desde: '2026-11-12T21:00:00Z',
      hasta: '2026-11-12T22:00:00Z',
      pagina: '1',
      tamanio: '1',
    });
    const first = await get(app, `/api/v1/clases?${query}`);
    assert.equal(first.statusCode, 200);
    const firstBody = verifyResponse(first, '/api/v1/clases');
    assert.equal(firstBody.total, 1);
    assert.deepEqual(firstBody.items.map((item) => item.claseId), ['clase-demo-001']);

    const second = await get(app, '/api/v1/clases?sedeId=sede-demo-01&pagina=2&tamanio=1');
    const secondBody = verifyResponse(second, '/api/v1/clases');
    assert.equal(secondBody.total, 3);
    assert.deepEqual(secondBody.items.map((item) => item.claseId), ['clase-demo-001']);
    assert.equal(secondBody.pagina, 2);
    assert.equal(secondBody.tamanio, 1);
  });
});

test('la página fuera del resultado y una sede sin clases devuelven 200 vacío', async () => {
  await withApp(async (app) => {
    for (const url of ['/api/v1/clases?pagina=100', '/api/v1/clases?sedeId=sede-inexistente']) {
      const response = await get(app, url);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(verifyResponse(response, '/api/v1/clases').items, []);
    }
  });
});

test('se exige la clave correcta en ambos endpoints antes de validar parámetros', async () => {
  await withApp(async (app) => {
    for (const url of ['/api/v1/clases?pagina=0', '/api/v1/clases/clase-demo-001']) {
      for (const headers of [{}, { 'x-api-key': 'clave-incorrecta' }]) {
        const response = await get(app, url, headers);
        assert.equal(response.statusCode, 401);
        const path = url.includes('/clase-demo-001') ? '/api/v1/clases/{claseId}' : '/api/v1/clases';
        assert.equal(verifyResponse(response, path).codigo, 'NO_AUTENTICADO');
      }
    }
  });
  assert.throws(() => buildApp({ apiKey: '' }), /CAPACIDAD_API_KEY/);
});

test('rechaza filtros, fechas e intervalos inválidos con el error declarado', async () => {
  await withApp(async (app) => {
    const invalidQueries = [
      'pagina=0', 'pagina=-1', 'pagina=1.5', 'pagina=abc',
      'tamanio=0', 'tamanio=101', 'tamanio=1.5', 'sedeId=',
      'desde=2026-11-12T18%3A00%3A00',
      'desde=2026-02-30T18%3A00%3A00Z',
      'desde=2026-11-12%2018%3A00%3A00Z',
      'desde=2026-11-12T18%3A00%3A00Z&hasta=2026-11-12T18%3A00%3A00Z',
      'desde=2026-11-13T18%3A00%3A00Z&hasta=2026-11-12T18%3A00%3A00Z',
    ];
    for (const query of invalidQueries) {
      const response = await get(app, `/api/v1/clases?${query}`);
      assert.equal(response.statusCode, 400, query);
      assert.equal(verifyResponse(response, '/api/v1/clases').codigo, 'PARAMETROS_INVALIDOS');
    }
    const malformedUrl = await get(app, '/api/v1/clases/%E0%A4%A');
    assert.equal(malformedUrl.statusCode, 400, 'Una URL malformada conserva el error de solicitud.');
  });
});

test('una clase llena o iniciada sigue siendo consultable; una inexistente devuelve 404', async () => {
  await withApp(async (app) => {
    const full = await get(app, '/api/v1/clases/clase-demo-002');
    assert.equal(full.statusCode, 200);
    assert.equal(verifyResponse(full, '/api/v1/clases/{claseId}').cuposDisponibles, 0);
    assert.equal(full.headers['x-mock'], 'true');

    const past = await get(app, '/api/v1/clases/clase-demo-004');
    assert.equal(past.statusCode, 200);
    const pastBody = verifyResponse(past, '/api/v1/clases/{claseId}');
    assert.ok(Date.parse(pastBody.inicio) < Date.parse(instant));

    const missing = await get(app, '/api/v1/clases/no-existe');
    assert.equal(missing.statusCode, 404);
    assert.equal(verifyResponse(missing, '/api/v1/clases/{claseId}').codigo, 'CLASE_NO_ENCONTRADA');
  });
});

test('no publica clases ocultas y desempata el orden por claseId', async () => {
  const base = { nombre: 'Ficticia', sedeId: 'sede-prueba', capacidad: 5, cuposDisponibles: 1, publicada: true };
  await withApp(async (app) => {
    const response = await get(app, '/api/v1/clases');
    assert.deepEqual(verifyResponse(response, '/api/v1/clases').items.map((item) => item.claseId), ['a', 'b']);
    const hidden = await get(app, '/api/v1/clases/oculta');
    assert.equal(hidden.statusCode, 404);
    verifyResponse(hidden, '/api/v1/clases/{claseId}');
  }, {
    classes: [
      { ...base, claseId: 'b', inicio: '2026-11-12T18:00:00-03:00' },
      { ...base, claseId: 'a', inicio: '2026-11-12T21:00:00Z' },
      { ...base, claseId: 'oculta', inicio: '2026-11-12T20:00:00Z', publicada: false },
    ],
  });
});

test('los errores internos o temporales respetan el contrato sin inventar disponibilidad', async () => {
  for (const status of [500, 503]) {
    await withApp(async (app) => {
      const response = await get(app, '/api/v1/clases/clase-demo-001');
      assert.equal(response.statusCode, status);
      const body = verifyResponse(response, '/api/v1/clases/{claseId}');
      assert.equal(body.codigo, status === 503 ? 'SERVICIO_NO_DISPONIBLE' : 'ERROR_INTERNO');
      assert.equal(body.cuposDisponibles, undefined);
    }, {
      clock: () => { throw Object.assign(new Error('Falla simulada en prueba'), { statusCode: status }); },
    });
  }
});

test('health describe únicamente la estructura y el modo mock', async () => {
  await withApp(async (app) => {
    const response = await get(app, '/health', {});
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { servicio: 'clases-reservas', estado: 'estructura', modo: 'mock' });
  });
});
