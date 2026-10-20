import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { Pool } from 'pg';
import { IdentidadDuplicadaError, SociosError } from './errors';
import { ISociosRepository, PostgresSociosRepository } from './repository';
import { hashPassword } from './security';
import { datosRegistro, socioPublico } from './services';
import { SocioPublico } from './types';

// Exclusivo del comando local: ninguna ruta HTTP permite elegir el rol ADMIN.
export async function crearAdministrador(
  repository: ISociosRepository,
  value: unknown,
  clock: () => Date = () => new Date(),
): Promise<SocioPublico> {
  const body = datosRegistro(value);
  if (await repository.buscarPorEmailODni(body.email) || await repository.buscarPorEmailODni(body.dni)) {
    throw new SociosError(409, 'ADMIN_YA_REGISTRADO', 'El DNI o email ya existe; no se modificó ninguna cuenta.');
  }
  try {
    const socio = await repository.crearSocio({
      socioId: 'admin-' + randomUUID(),
      dni: body.dni,
      nombre: body.nombre,
      email: body.email,
      passwordHash: hashPassword(body.password),
      rol: 'ADMIN',
      telefono: body.telefono,
      estado: 'ACTIVO',
      createdAt: clock().toISOString(),
    });
    return socioPublico(socio);
  } catch (error) {
    if (error instanceof IdentidadDuplicadaError
      || (error && typeof error === 'object' && 'code' in error && error.code === '23505')) {
      throw new SociosError(409, 'ADMIN_YA_REGISTRADO', 'El DNI o email ya existe; no se modificó ninguna cuenta.');
    }
    throw error;
  }
}

async function solicitarDatos() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Crear administrador requiere una terminal interactiva para ocultar la contraseña.');
  }
  let ocultar = false;
  const salida = new Writable({
    write(chunk, encoding, callback) {
      if (!ocultar) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const reader = createInterface({ input: process.stdin, output: salida, terminal: true });
  const controller = new AbortController();
  reader.on('SIGINT', () => controller.abort());
  async function secreto(prompt: string) {
    process.stdout.write(prompt);
    ocultar = true;
    try {
      return await reader.question('', { signal: controller.signal });
    } finally {
      ocultar = false;
      process.stdout.write('\n');
    }
  }
  try {
    const dni = await reader.question('DNI del administrador: ', { signal: controller.signal });
    const nombre = await reader.question('Nombre: ', { signal: controller.signal });
    const email = await reader.question('Email: ', { signal: controller.signal });
    const password = await secreto('Contraseña (oculta): ');
    const confirmacion = await secreto('Repetir contraseña (oculta): ');
    if (password !== confirmacion) throw new Error('Las contraseñas no coinciden; no se creó ninguna cuenta.');
    return { dni, nombre, email, password };
  } finally {
    reader.close();
  }
}

async function main() {
  if (process.argv.length > 2) {
    throw new Error('Este comando no acepta argumentos. Ingresá los datos en la terminal interactiva.');
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL es obligatoria para crear el administrador en PostgreSQL.');
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, statement_timeout: 4000, lock_timeout: 2500 });
  try {
    const datos = await solicitarDatos();
    const creado = await crearAdministrador(new PostgresSociosRepository(pool), datos);
    console.log('Administrador creado con identificador ' + creado.socioId + '.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    // No imprimir excepciones SQL o configuración que puedan incluir credenciales.
    console.error(error instanceof SociosError ? error.message
      : error instanceof Error && !('code' in error) ? error.message
        : 'No se pudo crear el administrador; no se sobrescribieron cuentas.');
    process.exitCode = 1;
  });
}
