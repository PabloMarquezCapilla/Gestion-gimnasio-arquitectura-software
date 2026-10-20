import { TraceContext, getOutgoingTraceHeaders } from '../tracing';
import { EvaluacionHabilitacion, ISociosClient } from '../ports';
export { EvaluacionHabilitacion, ISociosClient } from '../ports';

export class HttpSociosClient implements ISociosClient {
  constructor(
    private baseUrl: string,
    private timeoutMs = 3000,
    private internalApiKey = process.env.SERVICIOS_API_KEY ?? '',
  ) {
    if (!internalApiKey.trim()) throw new Error('Se requiere SERVICIOS_API_KEY para consultar Socios.');
  }

  async verificarHabilitacion(socioId: string, fecha?: string, contexto?: TraceContext): Promise<EvaluacionHabilitacion> {
    const url = new URL('/api/v1/socios/' + encodeURIComponent(socioId) + '/habilitacion', this.baseUrl);
    if (fecha) url.searchParams.set('fecha', fecha);
    let lastError: unknown;
    const deadline = Date.now() + this.timeoutMs;
    for (let intento = 0; intento < 2; intento++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remaining);
      let retry = true;
      try {
        const response = await fetch(url, {
          headers: { Accept: 'application/json', 'X-Service-Key': this.internalApiKey, ...getOutgoingTraceHeaders(contexto) },
          signal: controller.signal,
        });
        if (response.ok) {
          // El timeout protege también la lectura completa del cuerpo.
          const body = await response.json() as EvaluacionHabilitacion;
          if (body?.socioId !== socioId || typeof body.habilitado !== 'boolean') {
            throw new Error('Respuesta inválida del servicio de Socios.');
          }
          return body;
        }
        if (response.status === 404) return { socioId, habilitado: false, motivo: 'SOCIO_NO_ENCONTRADO' };
        retry = [502, 503, 504].includes(response.status);
        throw new Error('HTTP ' + response.status + ' desde Socios.');
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timeout);
      }
      if (!retry || intento === 1) break;
      const pause = Math.min(75 + Math.floor(Math.random() * 50), deadline - Date.now());
      if (pause <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, pause));
    }
    throw Object.assign(new Error('No se pudo verificar la membresía con Socios.', { cause: lastError }), { statusCode: 503 });
  }
}

export class MockSociosClient implements ISociosClient {
  constructor(private habilitados = new Set(['socio-demo-01', 'socio-demo-02', 'socio-demo-03'])) {}
  async verificarHabilitacion(socioId: string, fecha?: string): Promise<EvaluacionHabilitacion> {
    const instante = fecha ? Date.parse(fecha) : Date.now();
    const habilitado = this.habilitados.has(socioId)
      && instante >= Date.parse('2026-01-01T00:00:00Z') && instante <= Date.parse('2027-12-31T23:59:59Z');
    return {
      socioId, habilitado, motivo: habilitado ? undefined : 'SOCIO_NO_HABILITADO',
      membresia: habilitado ? {
        membresiaId: 'mem-' + socioId, tipoPlan: 'FULL', estado: 'HABILITADA',
        fechaInicio: '2026-01-01T00:00:00.000Z', fechaFin: '2027-12-31T23:59:59.000Z',
      } : undefined,
    };
  }
}
