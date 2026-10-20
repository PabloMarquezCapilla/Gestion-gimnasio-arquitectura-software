import { ContextoSolicitud, IClaseRepository, ISociosClient } from '../ports';
import { EntradaEspera, ResultadoReserva } from '../types';

export class ReservasService {
  constructor(
    private repository: IClaseRepository,
    private socios: ISociosClient,
    private options: { clock?: () => Date } = {},
  ) {}

  private ahora() { return (this.options.clock ?? (() => new Date()))().toISOString(); }

  private async habilitadoEnAmbosMomentos(socioId: string, inicio: string, contexto?: ContextoSolicitud) {
    const ahora = this.ahora();
    const [actual, futura] = await Promise.all([
      this.socios.verificarHabilitacion(socioId, ahora, contexto),
      this.socios.verificarHabilitacion(socioId, inicio, contexto),
    ]);
    return actual.habilitado && futura.habilitado;
  }

  async reservar(claseId: string, socioId: string, ingresarEsperaSiLlena = false, contexto?: ContextoSolicitud): Promise<ResultadoReserva> {
    const clase = await this.repository.obtenerEntidadClase(claseId);
    if (!clase?.publicada) return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
    if (Date.parse(this.ahora()) >= Date.parse(clase.inicio)) return { exito: false, codigo: 'CLASE_INICIADA' };
    if (!await this.habilitadoEnAmbosMomentos(socioId, clase.inicio, contexto)) {
      return { exito: false, codigo: 'MEMBRESIA_NO_HABILITADA' };
    }
    return this.repository.reservarCupo(claseId, socioId, { ahora: () => this.ahora(), ingresarEsperaSiLlena });
  }

  async ingresarEspera(claseId: string, socioId: string, contexto?: ContextoSolicitud): Promise<{ exito: boolean; codigo?: string; espera?: EntradaEspera }> {
    const clase = await this.repository.obtenerEntidadClase(claseId);
    if (!clase?.publicada) return { exito: false, codigo: 'CLASE_NO_ENCONTRADA' };
    if (Date.parse(this.ahora()) >= Date.parse(clase.inicio)) return { exito: false, codigo: 'CLASE_INICIADA' };
    if (!await this.habilitadoEnAmbosMomentos(socioId, clase.inicio, contexto)) {
      return { exito: false, codigo: 'MEMBRESIA_NO_HABILITADA' };
    }
    return this.repository.ingresarListaEspera(claseId, socioId, () => this.ahora());
  }

  async cancelarReserva(reservaId: string) {
    // La cancelación local no depende de la disponibilidad de Socios.
    return this.repository.cancelarReserva(reservaId, () => this.ahora());
  }

  async procesarPendientes(contexto?: ContextoSolicitud) {
    const resumen = { promovidas: 0, retiradas: 0, pendientes: 0 };
    for (const claseId of await this.repository.listarClasesConEsperaYCupo(this.ahora())) {
      // Límite por pasada para ceder el procesador ante una cola extensa.
      for (let intento = 0; intento < 100; intento++) {
        const candidato = await this.repository.obtenerPrimerCandidato(claseId);
        if (!candidato || Date.parse(this.ahora()) >= Date.parse(candidato.clase.inicio)) break;
        let habilitado: boolean;
        try {
          // No hay bloqueo SQL ni de memoria mientras se consulta una dependencia.
          habilitado = await this.habilitadoEnAmbosMomentos(
            candidato.espera.socioId, candidato.clase.inicio, contexto,
          );
        } catch {
          resumen.pendientes++;
          return resumen; // Desconocido: conservar al primero y reintentar en otra pasada.
        }
        const result = await this.repository.aplicarEvaluacionEspera(
          claseId, candidato.espera.esperaId, habilitado, () => this.ahora(),
        );
        if (result.estado === 'PROMOVIDO') resumen.promovidas++;
        else if (result.estado === 'RETIRADO') resumen.retiradas++;
        else if (result.estado !== 'CAMBIO') break;
      }
    }
    return resumen;
  }
}
