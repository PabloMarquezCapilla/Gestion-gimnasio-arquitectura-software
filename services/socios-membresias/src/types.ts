export type EstadoSocio = 'ACTIVO' | 'INACTIVO';
export type EstadoMembresia = 'HABILITADA' | 'SUSPENDIDA' | 'VENCIDA';

export interface Socio {
  socioId: string;
  dni: string;
  nombre: string;
  email: string;
  estado: EstadoSocio;
  createdAt: string;
}

export interface Membresia {
  membresiaId: string;
  socioId: string;
  tipoPlan: string;
  fechaInicio: string;
  fechaFin: string;
  estado: EstadoMembresia;
  createdAt: string;
  updatedAt: string;
}

export interface ResultadoHabilitacion {
  socioId: string;
  habilitado: boolean;
  motivo?: string;
  membresia?: {
    membresiaId: string;
    tipoPlan: string;
    estado: EstadoMembresia;
    fechaInicio: string;
    fechaFin: string;
  };
}
