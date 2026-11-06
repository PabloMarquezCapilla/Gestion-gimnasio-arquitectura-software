export class IntegracionPendienteError extends Error {
  readonly codigo = 'INTEGRACION_PENDIENTE';
  constructor() {
    super('La consulta de productos y stock todavía no está habilitada.');
  }
}

// La consulta al catálogo de FAV sigue pendiente del acuerdo externo.
// El stock físico propio se administra por separado en stock.ts.
export class TiendaService {
  consultarProductos(): never {
    throw new IntegracionPendienteError();
  }
}
