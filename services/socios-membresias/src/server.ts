import { Pool } from 'pg';
import { buildSociosApp } from './app';
import { PostgresSociosRepository, MemorySociosRepository, ISociosRepository } from './repository';
import { configuracionAuth } from './security';
import { credencialesEmpleadosDesdeEntorno } from './empleados.http';
import { carCrudsConfigDesdeEntorno, HttpCarCrudsClient } from './clients/car-cruds.client';

async function start() {
  // Validar secretos antes de inicializar el almacenamiento o abrir el puerto.
  const auth = configuracionAuth();
  const carCrudsConfig = carCrudsConfigDesdeEntorno();
  const carCrudsClient = carCrudsConfig ? new HttpCarCrudsClient(carCrudsConfig) : undefined;
  const empleadosCredenciales = credencialesEmpleadosDesdeEntorno();
  if (!empleadosCredenciales.length) throw new Error('Configurar EMPLEADOS_API_KEY y EMPLEADOS_ORIGEN_ID para la capacidad externa.');
  const databaseUrl = process.env.DATABASE_URL;
  const usarMemoria = process.env.USE_MEMORY_DB === 'true';
  if (usarMemoria && process.env.NODE_ENV === 'production') {
    throw new Error('USE_MEMORY_DB no está permitido en producción.');
  }
  if (!usarMemoria && !databaseUrl) {
    throw new Error('DATABASE_URL es obligatoria; no se inicia un almacenamiento en memoria implícito.');
  }
  let repository: ISociosRepository;
  let pool: Pool | undefined;
  if (usarMemoria) {
    repository = new MemorySociosRepository();
    console.log('[socios-membresias] Memoria habilitada explícitamente para desarrollo.');
  } else {
    pool = new Pool({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
      statement_timeout: 4000,
      lock_timeout: 2500,
      max: 20,
    });
    try {
      repository = new PostgresSociosRepository(pool);
      await repository.inicializarEsquema();
    } catch {
      await pool.end();
      throw new Error('No se pudo inicializar PostgreSQL; no se modifican ni reparan duplicados automáticamente.');
    }
    console.log('[socios-membresias] Conectado a PostgreSQL y esquema inicializado.');
  }

  const app = buildSociosApp({
    repository,
    ...auth,
    empleadosCredenciales,
    carCrudsClient,
    logger: { redact: ['req.headers.authorization', 'req.headers.x-service-key', 'req.headers.x-api-key', 'req.headers.idempotency-key'] },
  });
  if (pool) {
    const activePool = pool;
    app.addHook('onClose', async () => { await activePool.end(); });
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    await app.close();
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => { process.exitCode = 1; });
    });
  }
  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    await app.close();
    throw error;
  }
}

void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar Socios y Membresías.');
  process.exitCode = 1;
});
