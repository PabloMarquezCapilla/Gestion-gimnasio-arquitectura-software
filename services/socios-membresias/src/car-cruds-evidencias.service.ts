import type { CarCrudsClient, FotografiaCarCruds } from './car-cruds.service';
import type { CarCrudsEvidenciasRepository, ContratoConfirmado, FuenteFotografia, RegistroFotografia } from './car-cruds-evidencias.repository';
import type { VinculoCarCruds } from './car-cruds-vinculos.repository';
import type { AccesosUsoClient } from './clients/accesos.client';
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

// Mes calendario en America/Argentina/Buenos_Aires (UTC-3 fijo, sin horario de verano).
export function limitesMes(period: string): { desde: Date; hasta: Date } {
  const [anio, mes] = period.split('-').map(Number);
  return { desde: new Date(Date.UTC(anio, mes - 1, 1, 3)), hasta: new Date(Date.UTC(anio, mes, 1, 3)) };
}

// Perfil de Car Cruds 0.3.0: pagos efectivos confirmados dentro del mes hasta el corte.
// Una moneda distinta de ARS no se suma ni se convierte: el importe queda desconocido.
export function gastoDelMes(contratos: ContratoConfirmado[] | undefined, desde: Date, hasta: Date, corte: Date): number | null {
  if (!contratos) return null;
  const fin = Math.min(hasta.getTime(), corte.getTime() + 1);
  const delMes = contratos.filter(c => Date.parse(c.confirmadoEn) >= desde.getTime() && Date.parse(c.confirmadoEn) < fin);
  if (delMes.some(c => c.moneda !== 'ARS')) return null;
  const total = delMes.reduce((suma, c) => suma + c.importeMinor, 0);
  return Number.isSafeInteger(total) ? total : null;
}

// Perfil de Car Cruds 0.3.0: costo neto por mes completo = importe / meses contratados.
// Solo si un único plan confirmado cubre el mes entero; un mes parcial o ambiguo queda null.
export function costoMensual(contratos: ContratoConfirmado[] | undefined, desde: Date, hasta: Date, corte: Date): number | null {
  if (!contratos) return null;
  const delMes = contratos.filter(c => Date.parse(c.confirmadoEn) <= corte.getTime()
    && Date.parse(c.fechaInicio) < hasta.getTime() && Date.parse(c.fechaFin) >= desde.getTime());
  if (delMes.length !== 1) return null;
  const contrato = delMes[0], meses = contrato.mesesContratados;
  // El portal anterior guardaba el fin inclusivo con precisión de segundos.
  if (contrato.moneda !== 'ARS' || Date.parse(contrato.fechaInicio) > desde.getTime()
    || Date.parse(contrato.fechaFin) < hasta.getTime() - 1000
    || typeof meses !== 'number' || !Number.isInteger(meses) || meses < 1 || meses > 36) return null;
  const costo = contrato.importeMinor / meses;
  return Number.isSafeInteger(costo) && costo >= 0 ? costo : null;
}

export interface DependenciasEvidencias {
  accesos?: AccesosUsoClient;
  obtenerVinculo?: (employeeId: string) => Promise<VinculoCarCruds>;
}

export class CarCrudsEvidenciasService {
  constructor(
    private readonly repository: CarCrudsEvidenciasRepository,
    private readonly client: CarCrudsClient | undefined,
    private readonly clock: () => Date,
    private readonly dependencias: DependenciasEvidencias = {},
  ) {}

  // El uso vive en Accesos: se consulta antes de la transacción local y solo se
  // aplica si el vínculo no cambió entretanto. Sin respuesta, used=null.
  private async usoDelMes(employeeId: string, period: string, fecha: string, contexto?: TraceContext) {
    const { accesos, obtenerVinculo } = this.dependencias;
    if (!accesos || !obtenerVinculo) return undefined;
    const vinculo = await obtenerVinculo(employeeId);
    if (!vinculo.socioId) return undefined;
    const { desde, hasta } = limitesMes(period);
    const corte = new Date(Math.min(hasta.getTime(), Date.parse(fecha) + 1));
    if (corte <= desde) return undefined;
    const used = await accesos.huboIngreso(vinculo.socioId, desde, corte, contexto);
    return used === undefined ? undefined : { socioId: vinculo.socioId, used };
  }

  async consultar(identidad: Identidad, employeeId: string, query: unknown) {
    this.administrador(identidad);
    const valores = this.objeto(query, ['period']);
    const period = this.periodo(valores.period);
    return { items: await this.repository.obtenerFotografias(this.employeeId(employeeId), period) };
  }

  async preparar(identidad: Identidad, employeeId: string, value: unknown, query: unknown, contexto?: TraceContext): Promise<RegistroFotografia> {
    this.administrador(identidad);
    this.objeto(query, []);
    const body = this.objeto(value, ['period', 'versionVinculoEsperada', 'versionAnteriorEsperada', 'confirmarCambioVinculo']);
    const period = this.periodo(body.period);
    this.entero(body.versionVinculoEsperada, 1, 2147483647);
    this.entero(body.versionAnteriorEsperada, 0, Number.MAX_SAFE_INTEGER - 1);
    this.booleanoOpcional(body.confirmarCambioVinculo);
    const id = this.employeeId(employeeId);
    const fecha = this.clock().toISOString();
    const uso = await this.usoDelMes(id, period, fecha, contexto);
    return this.repository.prepararFotografia({
      employeeId: id, period, fecha, administradorId: identidad.socioId,
      versionVinculoEsperada: body.versionVinculoEsperada as number,
      versionAnteriorEsperada: body.versionAnteriorEsperada as number,
      confirmarCambioVinculo: body.confirmarCambioVinculo === true,
      generar: (fuente, sourceReference, version) => this.generar(fuente, id, period, fecha, sourceReference, version,
        uso && uso.socioId === fuente.socio?.socioId ? uso.used : null),
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
    used: boolean | null = null,
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
    const { desde, hasta } = limitesMes(period);
    const corte = new Date(observedAt);
    const costMinor = costoMensual(fuente.contratos, desde, hasta, corte);
    const spendingMinor = gastoDelMes(fuente.contratos, desde, hasta, corte);
    return {
      employeeId, period, sourceReference, version, observedAt,
      member: fuente.miembroObservadoEnPeriodo === true || period === mesArgentina(new Date(observedAt)) && vigenteAhora ? true : null,
      used, costMinor, spendingMinor,
      ...(costMinor !== null || spendingMinor !== null ? { currency: 'ARS' as const } : {}),
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
