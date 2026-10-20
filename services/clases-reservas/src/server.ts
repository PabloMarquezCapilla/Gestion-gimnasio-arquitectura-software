import { Pool } from 'pg';
import { buildApp } from './app';
import { PostgresClaseRepository, MemoryClaseRepository } from './repository';
import { HttpSociosClient, MockSociosClient } from './clients/socios.client';

async function start() {
  const apiKey = process.env.CAPACIDAD_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Definí CAPACIDAD_API_KEY antes de iniciar el servicio.');
  }

  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  if ((process.env.AUTH_JWT_SECRET ?? '').length < 32 || !process.env.SERVICIOS_API_KEY?.trim()) {
    throw new Error('Configurar AUTH_JWT_SECRET de al menos 32 caracteres y SERVICIOS_API_KEY.');
  }
  const retryMs = Number(process.env.RESERVAS_REINTENTO_MS ?? 5000);
  if (!Number.isInteger(retryMs) || retryMs < 100) throw new Error('RESERVAS_REINTENTO_MS debe ser al menos 100.');

  const databaseUrl = process.env.DATABASE_URL;
  const sociosUrl = process.env.SOCIOS_SERVICE_URL;
  const usarMemoria = ['1', 'true'].includes(process.env.USE_MEMORY_DB ?? '');
  const permitirFallback = ['1', 'true'].includes(process.env.ALLOW_MEMORY_FALLBACK ?? '');
  if (process.env.NODE_ENV === 'production' && (!databaseUrl || !sociosUrl || usarMemoria)) {
    throw new Error('Producción requiere DATABASE_URL y SOCIOS_SERVICE_URL; no admite memoria ni Socios simulado.');
  }
  let repository;
  let closeRepository: (() => Promise<void>) | undefined;

  if (databaseUrl && !usarMemoria) {
    try {
      const pool = new Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5000,
        statement_timeout: 4000,
        lock_timeout: 2500,
        max: 20,
      });
      closeRepository = () => pool.end();
      const pgRepo = new PostgresClaseRepository(pool);
      await pgRepo.inicializarEsquema();
      console.log('[clases-reservas] Conectado a PostgreSQL y esquema inicializado.');
      repository = pgRepo;
    } catch (err) {
      await closeRepository?.();
      closeRepository = undefined;
      if (process.env.NODE_ENV === 'production' || !permitirFallback) {
        throw new Error(
          `[clases-reservas] Error fatal al conectar con PostgreSQL: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      console.warn('[clases-reservas] No se pudo conectar a PostgreSQL, iniciando en memoria para desarrollo:', err);
      repository = new MemoryClaseRepository(undefined, true);
    }
  } else {
    console.log('[clases-reservas] Iniciando con repositorio en memoria.');
    repository = new MemoryClaseRepository();
  }

  const sociosClient = sociosUrl
    ? new HttpSociosClient(sociosUrl, 3000, process.env.SERVICIOS_API_KEY)
    : new MockSociosClient();

  const app = buildApp({
    apiKey,
    logger: true,
    repository,
    sociosClient,
  });

  let active: Promise<unknown> | undefined;
  const processPending = () => {
    if (active) return;
    active = app.reservasService.procesarPendientes()
      .catch(() => { app.log.error('No se pudo completar la recuperación de promociones.'); })
      .finally(() => { active = undefined; });
  };
  const worker = setInterval(processPending, retryMs);
  worker.unref();
  app.addHook('onClose', async () => {
    clearInterval(worker);
    await active;
    await closeRepository?.();
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => {
        process.exitCode = 1;
      });
    });
  }

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (error) {
    await app.close();
    throw error;
  }
  processPending();
}

void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar Clases y Reservas.');
  process.exitCode = 1;
});
