export type UserRole = 'ADMIN' | 'SOCIO';

export interface UserMembresia {
  membresiaId: string;
  socioId: string;
  tipoPlan: string;
  fechaInicio: string;
  fechaFin: string;
  estado: 'HABILITADA' | 'SUSPENDIDA' | 'VENCIDA';
}

export interface AuthUser {
  socioId: string;
  dni: string;
  nombre: string;
  email: string;
  rol: UserRole;
  telefono?: string;
  estado: 'ACTIVO' | 'INACTIVO';
  createdAt: string;
  membresia?: UserMembresia | null;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface AuthResponse {
  token: string;
  socio: AuthUser;
  membresia: UserMembresia | null;
}

export interface ClassSession {
  id: string;
  nombre: string;
  sedeId: string;
  horario: string;
  dia: string;
  fechaIso: string;
  cupoMaximo: number;
  cupoOcupado: number;
}

export interface UserReservation {
  reservaId: string;
  claseId: string;
  nombreClase: string;
  tipo: 'RESERVA' | 'ESPERA';
  sedeId?: string;
  horario: string;
  fechaTexto: string;
  estado: 'CONFIRMADA' | 'LISTA_ESPERA' | 'CANCELADA';
  posicionEspera?: number;
  fechaCreacion: string;
  inicio?: string;
}
