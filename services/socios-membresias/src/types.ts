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
}

export interface LoginDTO {
  emailOrDni: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  socio: SocioPublico;
  membresia: Membresia | null;
}

export type SocioPublico = Omit<Socio, 'passwordHash' | 'rol'> & { rol: RolUsuario };

export interface Identidad {
  socioId: string;
  rol: RolUsuario;
}

export interface JwtIdentidad {
  sub: string;
  rol: RolUsuario;
  iat: number;
  exp: number;
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
