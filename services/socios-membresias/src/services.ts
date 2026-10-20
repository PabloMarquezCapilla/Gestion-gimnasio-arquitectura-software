import { randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { SociosError } from './errors';
import { ISociosRepository } from './repository';
import { hashPassword, verifyPassword } from './security';
import {
  Identidad, JwtIdentidad, LoginDTO, Membresia, RegistroDTO,
  ResultadoHabilitacion, Socio, SocioPublico,
} from './types';

const ajv = new Ajv();
addFormats(ajv, { mode: 'full' });
const validarRegistro = ajv.compile<RegistroDTO>({
  type: 'object',
  additionalProperties: false,
  required: ['dni', 'nombre', 'email', 'password'],
  properties: {
    dni: { type: 'string', minLength: 1, maxLength: 20 },
    nombre: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email', maxLength: 100 },
    password: { type: 'string', minLength: 6, maxLength: 200 },
    telefono: { type: 'string', maxLength: 50 },
  },
});
const validarLogin = ajv.compile<LoginDTO>({
  type: 'object',
  additionalProperties: false,
  required: ['emailOrDni', 'password'],
  properties: {
    emailOrDni: { type: 'string', minLength: 1, maxLength: 100 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
});
const validarFecha = ajv.compile<string>({ type: 'string', format: 'date-time' });

export function resolverFechaReferencia(value: unknown, clock: () => Date): Date {
  if (value === undefined) return clock();
  if (!validarFecha(value) || !Number.isFinite(Date.parse(value))) {
    throw new SociosError(400, 'FECHA_INVALIDA', 'El parámetro fecha debe ser una fecha válida RFC 3339 con zona horaria.');
  }
  return new Date(value);
}

function normalizarRegistro(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, field]) => [
    key,
    typeof field === 'string' && key !== 'password'
      ? key === 'email' ? field.trim().toLowerCase() : field.trim()
      : field,
  ]));
}

export function datosRegistro(value: unknown): RegistroDTO {
  const body = normalizarRegistro(value);
  if (!validarRegistro(body)) {
    throw new SociosError(400, 'DATOS_INVALIDOS', 'Se requieren DNI, nombre, email y contraseña válidos; no se admiten campos adicionales.');
  }
  return body;
}

export function socioPublico(socio: Socio): SocioPublico {
  // Lista explícita: nunca devolver hashes ni atributos arbitrarios de persistencia.
  return {
    socioId: socio.socioId,
    dni: socio.dni,
    nombre: socio.nombre,
    email: socio.email,
    rol: socio.rol === 'ADMIN' ? 'ADMIN' : 'SOCIO',
    ...(socio.telefono === undefined ? {} : { telefono: socio.telefono }),
    estado: socio.estado,
    createdAt: socio.createdAt,
  };
}

function periodoValido(membresia: Membresia): boolean {
  const inicio = Date.parse(membresia.fechaInicio);
  const fin = Date.parse(membresia.fechaFin);
  return Number.isFinite(inicio) && Number.isFinite(fin) && inicio <= fin;
}

export function seleccionarMembresia(membresias: readonly Membresia[], fecha: Date): Membresia | null {
  const instante = fecha.getTime();
  if (!Number.isFinite(instante)) throw new SociosError(400, 'FECHA_INVALIDA', 'La fecha de referencia no es válida.');
  const validas = membresias.filter(periodoValido);
  const cubren = validas.filter((m) => Date.parse(m.fechaInicio) <= instante && instante <= Date.parse(m.fechaFin));
  // Una renovación que aún no comenzó no sustituye la cobertura aplicable.
  const candidatas = cubren.length ? cubren : validas;
  return [...candidatas].sort((a, b) => {
    return Date.parse(b.fechaInicio) - Date.parse(a.fechaInicio)
      || b.createdAt.localeCompare(a.createdAt) || a.membresiaId.localeCompare(b.membresiaId);
  })[0] ?? null;
}

export class SociosService {
  constructor(private repository: ISociosRepository, private clock: () => Date) {}

  exigirAdministrador(identidad: Identidad): void {
    if (identidad.rol !== 'ADMIN') {
      throw new SociosError(403, 'ACCESO_DENEGADO', 'Esta operación requiere permisos de administrador.');
    }
  }

  exigirPropietario(identidad: Identidad, socioId: string): void {
    if (identidad.rol !== 'ADMIN' && identidad.socioId !== socioId) {
      throw new SociosError(403, 'ACCESO_DENEGADO', 'Solo puede consultar sus propios datos.');
    }
  }

  async consultarSocio(socioId: string) {
    const socio = await this.repository.obtenerSocio(socioId);
    if (!socio) throw new SociosError(404, 'SOCIO_NO_ENCONTRADO', 'No se encontró el socio solicitado.');
    const membresia = seleccionarMembresia(await this.repository.obtenerMembresias(socioId), this.clock());
    return { ...socioPublico(socio), membresia };
  }

  async crearSocio(identidad: Identidad, value: unknown) {
    this.exigirAdministrador(identidad);
    const body = datosRegistro(value);
    if (await this.repository.buscarPorEmailODni(body.email)) {
      throw new SociosError(409, 'EMAIL_EN_USO', 'El correo electrónico ya se encuentra registrado.');
    }
    if (await this.repository.buscarPorEmailODni(body.dni)) {
      throw new SociosError(409, 'DNI_EN_USO', 'El número de DNI ya se encuentra registrado.');
    }
    const socio = await this.repository.crearSocio({
      socioId: 'socio-' + randomUUID(),
      dni: body.dni,
      nombre: body.nombre,
      email: body.email,
      passwordHash: hashPassword(body.password),
      rol: 'SOCIO',
      telefono: body.telefono,
      estado: 'ACTIVO',
      createdAt: this.clock().toISOString(),
    });
    return { socio: socioPublico(socio), membresia: null };
  }

  async solicitarMembresia(identidad: Identidad, socioId: string): Promise<never> {
    this.exigirAdministrador(identidad);
    if (!await this.repository.obtenerSocio(socioId)) {
      throw new SociosError(404, 'SOCIO_NO_ENCONTRADO', 'No se encontró el socio solicitado.');
    }
    throw new SociosError(501, 'PAGOS_NO_IMPLEMENTADOS', 'La activación y renovación requieren el backend real de pagos, todavía no implementado.');
  }

  async evaluarHabilitacion(socioId: string, fechaReferencia: Date): Promise<ResultadoHabilitacion> {
    const socio = await this.repository.obtenerSocio(socioId);
    if (!socio) return { socioId, habilitado: false, motivo: 'SOCIO_NO_EXISTE' };
    if (socio.estado !== 'ACTIVO') return { socioId, habilitado: false, motivo: 'SOCIO_INACTIVO' };
    const historial = await this.repository.obtenerMembresias(socioId);
    if (!historial.length) return { socioId, habilitado: false, motivo: 'SIN_MEMBRESIA' };
    const seleccionada = seleccionarMembresia(historial, fechaReferencia);
    if (!seleccionada) return { socioId, habilitado: false, motivo: 'VIGENCIA_INVALIDA' };
    const membresia = {
      membresiaId: seleccionada.membresiaId,
      tipoPlan: seleccionada.tipoPlan,
      estado: seleccionada.estado,
      fechaInicio: seleccionada.fechaInicio,
      fechaFin: seleccionada.fechaFin,
    };
    if (seleccionada.estado === 'SUSPENDIDA') {
      return { socioId, habilitado: false, motivo: 'MEMBRESIA_SUSPENDIDA', membresia };
    }
    const instante = fechaReferencia.getTime();
    if (seleccionada.estado !== 'HABILITADA'
      || instante < Date.parse(seleccionada.fechaInicio) || instante > Date.parse(seleccionada.fechaFin)) {
      return { socioId, habilitado: false, motivo: 'MEMBRESIA_VENCIDA', membresia };
    }
    return { socioId, habilitado: true, membresia };
  }
}

export class AuthService {
  constructor(
    private repository: ISociosRepository,
    private sociosService: SociosService,
    private clock: () => Date,
  ) {}

  async iniciarSesion(value: unknown) {
    if (!validarLogin(value) || !value.emailOrDni.trim()) {
      throw new SociosError(400, 'DATOS_INVALIDOS', 'Email/DNI y contraseña son obligatorios y deben tener formato válido.');
    }
    const socio = await this.repository.buscarPorEmailODni(value.emailOrDni);
    if (!socio || !verifyPassword(value.password, socio.passwordHash)) {
      throw new SociosError(401, 'CREDENCIALES_INVALIDAS', 'Credenciales inválidas. Verifique sus datos.');
    }
    if (socio.estado !== 'ACTIVO') throw new SociosError(403, 'SOCIO_INACTIVO', 'La cuenta del socio no está activa.');
    const detalle = await this.sociosService.consultarSocio(socio.socioId);
    const { membresia, ...publico } = detalle;
    return { socio: publico, membresia };
  }

  async verificarIdentidad(claims: JwtIdentidad): Promise<Identidad> {
    if (typeof claims.sub !== 'string' || !claims.sub
      || !['ADMIN', 'SOCIO'].includes(claims.rol)
      || !Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || claims.exp <= claims.iat
      || this.clock().getTime() >= claims.exp * 1000) {
      throw new SociosError(401, 'NO_AUTENTICADO', 'El token de autenticación no es válido.');
    }
    const socio = await this.repository.obtenerSocio(claims.sub);
    if (!socio) throw new SociosError(401, 'NO_AUTENTICADO', 'La identidad del token no existe.');
    if (socio.estado !== 'ACTIVO') throw new SociosError(403, 'SOCIO_INACTIVO', 'La cuenta del socio no está activa.');
    // La autorización actual procede del propietario de la identidad, no del navegador.
    return { socioId: socio.socioId, rol: socio.rol === 'ADMIN' ? 'ADMIN' : 'SOCIO' };
  }
}
