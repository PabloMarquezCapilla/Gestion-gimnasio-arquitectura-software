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

export interface ClassSession {
  id: string;
  nombre: string;
  disciplina: 'SPINNING' | 'CROSSFIT' | 'FUNCIONAL' | 'YOGA' | 'PILATES' | 'BOXEO';
  instructor: string;
  instructorAvatar?: string;
  sala: string;
  horario: string; // Ej: "18:30 - 19:30"
  dia: string; // Ej: "Hoy", "Mañana"
  fechaIso: string;
  cupoMaximo: number;
  cupoOcupado: number;
  intensidad: 'ALTA' | 'MEDIA' | 'CALMA';
  caloriasAprox: number;
}

export interface UserReservation {
  reservaId: string;
  claseId: string;
  nombreClase: string;
  disciplina: string;
  instructor: string;
  sala: string;
  horario: string;
  fechaTexto: string;
  estado: 'CONFIRMADA' | 'LISTA_ESPERA' | 'CANCELADA';
  posicionEspera?: number;
  fechaCreacion: string;
}
