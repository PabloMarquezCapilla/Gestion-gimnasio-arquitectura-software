import { GestionClasesError, SedesClient } from '../application/gestion-clases.service';
import { ContextoSolicitud } from '../ports';
import { getOutgoingTraceHeaders } from '../tracing';

export class HttpSedesClient implements SedesClient {
  private url: URL;
  constructor(baseUrl: string, private timeoutMs = 3000) {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
      throw new Error('ACCESOS_SERVICE_URL debe ser HTTP(S) sin credenciales, query ni fragmento.');
    }
    this.url = new URL('/api/v1/accesos/sedes', base);
  }
  async listar(authorization: string, contexto?: ContextoSolicitud) {
    try {
      const response = await fetch(this.url, { headers: { Authorization: authorization,
        ...(contexto ? getOutgoingTraceHeaders(contexto) : {}) }, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
        await response.body?.cancel();
        throw new Error();
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 1024 * 1024) throw new Error();
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!body || !Array.isArray(body.items) || body.items.some((s: any) => !s
        || typeof s.sedeId !== 'string' || !s.sedeId.trim() || Array.from(s.sedeId).length > 50
        || typeof s.nombre !== 'string' || !s.nombre.trim())
        || new Set(body.items.map((s: any) => s.sedeId)).size !== body.items.length) throw new Error();
      return body.items.map((s: { sedeId: string; nombre: string }) => ({ sedeId: s.sedeId, nombre: s.nombre }));
    } catch {
      throw new GestionClasesError(503, 'SEDES_NO_DISPONIBLES', 'No se pudo comprobar la sede con Accesos. Volvé a intentar con la misma operación.');
    }
  }
}
