import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SociosError } from '../errors';
import type { CarCrudsClient, EstadoEmpleadoCarCruds, FotografiaCarCruds, PaginaEmpleadosCarCruds, ResultadoEvidenciaCarCruds } from '../car-cruds.service';
import { generateSpanId, generateTraceId, getOutgoingTraceHeaders, TraceContext } from '../tracing';

export interface CarCrudsConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

type CodigoCarCruds =
  | 'CAR_CRUDS_CREDENCIAL_RECHAZADA'
  | 'CAR_CRUDS_EMPLEADO_NO_ENCONTRADO'
  | 'CAR_CRUDS_SOLICITUD_RECHAZADA'
  | 'CAR_CRUDS_RESPUESTA_INVALIDA'
  | 'CAR_CRUDS_NO_DISPONIBLE'
  | 'CAR_CRUDS_TIEMPO_AGOTADO'
  | 'CAR_CRUDS_EVIDENCIA_CONFLICTO'
  | 'CAR_CRUDS_EVIDENCIA_RECHAZADA'
  | 'CAR_CRUDS_EVIDENCIA_INCIERTA'
  | 'CAR_CRUDS_EVIDENCIA_TIEMPO_AGOTADO';

const fallos: Record<CodigoCarCruds, [number, string]> = {
  CAR_CRUDS_CREDENCIAL_RECHAZADA: [502, 'Car Cruds rechazó la credencial de la integración.'],
  CAR_CRUDS_EMPLEADO_NO_ENCONTRADO: [404, 'Car Cruds no reconoce el identificador del empleado; no se puede inferir una baja.'],
  CAR_CRUDS_SOLICITUD_RECHAZADA: [502, 'Car Cruds rechazó la consulta de la integración.'],
  CAR_CRUDS_RESPUESTA_INVALIDA: [502, 'La respuesta de Car Cruds no cumple el contrato esperado.'],
  CAR_CRUDS_NO_DISPONIBLE: [503, 'No se pudo consultar Car Cruds; su información permanece desconocida.'],
  CAR_CRUDS_TIEMPO_AGOTADO: [504, 'Se agotó el tiempo de consulta a Car Cruds; su información permanece desconocida.'],
  CAR_CRUDS_EVIDENCIA_CONFLICTO: [409, 'Car Cruds informó un conflicto de evidencia; se requiere revisión antes de reenviar.'],
  CAR_CRUDS_EVIDENCIA_RECHAZADA: [502, 'Car Cruds rechazó el envío de evidencia; se requiere revisión de la integración.'],
  CAR_CRUDS_EVIDENCIA_INCIERTA: [503, 'No se pudo confirmar el resultado del envío a Car Cruds; debe conservarse la misma fotografía para el reintento.'],
  CAR_CRUDS_EVIDENCIA_TIEMPO_AGOTADO: [504, 'Se agotó el tiempo de envío a Car Cruds; el resultado es incierto.'],
};

export class CarCrudsError extends SociosError {
  readonly reintentable: boolean;
  readonly resultadoIncierto: boolean;

  constructor(codigo: CodigoCarCruds) {
    super(fallos[codigo][0], codigo, fallos[codigo][1]);
    this.name = 'CarCrudsError';
    this.reintentable = ['CAR_CRUDS_EVIDENCIA_INCIERTA', 'CAR_CRUDS_EVIDENCIA_TIEMPO_AGOTADO'].includes(codigo);
    this.resultadoIncierto = this.reintentable;
  }
}

function validarConfig(config: CarCrudsConfig): Required<CarCrudsConfig> {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error('CAR_CRUDS_BASE_URL debe ser una URL HTTP o HTTPS válida.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('CAR_CRUDS_BASE_URL debe ser HTTP/HTTPS, sin credenciales, consulta ni fragmento.');
  }
  if (typeof config.token !== 'string' || !/^[A-Za-z0-9._~+\/-]+=*$/.test(config.token)) {
    throw new Error('CAR_CRUDS_TOKEN debe contener únicamente la credencial Bearer de aplicación.');
  }
  const timeoutMs = config.timeoutMs ?? 3000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new Error('CAR_CRUDS_TIMEOUT_MS debe ser un entero entre 1 y 30000 milisegundos.');
  }
  url.pathname = url.pathname.replace(/\/+$/, '') + '/';
  return { baseUrl: url.href, token: config.token, timeoutMs };
}

export function carCrudsConfigDesdeEntorno(env: NodeJS.ProcessEnv = process.env): Required<CarCrudsConfig> | undefined {
  const baseUrl = env.CAR_CRUDS_BASE_URL?.trim() ?? '';
  const token = env.CAR_CRUDS_TOKEN ?? '';
  const rawTimeout = env.CAR_CRUDS_TIMEOUT_MS;
  if (rawTimeout !== undefined && !/^[1-9][0-9]*$/.test(rawTimeout)) {
    throw new Error('CAR_CRUDS_TIMEOUT_MS debe ser un entero positivo de milisegundos.');
  }
  const timeoutMs = rawTimeout === undefined ? 3000 : Number(rawTimeout);
  if (!baseUrl && !token) {
    // Validar el presupuesto aunque la integración aún no tenga credencial.
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs > 30000) {
      throw new Error('CAR_CRUDS_TIMEOUT_MS debe ser un entero entre 1 y 30000 milisegundos.');
    }
    return undefined;
  }
  if (!baseUrl || !token) throw new Error('Configurar conjuntamente CAR_CRUDS_BASE_URL y CAR_CRUDS_TOKEN.');
  return validarConfig({ baseUrl, token, timeoutMs });
}

const contract = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../docs/contracts/car-cruds-employees-0.3.0.openapi.json'), 'utf8',
));
const ajv = new Ajv({ strict: false });
addFormats(ajv);
// No redondear silenciosamente los int64 del proveedor al representarlos en JS.
ajv.addFormat('int64', { type: 'number', validate: Number.isSafeInteger });
const validarPagina = ajv.compile<PaginaEmpleadosCarCruds>({
  ...contract.paths['/v1/employees'].get.responses['200'].content['application/json'].schema,
  components: contract.components,
});
const validarEstado = ajv.compile<EstadoEmpleadoCarCruds>({
  ...contract.paths['/v1/employees/{id}/status'].get.responses['200'].content['application/json'].schema,
  components: contract.components,
});
const operacionEvidencia = contract.paths['/v1/employees/membership-evidence'].post;
const validarFotografia = ajv.compile<FotografiaCarCruds>({
  ...operacionEvidencia.requestBody.content['application/json'].schema,
  components: contract.components,
});
const validarRecibo = ajv.compile<ResultadoEvidenciaCarCruds>({
  ...operacionEvidencia.responses['200'].content['application/json'].schema,
  components: contract.components,
});
const MAX_BODY_BYTES = 1024 * 1024;

export class HttpCarCrudsClient implements CarCrudsClient {
  private readonly config: Required<CarCrudsConfig>;

  constructor(config: CarCrudsConfig) {
    this.config = validarConfig(config);
  }

  async listarEmpleados(page = 1, pageSize = 20, contexto?: TraceContext): Promise<PaginaEmpleadosCarCruds> {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La paginación requiere page positivo y pageSize entre 1 y 100.');
    }
    const url = new URL('v1/employees', this.config.baseUrl);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(pageSize));
    const body = await this.consultar(url, false, contexto);
    if (!validarPagina(body) || !Number.isSafeInteger(body.page) || body.page !== page || body.pageSize !== pageSize) {
      throw new CarCrudsError('CAR_CRUDS_RESPUESTA_INVALIDA');
    }
    const offset = (BigInt(page) - 1n) * BigInt(pageSize);
    const restantes = BigInt(body.total) - offset;
    const esperados = restantes <= 0n ? 0 : Number(restantes > BigInt(pageSize) ? BigInt(pageSize) : restantes);
    if (body.items.length !== esperados || new Set(body.items.map((item) => item.employeeId)).size !== body.items.length) {
      throw new CarCrudsError('CAR_CRUDS_RESPUESTA_INVALIDA');
    }
    return {
      page: body.page, pageSize: body.pageSize, total: body.total,
      items: body.items.map(({ employeeId, displayName }) => ({ employeeId, displayName })),
    };
  }

  async consultarEstado(employeeId: string, contexto?: TraceContext): Promise<EstadoEmpleadoCarCruds> {
    let encoded: string;
    try {
      if (typeof employeeId !== 'string' || !employeeId || ['.', '..'].includes(employeeId)) throw new Error();
      encoded = encodeURIComponent(employeeId);
    } catch {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'Se requiere un identificador de empleado válido.');
    }
    const url = new URL('v1/employees/' + encoded + '/status', this.config.baseUrl);
    const body = await this.consultar(url, true, contexto);
    if (!validarEstado(body) || body.employeeId !== employeeId) {
      throw new CarCrudsError('CAR_CRUDS_RESPUESTA_INVALIDA');
    }
    return { employeeId: body.employeeId, active: body.active };
  }

  async enviarEvidencia(fotografia: FotografiaCarCruds, contexto?: TraceContext): Promise<ResultadoEvidenciaCarCruds> {
    if (!validarFotografia(fotografia)
      || ['employeeId', 'period', 'sourceReference'].some((campo) => {
        const valor = fotografia[campo as 'employeeId' | 'period' | 'sourceReference'];
        return valor !== valor.trim() || /\p{Cc}/u.test(valor);
      })
      || (fotografia.currency !== undefined && fotografia.currency !== 'ARS')
      || ((fotografia.costMinor != null || fotografia.spendingMinor != null) && fotografia.currency !== 'ARS')) {
      throw new SociosError(400, 'FOTOGRAFIA_CAR_CRUDS_INVALIDA', 'La fotografía no cumple el contrato de evidencia de Car Cruds.');
    }
    // Se serializa una sola vez. La cola conserva esta fotografía para reintentos;
    // el cliente nunca vuelve a ejecutar automáticamente una escritura externa.
    const cuerpo = JSON.stringify(fotografia);
    const url = new URL('v1/employees/membership-evidence', this.config.baseUrl);
    const deadline = performance.now() + this.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          Authorization: 'Bearer ' + this.config.token,
          ...getOutgoingTraceHeaders(contexto),
        },
        body: cuerpo,
      });
      if (response.status === 200) {
        const recibo = await this.leerJson(response);
        if (!validarRecibo(recibo)) throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_INCIERTA');
        return { applied: recibo.applied };
      }
      if ([401, 403].includes(response.status)) throw new CarCrudsError('CAR_CRUDS_CREDENCIAL_RECHAZADA');
      if (response.status === 404) throw new CarCrudsError('CAR_CRUDS_EMPLEADO_NO_ENCONTRADO');
      if (response.status === 409) throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_CONFLICTO');
      if (response.status >= 500 || response.status < 300 || response.status === 408 || response.status === 429) {
        throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_INCIERTA');
      }
      throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_RECHAZADA');
    } catch (error) {
      if (controller.signal.aborted || performance.now() >= deadline) {
        throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_TIEMPO_AGOTADO');
      }
      if (error instanceof CarCrudsError && error.codigo !== 'CAR_CRUDS_RESPUESTA_INVALIDA') throw error;
      // Un 200 con cuerpo ilegible tampoco demuestra si se aplicó la escritura.
      throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_INCIERTA');
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }

  private async consultar(url: URL, permite404: boolean, contexto?: TraceContext): Promise<unknown> {
    const deadline = performance.now() + this.config.timeoutMs;
    const trace = contexto ?? { traceId: generateTraceId(), spanId: generateSpanId(), traceFlags: '01' };
    let fallo = new CarCrudsError('CAR_CRUDS_NO_DISPONIBLE');
    for (let intento = 0; intento < 2; intento++) {
      const restante = deadline - performance.now();
      if (restante <= 0) throw new CarCrudsError('CAR_CRUDS_TIEMPO_AGOTADO');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), restante);
      try {
        const response = await fetch(url, {
          method: 'GET', redirect: 'manual', signal: controller.signal,
          headers: {
            Accept: 'application/json', Authorization: 'Bearer ' + this.config.token,
            ...getOutgoingTraceHeaders(trace),
          },
        });
        if (response.status === 200) {
          return await this.leerJson(response);
        }
        if ([401, 403].includes(response.status)) throw new CarCrudsError('CAR_CRUDS_CREDENCIAL_RECHAZADA');
        if (response.status === 404 && permite404) throw new CarCrudsError('CAR_CRUDS_EMPLEADO_NO_ENCONTRADO');
        if (response.status === 400) throw new CarCrudsError('CAR_CRUDS_SOLICITUD_RECHAZADA');
        if ([502, 503, 504].includes(response.status)) throw new CarCrudsError('CAR_CRUDS_NO_DISPONIBLE');
        throw new CarCrudsError('CAR_CRUDS_RESPUESTA_INVALIDA');
      } catch (error) {
        fallo = controller.signal.aborted || performance.now() >= deadline
          ? new CarCrudsError('CAR_CRUDS_TIEMPO_AGOTADO')
          : error instanceof CarCrudsError ? error : new CarCrudsError('CAR_CRUDS_NO_DISPONIBLE');
      } finally {
        clearTimeout(timer);
        // También descarta cuerpos de error sin leerlos, incluidos datos privados.
        controller.abort();
      }
      if (fallo.codigo !== 'CAR_CRUDS_NO_DISPONIBLE' || intento === 1) throw fallo;
      const pausa = Math.min(75 + Math.floor(Math.random() * 50), deadline - performance.now());
      if (pausa > 0) await new Promise((resolve) => setTimeout(resolve, pausa));
    }
    throw fallo;
  }

  private async leerJson(response: Response): Promise<unknown> {
    if (response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json'
      || !response.body) {
      throw new CarCrudsError('CAR_CRUDS_RESPUESTA_INVALIDA');
    }
    const reader = response.body.getReader();
    const partes: Uint8Array[] = [];
    let bytes = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.byteLength;
        if (bytes > MAX_BODY_BYTES) throw new CarCrudsError('CAR_CRUDS_RESPUESTA_INVALIDA');
        partes.push(result.value);
      }
    } finally {
      reader.releaseLock();
    }
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(partes));
      return JSON.parse(text) as unknown;
    } catch {
      throw new CarCrudsError('CAR_CRUDS_RESPUESTA_INVALIDA');
    }
  }
}
