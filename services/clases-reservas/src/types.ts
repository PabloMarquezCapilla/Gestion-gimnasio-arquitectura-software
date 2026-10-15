export interface ClaseDTO {
  claseId: string;
  nombre: string;
  sedeId: string;
  inicio: string;
  capacidad: number;
  cuposDisponibles: number;
  consultadoEn: string;
}

export interface ClaseEntidad {
  claseId: string;
  nombre: string;
  sedeId: string;
  profesor?: string;
  actividad?: string;
  inicio: string;
  fin: string;
  capacidad: number;
  publicada: boolean;
  createdAt: string;
}

export type EstadoReserva = 'CONFIRMADA' | 'CANCELADA';
export type EstadoEspera = 'PENDIENTE' | 'PROMOVIDO' | 'CANCELADO';

export interface Reserva {
  reservaId: string;
  claseId: string;
  socioId: string;
  estado: EstadoReserva;
  createdAt: string;
  updatedAt: string;
}

export interface EntradaEspera {
  esperaId: string;
  claseId: string;
  socioId: string;
  orden: number;
  estado: EstadoEspera;
  createdAt: string;
  updatedAt: string;
}

export interface FiltrosClases {
  sedeId?: string;
  desde?: string;
  hasta?: string;
  pagina: number;
  tamanio: number;
}

export interface ResultadoReserva {
  exito: boolean;
  codigo?: string;
  mensaje?: string;
  reserva?: Reserva;
  puedeIngresarEspera?: boolean;
}

export interface ResultadoCancelacion {
  exito: boolean;
  codigo?: string;
  mensaje?: string;
  reserva?: Reserva;
  promocion?: {
    socioId: string;
    reservaId: string;
  };
}
