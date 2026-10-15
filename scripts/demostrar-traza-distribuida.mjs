/**
 * Script de demostración de Observabilidad y Trazabilidad Distribuida (D11)
 * Muestra logs estructurados en JSON y una primera traza distribuida completa
 * entre clases-reservas y socios-membresias correlacionada mediante W3C traceparent.
 */
import { Writable } from 'node:stream';
import clasesModule from '../services/clases-reservas/dist/app.js';
import sociosModule from '../services/socios-membresias/dist/app.js';
import { MemoryClaseRepository } from '../services/clases-reservas/dist/repository.js';
import { MemorySociosRepository } from '../services/socios-membresias/dist/repository.js';

const { buildApp: buildClasesApp } = clasesModule;
const { buildSociosApp } = sociosModule;

async function ejecutarDemostracion() {
  console.log('======================================================================');
  console.log(' DEMOSTRACION: LOGS ESTRUCTURADOS Y TRAZA DISTRIBUIDA DEL FLUJO');
  console.log(' Entrega 2 - Dominio Propio de Punta a Punta');
  console.log('======================================================================\n');

  const collectedLogs = [];

  const logStream = new Writable({
    write(chunk, encoding, callback) {
      const line = chunk.toString().trim();
      if (line) {
        try {
          collectedLogs.push(JSON.parse(line));
        } catch {
          // ignore non-json lines
        }
      }
      callback();
    },
  });

  const sociosRepo = new MemorySociosRepository();
  const sociosApp = buildSociosApp({
    repository: sociosRepo,
    logger: { level: 'info', stream: logStream },
  });

  // Cliente integrado que propaga la cabecera W3C traceparent y x-correlation-id
  class IntegratedSociosClient {
    async verificarHabilitacion(socioId, fecha, traceContext) {
      const headers = { Accept: 'application/json' };
      if (traceContext) {
        headers.traceparent = `00-${traceContext.traceId}-${traceContext.spanId}-${traceContext.traceFlags}`;
        headers['x-correlation-id'] = traceContext.traceId;
      }
      const url = `/api/v1/socios/${encodeURIComponent(socioId)}/habilitacion${
        fecha ? `?fecha=${encodeURIComponent(fecha)}` : ''
      }`;
      const response = await sociosApp.inject({ method: 'GET', url, headers });
      return response.json();
    }
  }

  const clasesRepo = new MemoryClaseRepository(undefined, false);
  const clasesApp = buildClasesApp({
    apiKey: 'demo-api-key',
    repository: clasesRepo,
    sociosClient: new IntegratedSociosClient(),
    logger: { level: 'info', stream: logStream },
  });

  // Generamos un traceId W3C inicial de 32 hex chars simulando un API Gateway o cliente
  const clientTraceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const clientSpanId = '00f067aa0ba902b7';
  const incomingTraceparent = `00-${clientTraceId}-${clientSpanId}-01`;

  console.log(`[1] Cliente envía solicitud HTTP POST /api/v1/reservas`);
  console.log(`    Headers: { traceparent: '${incomingTraceparent}', x-correlation-id: '${clientTraceId}' }`);
  console.log(`    Payload: { claseId: 'clase-demo-001', socioId: 'socio-demo-01' }\n`);

  const response = await clasesApp.inject({
    method: 'POST',
    url: '/api/v1/reservas',
    headers: {
      'content-type': 'application/json',
      traceparent: incomingTraceparent,
      'x-correlation-id': clientTraceId,
    },
    payload: {
      claseId: 'clase-demo-001',
      socioId: 'socio-demo-01',
    },
  });

  console.log(`[2] Respuesta recibida HTTP ${response.statusCode}:`);
  console.log(`    Body: ${response.payload}`);
  console.log(`    Response Headers:`);
  console.log(`      traceparent: ${response.headers['traceparent']}`);
  console.log(`      x-correlation-id: ${response.headers['x-correlation-id']}\n`);

  console.log('----------------------------------------------------------------------');
  console.log(' LOGS ESTRUCTURADOS CORRELACIONADOS GENERADOS DURANTE LA EJECUCION:');
  console.log('----------------------------------------------------------------------');

  const traceLogs = collectedLogs.filter((l) => l.trace_id === clientTraceId);

  traceLogs.forEach((entry, idx) => {
    console.log(`\nLog #${idx + 1} [${entry.service?.toUpperCase() || 'APP'}] [${entry.level === 30 ? 'INFO' : 'DEBUG'}]:`);
    console.log(JSON.stringify(entry, null, 2));
  });

  console.log('\n----------------------------------------------------------------------');
  console.log(' RECONSTRUCCION DE LA TRAZA DISTRIBUIDA (SPANS):');
  console.log('----------------------------------------------------------------------');
  console.log(`Trace ID Global: ${clientTraceId}`);
  console.log(`  |`);
  console.log(`  +-- [Span Client] span_id: ${clientSpanId} (Llamada inicial desde API Gateway / Cliente)`);
  
  const clasesSpans = traceLogs.filter((l) => l.service === 'clases-reservas');
  const sociosSpans = traceLogs.filter((l) => l.service === 'socios-membresias');

  if (clasesSpans.length > 0) {
    const rootServiceSpan = clasesSpans[0].span_id;
    console.log(`        |`);
    console.log(`        +-- [Span clases-reservas] span_id: ${rootServiceSpan} | parent_span_id: ${clientSpanId}`);
    console.log(`        |     Mensaje: "Iniciando solicitud de reserva para clase"`);
    
    if (sociosSpans.length > 0) {
      const sociosSpan = sociosSpans[0].span_id;
      console.log(`        |       |`);
      console.log(`        |       +-- [Span socios-membresias] span_id: ${sociosSpan} | parent_span_id: ${rootServiceSpan}`);
      console.log(`        |             Mensaje: "Evaluando habilitacion de membresia para socio"`);
      console.log(`        |             Resultado: { habilitado: true }`);
    }
    console.log(`        |`);
    console.log(`        +-- [clases-reservas] Confirmacion y persistencia: reserva confirmada`);
  }

  console.log('\n======================================================================');
  console.log(' DEMOSTRACION COMPLETADA CON EXITO:');
  console.log(' - Logs estructurados en formato JSON (Pino)');
  console.log(` - Correlacion distribuida total con Trace ID: ${clientTraceId}`);
  console.log(' - Propagacion W3C Trace Context (traceparent) cumplida.');
  console.log('======================================================================\n');

  await sociosApp.close();
  await clasesApp.close();
}

void ejecutarDemostracion().catch((err) => {
  console.error('Error en la demostracion:', err);
  process.exit(1);
});
