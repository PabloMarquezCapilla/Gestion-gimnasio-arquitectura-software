import type { CarCrudsClient, FotografiaCarCruds } from './car-cruds.service';
import type { CarCrudsEvidenciasRepository, FuenteFotografia, RegistroFotografia } from './car-cruds-evidencias.repository';
import { CarCrudsError } from './clients/car-cruds.client';
import { SociosError } from './errors';
import { seleccionarMembresia } from './services';
import type { Identidad } from './types';
import type { TraceContext } from './tracing';

export function mesArgentina(fecha: Date): string {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit',
  }).formatToParts(fecha);
  return partes.find(p => p.type === 'year')!.value.padStart(4, '0') + '-'
    + partes.find(p => p.type === 'month')!.value;
}

export class CarCrudsEvidenciasService {
  constructor(
    private readonly repository: CarCrudsEvidenciasRepository,
    private readonly client: CarCrudsClient | undefined,
    private readonly clock: () => Date,
  ) {}

  async consultar(identidad: Identidad, employeeId: string, query: unknown) {
    this.administrador(identidad);
    const valores = this.objeto(query, ['period']);
    const period = this.periodo(valores.period);
    return { items: await this.repository.obtenerFotografias(this.employeeId(employeeId), period) };
  }

  preparar(identidad: Identidad, employeeId: string, value: unknown, query: unknown): Promise<RegistroFotografia> {
    this.administrador(identidad);
    this.objeto(query, []);
    const body = this.objeto(value, ['period', 'versionVinculoEsperada', 'versionAnteriorEsperada', 'confirmarCambioVinculo']);
    const period = this.periodo(body.period);
    this.entero(body.versionVinculoEsperada, 1, 2147483647);
    this.entero(body.versionAnteriorEsperada, 0, Number.MAX_SAFE_INTEGER - 1);
    this.booleanoOpcional(body.confirmarCambioVinculo);
    const id = this.employeeId(employeeId);
    const fecha = this.clock().toISOString();
    return this.repository.prepararFotografia({
      employeeId: id, period, fecha, administradorId: identidad.socioId,
      versionVinculoEsperada: body.versionVinculoEsperada as number,
      versionAnteriorEsperada: body.versionAnteriorEsperada as number,
      confirmarCambioVinculo: body.confirmarCambioVinculo === true,
      generar: (fuente, sourceReference, version) => this.generar(fuente, id, period, fecha, sourceReference, version),
    });
  }

  async enviar(identidad: Identidad, fotografiaId: string, value: unknown, query: unknown, contexto?: TraceContext) {
    this.administrador(identidad);
    this.objeto(query, []);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fotografiaId)) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'El identificador de fotografía debe ser válido.');
    }
    const body = this.objeto(value, ['versionVinculoEsperada', 'confirmarRevision']);
    this.entero(body.versionVinculoEsperada, 1, 2147483647);
    this.booleanoOpcional(body.confirmarRevision);
    const enviar = this.client?.enviarEvidencia;
    if (!enviar) throw new SociosError(503, 'CAR_CRUDS_NO_CONFIGURADO', 'La conexión con Car Cruds todavía no está configurada.');
    const reclamo = await this.repository.reclamarFotografia({
      fotografiaId, administradorId: identidad.socioId,
      versionVinculoEsperada: body.versionVinculoEsperada as number,
      confirmarRevision: body.confirmarRevision === true,
    });
    if (!reclamo.leaseId) return reclamo.fotografia;
    let estado: 'RECIBIDA' | 'PENDIENTE' | 'REQUIERE_REVISION';
    let codigoError: string | null = null;
    let applied: boolean | null = null;
    try {
      // La fotografía se lee del registro durable: un reintento no recalcula los hechos.
      const receipt = await enviar.call(this.client, structuredClone(reclamo.fotografia.payload), contexto);
      if (!receipt || typeof receipt.applied !== 'boolean' || Object.keys(receipt).some(key => key !== 'applied')) {
        throw new CarCrudsError('CAR_CRUDS_EVIDENCIA_INCIERTA');
      }
      applied = receipt.applied;
      estado = 'RECIBIDA';
    } catch (error) {
      estado = error instanceof CarCrudsError && !error.reintentable ? 'REQUIERE_REVISION' : 'PENDIENTE';
      codigoError = error instanceof CarCrudsError ? error.codigo : 'CAR_CRUDS_EVIDENCIA_INCIERTA';
    }
    // Un fallo de este guardado conserva ENVIANDO; al vencer el lease se puede
    // recuperar el mismo mensaje. No se presenta como recibido sin persistirlo.
    return this.repository.finalizarFotografia({ fotografiaId, leaseId: reclamo.leaseId, estado, codigoError, applied });
  }

  private generar(
    fuente: FuenteFotografia, employeeId: string, period: string, observedAt: string, sourceReference: string, version: number,
  ): FotografiaCarCruds {
    if (!fuente.socio) throw new SociosError(404, 'SOCIO_NO_ENCONTRADO', 'No se encontró el socio vinculado.');
    const instante = Date.parse(observedAt);
    const membresia = seleccionarMembresia(fuente.membresias, new Date(observedAt));
    // El estado actual permite demostrar un instante del mes actual, pero no
    // reconstruir cambios anteriores ni demostrar un mes completo sin afiliación.
    const vigenteAhora = fuente.socio.estado === 'ACTIVO' && Date.parse(fuente.socio.createdAt) <= instante
      && membresia?.estado === 'HABILITADA'
      && Date.parse(membresia.createdAt) <= instante && Date.parse(membresia.updatedAt) <= instante
      && Date.parse(membresia.fechaInicio) <= instante && instante <= Date.parse(membresia.fechaFin);
    return {
      employeeId, period, sourceReference, version, observedAt,
      member: fuente.miembroObservadoEnPeriodo === true || period === mesArgentina(new Date(observedAt)) && vigenteAhora ? true : null,
      used: null, costMinor: null, spendingMinor: null,
    };
  }

  private administrador(identidad: Identidad): void {
    if (identidad.rol !== 'ADMIN') throw new SociosError(403, 'ACCESO_DENEGADO', 'Esta operación requiere permisos de administrador.');
  }

  private objeto(value: unknown, permitidos: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !permitidos.includes(key))) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La solicitud contiene campos o parámetros no admitidos.');
    }
    return value as Record<string, unknown>;
  }

  private periodo(value: unknown): string {
    if (typeof value !== 'string' || !/^(?!0000)[0-9]{4}-(0[1-9]|1[0-2])$/.test(value) || value > mesArgentina(this.clock())) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'Elegí un mes válido AAAA-MM que no sea futuro en Argentina.');
    }
    return value;
  }

  private employeeId(value: string): string {
    if (!value || [...value].length > 100 || value.trim() !== value || /\p{Cc}/u.test(value) || ['.', '..'].includes(value)) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'El empleado no cumple el identificador admitido por el POST de Car Cruds.');
    }
    return value;
  }

  private entero(value: unknown, minimo: number, maximo: number): void {
    if (!Number.isSafeInteger(value) || (value as number) < minimo || (value as number) > maximo) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'Se requieren las revisiones enteras del vínculo y de la fotografía consultados.');
    }
  }

  private booleanoOpcional(value: unknown): void {
    if (value !== undefined && typeof value !== 'boolean') throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La confirmación debe ser un valor booleano.');
  }
}
