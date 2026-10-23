import { SociosError } from './errors';
import type { TraceContext } from './tracing';

export interface EmpleadoCarCruds {
  employeeId: string;
  displayName: string;
}

export interface PaginaEmpleadosCarCruds {
  items: EmpleadoCarCruds[];
  page: number;
  pageSize: number;
  total: number;
}

export interface EstadoEmpleadoCarCruds {
  employeeId: string;
  active: boolean;
}

export interface FotografiaCarCruds {
  employeeId: string;
  period: string;
  sourceReference: string;
  version: number;
  observedAt: string;
  member: boolean | null;
  used: boolean | null;
  costMinor: number | null;
  spendingMinor: number | null;
  currency?: 'ARS';
}

export interface ResultadoEvidenciaCarCruds {
  applied: boolean;
}

export interface CarCrudsClient {
  listarEmpleados(page: number, pageSize: number, contexto?: TraceContext): Promise<PaginaEmpleadosCarCruds>;
  consultarEstado(employeeId: string, contexto?: TraceContext): Promise<EstadoEmpleadoCarCruds>;
  enviarEvidencia?(fotografia: FotografiaCarCruds, contexto?: TraceContext): Promise<ResultadoEvidenciaCarCruds>;
}

export class CarCrudsService {
  constructor(private readonly client?: CarCrudsClient) {}

  private cliente(): CarCrudsClient {
    if (!this.client) {
      throw new SociosError(503, 'CAR_CRUDS_NO_CONFIGURADO', 'La conexión con Car Cruds todavía no está configurada.');
    }
    return this.client;
  }

  listarEmpleados(query: unknown, contexto?: TraceContext): Promise<PaginaEmpleadosCarCruds> {
    const valores = this.consulta(query, ['page', 'pageSize']);
    const page = this.entero(valores.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.entero(valores.pageSize, 20, 100);
    return this.cliente().listarEmpleados(page, pageSize, contexto);
  }

  consultarEstado(employeeId: string, query: unknown, contexto?: TraceContext): Promise<EstadoEmpleadoCarCruds> {
    this.consulta(query, []);
    return this.cliente().consultarEstado(employeeId, contexto);
  }

  private consulta(query: unknown, permitidos: string[]): Record<string, unknown> {
    if (!query || typeof query !== 'object' || Array.isArray(query)
      || Object.keys(query).some((key) => !permitidos.includes(key))) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La consulta contiene parámetros no admitidos.');
    }
    return query as Record<string, unknown>;
  }

  private entero(value: unknown, predeterminado: number, maximo: number): number {
    if (value === undefined) return predeterminado;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La paginación requiere enteros positivos sin parámetros repetidos.');
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > maximo) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La paginación está fuera del rango admitido.');
    }
    return number;
  }
}
