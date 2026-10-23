import type { FotografiaCarCruds } from './car-cruds.service';
import type { VinculoCarCruds } from './car-cruds-vinculos.repository';
import type { Membresia, Socio } from './types';

export type EstadoFotografia = 'PREPARADA' | 'ENVIANDO' | 'PENDIENTE' | 'RECIBIDA' | 'REQUIERE_REVISION';

export interface RegistroFotografia {
  fotografiaId: string;
  socioId: string;
  versionVinculo: number;
  administradorId: string;
  creadaEn: string;
  payload: FotografiaCarCruds;
  estado: EstadoFotografia;
  intentos: number;
  ultimoIntentoEn: string | null;
  recibidaEn: string | null;
  applied: boolean | null;
  codigoError: string | null;
  leaseId: string | null;
  leaseHasta: string | null;
}

export interface FuenteFotografia {
  vinculo: VinculoCarCruds;
  socio: Socio | null;
  membresias: Membresia[];
  // Una observación positiva guardada prueba vigencia en algún tramo del mes;
  // su ausencia no prueba que no haya tenido membresía durante todo el período.
  miembroObservadoEnPeriodo?: boolean;
}

export interface CambioPreparacionFotografia {
  employeeId: string;
  period: string;
  versionAnteriorEsperada: number;
  versionVinculoEsperada: number;
  administradorId: string;
  fecha: string;
  confirmarCambioVinculo: boolean;
  generar: (fuente: FuenteFotografia, sourceReference: string, version: number) => FotografiaCarCruds;
}

export interface CambioReclamoFotografia {
  fotografiaId: string;
  versionVinculoEsperada: number;
  administradorId: string;
  confirmarRevision: boolean;
}

export interface CambioFinalizacionFotografia {
  fotografiaId: string;
  leaseId: string;
  estado: 'RECIBIDA' | 'PENDIENTE' | 'REQUIERE_REVISION';
  codigoError: string | null;
  applied: boolean | null;
}

export interface ReclamoFotografia {
  fotografia: RegistroFotografia;
  leaseId: string | null;
}

export interface CarCrudsEvidenciasRepository {
  obtenerFotografias(employeeId: string, period: string): Promise<RegistroFotografia[]>;
  prepararFotografia(cambio: CambioPreparacionFotografia): Promise<RegistroFotografia>;
  reclamarFotografia(cambio: CambioReclamoFotografia): Promise<ReclamoFotografia>;
  finalizarFotografia(cambio: CambioFinalizacionFotografia): Promise<RegistroFotografia>;
}
