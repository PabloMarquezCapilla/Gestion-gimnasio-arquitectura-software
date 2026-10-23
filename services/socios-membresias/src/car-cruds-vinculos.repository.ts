import type { Socio } from './types';

export interface VinculoCarCruds {
  employeeId: string;
  socioId: string | null;
  version: number;
  actualizadoEn: string | null;
}

export interface CambioVinculoCarCruds {
  employeeId: string;
  socioId: string | null;
  versionEsperada: number;
  administradorId: string;
  fecha: string;
}

export interface HistorialVinculoCarCruds {
  historialId: string;
  employeeId: string;
  version: number;
  socioAnteriorId: string | null;
  socioNuevoId: string | null;
  administradorId: string;
  createdAt: string;
}

export interface PaginaVinculosCarCruds {
  items: VinculoCarCruds[];
  page: number;
  pageSize: number;
  total: number;
}

export interface CarCrudsVinculosRepository {
  obtenerVinculoCarCruds(employeeId: string): Promise<VinculoCarCruds>;
  cambiarVinculoCarCruds(cambio: CambioVinculoCarCruds): Promise<VinculoCarCruds>;
  getHistorialVinculoCarCruds(employeeId: string): Promise<HistorialVinculoCarCruds[]>;
  listarVinculosCarCruds(page: number, pageSize: number): Promise<PaginaVinculosCarCruds>;
  buscarSociosParaVincular(identificador: string): Promise<Socio[]>;
}
