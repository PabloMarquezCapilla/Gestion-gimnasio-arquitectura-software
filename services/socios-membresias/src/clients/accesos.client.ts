import { generateSpanId, generateTraceId, getOutgoingTraceHeaders, TraceContext } from '../tracing';

export interface AccesosUsoClient {
  // true/false si Accesos lo confirmó; undefined si no se pudo saber (se informa null).
  huboIngreso(socioId: string, desde: Date, hasta: Date, contexto?: TraceContext): Promise<boolean | undefined>;
}

// Lectura segura entre servicios: presupuesto total, un reintento y degradación a "desconocido".
export class HttpAccesosUsoClient implements AccesosUsoClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string, private readonly serviceKey: string, private readonly timeoutMs = 2000) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('ACCESOS_SERVICE_URL debe ser HTTP o HTTPS.');
    if (!serviceKey.trim()) throw new Error('Se requiere SERVICIOS_API_KEY para consultar Accesos.');
    url.pathname = url.pathname.replace(/\/+$/, '') + '/';
    this.baseUrl = url.href;
  }

  async huboIngreso(socioId: string, desde: Date, hasta: Date, contexto?: TraceContext): Promise<boolean | undefined> {
    const url = new URL('internal/v1/accesos/uso', this.baseUrl);
    url.searchParams.set('socioId', socioId);
    url.searchParams.set('desde', desde.toISOString());
    url.searchParams.set('hasta', hasta.toISOString());
    const trace = contexto ?? { traceId: generateTraceId(), spanId: generateSpanId(), traceFlags: '01' };
    const deadline = performance.now() + this.timeoutMs;
    for (let intento = 0; intento < 2; intento++) {
      const restante = deadline - performance.now();
      if (restante <= 0) return undefined;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), restante);
      try {
        const response = await fetch(url, { signal: controller.signal, redirect: 'manual',
          headers: { Accept: 'application/json', 'X-Service-Key': this.serviceKey, ...getOutgoingTraceHeaders(trace) } });
        if (response.status === 200) {
          const body = await response.json() as { socioId?: unknown; huboIngreso?: unknown };
          return body.socioId === socioId && typeof body.huboIngreso === 'boolean' ? body.huboIngreso : undefined;
        }
        // Solo la indisponibilidad justifica el reintento; un 4xx no cambia al repetir.
        if (![502, 503, 504].includes(response.status)) return undefined;
      } catch {
        if (controller.signal.aborted) return undefined;
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
      const pausa = Math.min(50 + Math.floor(Math.random() * 50), deadline - performance.now());
      if (pausa > 0) await new Promise(resolve => setTimeout(resolve, pausa));
    }
    return undefined;
  }
}
