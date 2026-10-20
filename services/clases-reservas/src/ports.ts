import {
  ClaseDTO, ClaseEntidad, EntradaEspera, FiltrosClases, Reserva, ResultadoCancelacion, ResultadoReserva,
} from './types';
export interface ContextoSolicitud {
  traceId: string;
  spanId: string;
  traceFlags: string;
  parentSpanId?: string;
}

export interface EvaluacionHabilitacion {
  socioId: string;
  habilitado: boolean;
  motivo?: string;
  membresia?: {
    membresiaId: string; tipoPlan: string; estado: string; fechaInicio: string; fechaFin: string;
  };
}

export interface ISociosClient {
  verificarHabilitacion(socioId: string, fecha?: string, contexto?: ContextoSolicitud): Promise<EvaluacionHabilitacion>;
}

export type Instante = string | (() => string);

export interface OpcionesReserva {
  ahora: Instante;
  ingresarEsperaSiLlena?: boolean;
}

export interface ResultadoPromocion {
  estado: 'PROMOVIDO' | 'RETIRADO' | 'CAMBIO' | 'SIN_CUPO' | 'CLASE_INICIADA';
  promocion?: { socioId: string; reservaId: string };
}

export interface IClaseRepository {
  readonly isMock: boolean;
  conexionesActivas(): number;
  inicializarEsquema(): Promise<void>;
  verificarSalud(): Promise<{ ok: boolean; detalle?: string }>;
  listarClases(filtros: FiltrosClases, consultadoEn: string): Promise<{ items: ClaseDTO[]; total: number }>;
  obtenerClase(claseId: string, consultadoEn: string): Promise<ClaseDTO | null>;
  obtenerEntidadClase(claseId: string): Promise<ClaseEntidad | null>;
  obtenerReserva(reservaId: string): Promise<Reserva | null>;
  reservarCupo(claseId: string, socioId: string, opciones?: OpcionesReserva): Promise<ResultadoReserva>;
  ingresarListaEspera(claseId: string, socioId: string, ahora?: Instante): Promise<{ exito: boolean; codigo?: string; espera?: EntradaEspera }>;
  cancelarReserva(reservaId: string, ahora?: Instante): Promise<ResultadoCancelacion>;
  obtenerPrimerCandidato(claseId: string): Promise<{ clase: ClaseEntidad; espera: EntradaEspera } | null>;
  aplicarEvaluacionEspera(claseId: string, esperaId: string, habilitado: boolean, ahora: Instante): Promise<ResultadoPromocion>;
  listarClasesConEsperaYCupo(ahora: string): Promise<string[]>;
  obtenerReservasPorClase(claseId: string): Promise<Reserva[]>;
  obtenerEsperaPorClase(claseId: string): Promise<EntradaEspera[]>;
  obtenerReservasPorSocio(socioId: string): Promise<{ reservas: Reserva[]; espera: EntradaEspera[] }>;
}
