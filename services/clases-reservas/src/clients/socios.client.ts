import { TraceContext, getOutgoingTraceHeaders } from '../tracing';

export interface EvaluacionHabilitacion {
  socioId: string;
  habilitado: boolean;
  motivo?: string;
  membresia?: {
    membresiaId: string;
    tipoPlan: string;
    estado: string;
    fechaInicio: string;
    fechaFin: string;
  };
}

export interface ISociosClient {
  verificarHabilitacion(
    socioId: string,
    fecha?: string,
    traceContext?: TraceContext
  ): Promise<EvaluacionHabilitacion>;
}

export class HttpSociosClient implements ISociosClient {
  constructor(
    private baseUrl: string,
    private timeoutMs: number = 1200
  ) {}

  async verificarHabilitacion(
    socioId: string,
    fecha?: string,
    traceContext?: TraceContext
  ): Promise<EvaluacionHabilitacion> {
    const url = new URL(`/api/v1/socios/${encodeURIComponent(socioId)}/habilitacion`, this.baseUrl);
    if (fecha) {
      url.searchParams.set('fecha', fecha);
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...getOutgoingTraceHeaders(traceContext),
    };

    // Resiliencia (D5 / D10): 1 intento inicial + hasta 1 reintento con jitter (100ms ± 25ms)
    let lastError: unknown;
    for (let intento = 0; intento < 2; intento++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetch(url.toString(), {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return (await response.json()) as EvaluacionHabilitacion;
        }

        if (response.status === 404) {
          return {
            socioId,
            habilitado: false,
            motivo: 'SOCIO_NO_ENCONTRADO',
          };
        }

        // Errores 5xx pueden reintentarse con jitter
        if (response.status >= 500 && intento === 0) {
          const jitter = 75 + Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, jitter));
          continue;
        }

        return {
          socioId,
          habilitado: false,
          motivo: `ERROR_SERVICIO_SOCIOS_${response.status}`,
        };
      } catch (err) {
        lastError = err;
        if (intento === 0) {
          const jitter = 75 + Math.floor(Math.random() * 50);
          await new Promise((resolve) => setTimeout(resolve, jitter));
          continue;
        }
      }
    }

    throw new Error(
      `No se pudo consultar habilitacion de socio en ${this.baseUrl}: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`
    );
  }
}

export class MockSociosClient implements ISociosClient {
  constructor(private habilitados = new Set(['socio-demo-01', 'socio-demo-02', 'socio-demo-03'])) {}

  async verificarHabilitacion(socioId: string): Promise<EvaluacionHabilitacion> {
    const habilitado = this.habilitados.has(socioId);
    return {
      socioId,
      habilitado,
      motivo: habilitado ? undefined : 'SOCIO_NO_HABILITADO',
      membresia: habilitado
        ? {
            membresiaId: `mem-${socioId}`,
            tipoPlan: 'FULL',
            estado: 'HABILITADA',
            fechaInicio: '2026-01-01T00:00:00.000Z',
            fechaFin: '2027-12-31T23:59:59.000Z',
          }
        : undefined,
    };
  }
}
