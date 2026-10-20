export class IntegracionPendienteError extends Error {
  readonly codigo = 'INTEGRACION_PENDIENTE';
  constructor() {
    super('La consulta de productos y stock todavía no está habilitada.');
  }
}

// Sin contrato real no se define un modelo de producto ni un cliente externo.
// No hay catálogo de respaldo, persistencia, caché ni stock propio.
export class TiendaService {
  consultarProductos(): never {
    throw new IntegracionPendienteError();
  }
}
