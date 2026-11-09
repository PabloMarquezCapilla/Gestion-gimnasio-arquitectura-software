// Test de carga del flujo principal a través del gateway (D13).
// Ejecutar con: npm run test:carga  (corre k6 en Docker dentro de la red del compose).
//
// Cada usuario virtual simula un socio distinto: usa una IP de cliente propia en
// X-Forwarded-For (el gateway confía en ese encabezado solo desde la red interna),
// así el límite por IP del gateway se aplica por cliente y no a todo el ensayo.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://gateway';
const busqueda = new Trend('latencia_busqueda', true);
const reserva = new Trend('latencia_reserva', true);
const rechazosGateway = new Rate('rechazos_gateway');

// 200/201: éxito; 409: resultado de negocio esperado (clase llena o reserva repetida).
http.setResponseCallback(http.expectedStatuses(200, 201, 409));

// PERFIL=estres: tasa de llegada creciente sin pausas, para encontrar el límite.
const ESTRES = __ENV.PERFIL === 'estres' || !!__ENV.TASA;

export const options = {
  // TASA=n: tasa fija de n recorridos/s durante 45 s, para medir la capacidad en un punto.
  scenarios: __ENV.TASA ? {
    fija: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.TASA),
      timeUnit: '1s',
      duration: '45s',
      preAllocatedVUs: 200,
      maxVUs: 600,
    },
  } : ESTRES ? {
    estres: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 600,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '30s', target: 400 },
        { duration: '30s', target: 800 },
        { duration: '30s', target: 1200 },
      ],
    },
  } : {
    socios: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 20 },
        { duration: '1m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    latencia_busqueda: ['p(95)<300'],
    latencia_reserva: ['p(95)<500'],
    rechazos_gateway: ['rate<0.01'],
  },
};

const SOCIOS = ['11111111', '22222222', '33333333'];
const TEXTOS = ['yoga', 'pilates', 'funcional', 'spinning', ''];

export function setup() {
  // Tres sesiones reales; el login tiene su propio límite estricto por IP.
  const sesiones = SOCIOS.map((dni, i) => {
    const r = http.post(`${BASE}/api/v1/auth/login`, JSON.stringify({ emailOrDni: dni, password: 'socio123' }),
      { headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `10.250.0.${i + 1}` } });
    if (r.status !== 200) throw new Error(`Login ${dni} falló: ${r.status}`);
    return { token: r.json('token'), socioId: r.json('socio.socioId') };
  });
  const r = http.get(`${BASE}/api/v1/catalogo/clases?tamanio=50`,
    { headers: { Authorization: `Bearer ${sesiones[0].token}`, 'X-Forwarded-For': '10.250.0.9' } });
  const clases = (r.json('items') || []).map(c => c.claseId);
  if (!clases.length) throw new Error('No hay clases publicadas para reservar.');
  return { sesiones, clases };
}

export default function (data) {
  const sesion = data.sesiones[__VU % data.sesiones.length];
  const headers = {
    Authorization: `Bearer ${sesion.token}`,
    'Content-Type': 'application/json',
    'X-Forwarded-For': `10.${(__VU >> 8) & 255}.${__VU & 255}.1`,
  };
  const texto = TEXTOS[__ITER % TEXTOS.length];
  const query = `${texto ? `texto=${texto}&` : ''}soloConCupo=${__ITER % 2 === 0}&orden=inicio_asc&pagina=1&tamanio=20`;
  const r1 = http.get(`${BASE}/api/v1/catalogo/clases?${query}`, { headers, tags: { paso: 'busqueda' } });
  busqueda.add(r1.timings.duration);
  rechazosGateway.add(r1.status === 429 || r1.status === 401);
  check(r1, { 'búsqueda 200': r => r.status === 200 });

  // Uno de cada cinco recorridos intenta reservar: es la operación crítica con control de cupo.
  if (__ITER % 5 === 0) {
    const claseId = data.clases[(__VU + __ITER) % data.clases.length];
    const r2 = http.post(`${BASE}/api/v1/reservas`, JSON.stringify({ claseId, socioId: sesion.socioId, ingresarEsperaSiLlena: false }),
      { headers, tags: { paso: 'reserva' } });
    reserva.add(r2.timings.duration);
    rechazosGateway.add(r2.status === 429 || r2.status === 401);
    check(r2, { 'reserva 201 o 409 de negocio': r => r.status === 201 || r.status === 409 });
  }
  if (!ESTRES) sleep(0.5 + Math.random());
}

export function handleSummary(data) {
  return {
    [`/resultados/resumen${__ENV.TASA ? '-tasa-' + __ENV.TASA : ESTRES ? '-estres' : ''}.json`]: JSON.stringify(data, null, 2),
    stdout: textoResumen(data),
  };
}

function textoResumen(d) {
  const m = d.metrics;
  const v = (k, f) => (m[k] && m[k].values[f] !== undefined ? m[k].values[f].toFixed(2) : '-');
  return [
    `solicitudes=${m.http_reqs.values.count} rps=${v('http_reqs', 'rate')}`,
    `fallidas=${(m.http_req_failed.values.rate * 100).toFixed(2)}%`,
    `busqueda p50=${v('latencia_busqueda', 'med')}ms p95=${v('latencia_busqueda', 'p(95)')}ms max=${v('latencia_busqueda', 'max')}ms`,
    `reserva p50=${v('latencia_reserva', 'med')}ms p95=${v('latencia_reserva', 'p(95)')}ms max=${v('latencia_reserva', 'max')}ms`,
    `vus_max=${m.vus_max.values.max}`, '',
  ].join('\n');
}
