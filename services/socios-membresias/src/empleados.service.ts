import { randomUUID } from 'node:crypto';
import type { Socio } from './types';

export interface EmpleadoExterno {
  empleadoExternoId: string;
  dni: string;
  nombre: string;
  email: string;
}

export interface AltaEmpleado {
  socioId: string;
  solicitudId: string;
  estadoSolicitud: 'PENDIENTE';
  membresiaHabilitada: false;
}

export interface RegistroEmpleado {
  origen: string;
  clave: string;
  contenido: string;
  empleado: EmpleadoExterno;
  socio: Socio;
  respuesta: AltaEmpleado;
}

export interface EmpleadosRepository {
  // Socio, solicitud, referencia externa y respuesta se guardan juntos o ninguno.
  registrarEmpleado(registro: RegistroEmpleado): Promise<AltaEmpleado>;
}

export class EmpleadosService {
  constructor(private repository: EmpleadosRepository, private clock: () => Date) {}

  recibir(origen: string, clave: string, empleado: EmpleadoExterno): Promise<AltaEmpleado> {
    const socio: Socio = {
      socioId: 'socio-' + randomUUID(), dni: empleado.dni, nombre: empleado.nombre,
      email: empleado.email, rol: 'SOCIO', estado: 'ACTIVO', createdAt: this.clock().toISOString(),
    };
    // Orden canónico: el orden de las propiedades JSON no cambia el replay.
    const contenido = JSON.stringify({
      empleadoExternoId: empleado.empleadoExternoId, dni: empleado.dni,
      nombre: empleado.nombre, email: empleado.email,
    });
    return this.repository.registrarEmpleado({
      origen, clave, contenido, empleado, socio,
      respuesta: { socioId: socio.socioId, solicitudId: 'sol-' + randomUUID(),
        estadoSolicitud: 'PENDIENTE', membresiaHabilitada: false },
    });
  }
}
