export type EstadoSocio = 'ACTIVO' | 'INACTIVO';
export type EstadoMembresia = 'HABILITADA' | 'SUSPENDIDA' | 'VENCIDA';
export type RolUsuario = 'SOCIO' | 'ADMIN';

export interface Socio {
  socioId: string;
  dni: string;
  nombre: string;
  email: string;
  passwordHash?: string;
  rol?: RolUsuario;
  telefono?: string;
  estado: EstadoSocio;
  createdAt: string;
}

export interface RegistroDTO {
  dni: string;
  nombre: string;
  email: string;
  password: string;
  telefono?: string;
  tipoPlan?: string;
  rol?: RolUsuario;
}

export interface LoginDTO {
  emailOrDni: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  socio: Omit<Socio, 'passwordHash'>;
  membresia?: Membresia | null;
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
