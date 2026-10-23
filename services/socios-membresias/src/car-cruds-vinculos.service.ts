import { CarCrudsService } from './car-cruds.service';
import type { CarCrudsVinculosRepository, VinculoCarCruds } from './car-cruds-vinculos.repository';
import { SociosError } from './errors';
import { socioPublico } from './services';
import type { Identidad } from './types';
import type { TraceContext } from './tracing';

export class CarCrudsVinculosService {
  constructor(
    private readonly repository: CarCrudsVinculosRepository,
    private readonly carCruds: CarCrudsService,
    private readonly clock: () => Date,
  ) {}

  listar(identidad: Identidad, query: unknown) {
    this.administrador(identidad);
    const valores = this.objeto(query, ['page', 'pageSize']);
    const page = this.pagina(valores.page, 1, Number.MAX_SAFE_INTEGER);
    const pageSize = this.pagina(valores.pageSize, 20, 100);
    return this.repository.listarVinculosCarCruds(page, pageSize);
  }

  consultar(identidad: Identidad, employeeId: string, query: unknown) {
    this.administrador(identidad);
    this.objeto(query, []);
    return this.repository.obtenerVinculoCarCruds(this.employeeId(employeeId));
  }

  async historial(identidad: Identidad, employeeId: string, query: unknown) {
    this.administrador(identidad);
    this.objeto(query, []);
    return { items: await this.repository.getHistorialVinculoCarCruds(this.employeeId(employeeId)) };
  }

  async buscarSocios(identidad: Identidad, value: unknown, query: unknown) {
    this.administrador(identidad);
    this.objeto(query, []);
    const body = this.objeto(value, ['identificador']);
    if (typeof body.identificador !== 'string' || !body.identificador.trim() || body.identificador.trim().length > 100) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'Ingresá el DNI o email completo del socio.');
    }
    const socios = await this.repository.buscarSociosParaVincular(body.identificador.trim());
    return { items: socios.map(socioPublico) };
  }

  async cambiar(
    identidad: Identidad, employeeId: string, value: unknown, query: unknown, contexto?: TraceContext,
  ): Promise<VinculoCarCruds> {
    this.administrador(identidad);
    this.objeto(query, []);
    const id = this.employeeId(employeeId);
    const body = this.objeto(value, ['socioId', 'versionEsperada']);
    if (!Object.hasOwn(body, 'socioId')
      || !(body.socioId === null || typeof body.socioId === 'string'
        && body.socioId.length >= 1 && body.socioId.length <= 50 && body.socioId.trim() === body.socioId)
      || !Number.isSafeInteger(body.versionEsperada) || (body.versionEsperada as number) < 0
      || (body.versionEsperada as number) >= 2147483647) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'Se requieren socioId válido o null y la versión del vínculo consultado.');
    }
    if (body.socioId !== null) {
      // Verificar identidad remota antes de la transacción. El estado laboral es
      // informativo: no habilita ni cancela una membresía y no bloquea históricos.
      await this.carCruds.consultarEstado(id, {}, contexto);
    }
    return this.repository.cambiarVinculoCarCruds({
      employeeId: id, socioId: body.socioId as string | null,
      versionEsperada: body.versionEsperada as number,
      administradorId: identidad.socioId, fecha: this.clock().toISOString(),
    });
  }

  private administrador(identidad: Identidad) {
    if (identidad.rol !== 'ADMIN') {
      throw new SociosError(403, 'ACCESO_DENEGADO', 'Esta operación requiere permisos de administrador.');
    }
  }

  private objeto(value: unknown, permitidos: string[]): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some((key) => !permitidos.includes(key))) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La solicitud contiene campos o parámetros no admitidos.');
    }
    return value as Record<string, unknown>;
  }

  private employeeId(value: string): string {
    try {
      if (typeof value !== 'string' || !value || ['.', '..'].includes(value)) throw new Error();
      encodeURIComponent(value);
    } catch {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'Se requiere un identificador de empleado válido.');
    }
    return value;
  }

  private pagina(value: unknown, predeterminado: number, maximo: number): number {
    if (value === undefined) return predeterminado;
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)
      || !Number.isSafeInteger(Number(value)) || Number(value) > maximo) {
      throw new SociosError(400, 'PARAMETROS_INVALIDOS', 'La paginación requiere enteros positivos dentro del rango permitido.');
    }
    return Number(value);
  }
}
