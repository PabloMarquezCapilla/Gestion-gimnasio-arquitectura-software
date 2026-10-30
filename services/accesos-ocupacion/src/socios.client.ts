import { AccesosError, Contexto, Evaluacion, SociosClient } from './domain';

export class HttpSociosClient implements SociosClient {
  constructor(private readonly baseUrl: string, private readonly key: string, private readonly timeoutMs = 3000) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !key.trim()) throw new Error('Configurar Socios y clave técnica de Accesos.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new Error('Timeout de Socios inválido.');
  }
  async verificar(socioId: string, fecha: string, contexto?: Contexto): Promise<Evaluacion> {
    const url = new URL('/api/v1/socios/' + encodeURIComponent(socioId) + '/habilitacion', this.baseUrl);
    url.searchParams.set('fecha', fecha);
    const deadline = performance.now() + this.timeoutMs;
    for (let intento = 0; intento < 2; intento++) {
      const restante = deadline - performance.now();
      if (restante <= 0) break;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), restante);
      let retry = false;
      try {
        const response = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: {
          Accept: 'application/json', 'X-Service-Key': this.key,
          ...(contexto ? { traceparent: `00-${contexto.traceId}-${contexto.spanId}-${contexto.traceFlags}`, 'X-Correlation-ID': contexto.traceId } : {}),
        } });
        retry = [502, 503, 504].includes(response.status);
        if (response.status === 404) return { habilitado: false, motivo: 'SOCIO_NO_ENCONTRADO' };
        if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body) throw new Error();
        const chunks: Uint8Array[] = []; let bytes = 0;
        for await (const chunk of response.body) {
          bytes += chunk.byteLength; if (bytes > 65536) throw new Error(); chunks.push(chunk);
        }
        const b = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        if (b?.socioId !== socioId || typeof b.habilitado !== 'boolean' || (b.motivo !== undefined && typeof b.motivo !== 'string')) throw new Error();
        if (b.habilitado) {
          const m = b.membresia; const t = Date.parse(fecha);
          if (!m || m.estado !== 'HABILITADA' || typeof m.membresiaId !== 'string'
            || !Number.isFinite(Date.parse(m.fechaInicio)) || !Number.isFinite(Date.parse(m.fechaFin))
            || t < Date.parse(m.fechaInicio) || t > Date.parse(m.fechaFin)) throw new Error();
        }
        return { habilitado: b.habilitado, ...(b.motivo ? { motivo: b.motivo } : {}) };
      } catch (error) {
        if (error instanceof TypeError) retry = true; // Transporte: solo GET, nunca escrituras.
      } finally { clearTimeout(timer); controller.abort(); }
      if (!retry || intento === 1) break;
      const pausa = Math.min(75 + Math.floor(Math.random() * 50), deadline - performance.now());
      if (pausa > 0) await new Promise(resolve => setTimeout(resolve, pausa));
    }
    throw new AccesosError(503, 'SOCIOS_NO_DISPONIBLE', 'No se pudo verificar la membresía. No se registró el ingreso.');
  }
}
