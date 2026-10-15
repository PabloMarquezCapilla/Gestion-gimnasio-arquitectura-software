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

  const databaseUrl = process.env.DATABASE_URL;
  let repository;

  if (databaseUrl && !process.env.USE_MEMORY_DB) {
    try {
      const pool = new Pool({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 5000,
        statement_timeout: 4000,
        max: 20,
      });
      const pgRepo = new PostgresClaseRepository(pool);
      await pgRepo.inicializarEsquema();
      console.log('[clases-reservas] Conectado a PostgreSQL y esquema inicializado.');
      repository = pgRepo;
    } catch (err) {
      if (process.env.NODE_ENV === 'production' || !process.env.ALLOW_MEMORY_FALLBACK) {
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

  const sociosUrl = process.env.SOCIOS_SERVICE_URL;
  const sociosClient = sociosUrl
    ? new HttpSociosClient(sociosUrl)
    : new MockSociosClient();

  const app = buildApp({
    apiKey,
    logger: true,
    repository,
    sociosClient,
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void app.close().catch(() => {
        process.exitCode = 1;
      });
    });
  }

  await app.listen({ port, host: '0.0.0.0' });
}

void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar Clases y Reservas.');
  process.exitCode = 1;
});
