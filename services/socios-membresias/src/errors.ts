export class SociosError extends Error {
  constructor(readonly statusCode: number, readonly codigo: string, mensaje: string) {
    super(mensaje);
    this.name = 'SociosError';
  }
}

export class IdentidadDuplicadaError extends Error {
  readonly code = '23505';

  constructor(readonly campo: 'dni' | 'email' | 'socioId') {
    super('La identidad del socio ya está registrada.');
    this.name = 'IdentidadDuplicadaError';
  }
}
