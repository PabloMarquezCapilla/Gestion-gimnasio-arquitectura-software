export type EstadoCircuito = 'CERRADO' | 'ABIERTO' | 'SEMIABIERTO';

export class CircuitoAbiertoError extends Error {
  constructor() {
    super('El circuito hacia el proveedor está abierto.');
    this.name = 'CircuitoAbiertoError';
  }
}

export interface OpcionesCircuito {
  umbralFallos?: number;
  esperaMs?: number;
  clock?: () => number;
  // Solo las fallas de disponibilidad abren el circuito; un rechazo de contrato no.
  cuentaComoFallo?: (error: unknown) => boolean;
  alCambiar?: (anterior: EstadoCircuito, nuevo: EstadoCircuito) => void;
}

// CERRADO deja pasar; tras N fallos consecutivos pasa a ABIERTO y rechaza sin
// llamar al proveedor; vencida la espera admite una única prueba (SEMIABIERTO).
export class CircuitBreaker {
  private estadoActual: EstadoCircuito = 'CERRADO';
  private fallos = 0;
  private abiertoDesde = 0;
  private pruebaEnCurso = false;
  private readonly umbral: number;
  private readonly espera: number;
  private readonly clock: () => number;
  private readonly cuentaComoFallo: (error: unknown) => boolean;
  private readonly alCambiar?: (anterior: EstadoCircuito, nuevo: EstadoCircuito) => void;

  constructor(opciones: OpcionesCircuito = {}) {
    this.umbral = opciones.umbralFallos ?? 3;
    this.espera = opciones.esperaMs ?? 30000;
    this.clock = opciones.clock ?? Date.now;
    this.cuentaComoFallo = opciones.cuentaComoFallo ?? (() => true);
    this.alCambiar = opciones.alCambiar;
    if (!Number.isSafeInteger(this.umbral) || this.umbral < 1) throw new Error('El umbral de fallos debe ser un entero positivo.');
    if (!Number.isSafeInteger(this.espera) || this.espera < 1) throw new Error('La espera del circuito debe ser un entero positivo.');
  }

  get estado(): EstadoCircuito {
    if (this.estadoActual === 'ABIERTO' && this.clock() - this.abiertoDesde >= this.espera) return 'SEMIABIERTO';
    return this.estadoActual;
  }

  async ejecutar<T>(operacion: () => Promise<T>): Promise<T> {
    const estado = this.estado;
    if (estado === 'ABIERTO' || (estado === 'SEMIABIERTO' && this.pruebaEnCurso)) throw new CircuitoAbiertoError();
    if (estado === 'SEMIABIERTO') { this.cambiar('SEMIABIERTO'); this.pruebaEnCurso = true; }
    try {
      const resultado = await operacion();
      this.fallos = 0;
      this.cambiar('CERRADO');
      return resultado;
    } catch (error) {
      if (this.cuentaComoFallo(error)) {
        this.fallos++;
        if (this.estadoActual === 'SEMIABIERTO' || this.fallos >= this.umbral) {
          this.abiertoDesde = this.clock();
          this.cambiar('ABIERTO');
        }
      } else if (this.estadoActual === 'SEMIABIERTO') {
        // El proveedor respondió: está disponible aunque haya rechazado la solicitud.
        this.fallos = 0;
        this.cambiar('CERRADO');
      }
      throw error;
    } finally {
      this.pruebaEnCurso = false;
    }
  }

  private cambiar(nuevo: EstadoCircuito): void {
    const anterior = this.estadoActual;
    if (anterior === nuevo) return;
    this.estadoActual = nuevo;
    this.alCambiar?.(anterior, nuevo);
  }
}
