// Datos ficticios para probar el contrato; no representan reservas reales.
export interface MockClass {
  claseId: string;
  nombre: string;
  sedeId: string;
  inicio: string;
  capacidad: number;
  cuposDisponibles: number;
  publicada: boolean;
}

export const mockClasses: readonly MockClass[] = [
  {
    claseId: 'clase-demo-001',
    nombre: 'Yoga',
    sedeId: 'sede-demo-01',
    inicio: '2026-11-12T18:00:00-03:00',
    capacidad: 20,
    cuposDisponibles: 3,
    publicada: true,
  },
  {
    claseId: 'clase-demo-002',
    nombre: 'Pilates',
    sedeId: 'sede-demo-01',
    inicio: '2026-11-12T19:00:00-03:00',
    capacidad: 10,
    cuposDisponibles: 0,
    publicada: true,
  },
  {
    claseId: 'clase-demo-003',
    nombre: 'Yoga en otra sede',
    sedeId: 'sede-demo-02',
    inicio: '2026-11-13T09:00:00-03:00',
    capacidad: 15,
    cuposDisponibles: 8,
    publicada: true,
  },
  {
    claseId: 'clase-demo-004',
    nombre: 'Clase ya iniciada',
    sedeId: 'sede-demo-01',
    inicio: '2026-01-01T10:00:00-03:00',
    capacidad: 12,
    cuposDisponibles: 2,
    publicada: true,
  },
];
