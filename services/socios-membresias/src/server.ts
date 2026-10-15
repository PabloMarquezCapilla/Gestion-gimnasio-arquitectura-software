import { Pool } from 'pg';
import { buildSociosApp } from './app';
import { PostgresSociosRepository, MemorySociosRepository } from './repository';

async function start() {
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
      const pgRepo = new PostgresSociosRepository(pool);
      await pgRepo.inicializarEsquema();
      console.log('[socios-membresias] Conectado a PostgreSQL y esquema inicializado.');
      repository = pgRepo;
    } catch (err) {
      if (process.env.NODE_ENV === 'production' || !process.env.ALLOW_MEMORY_FALLBACK) {
        throw new Error(
          `[socios-membresias] Error fatal al conectar con PostgreSQL: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
      console.warn('[socios-membresias] No se pudo conectar a PostgreSQL, iniciando en memoria para desarrollo:', err);
      repository = new MemorySociosRepository();
    }
  } else {
    console.log('[socios-membresias] Iniciando con repositorio en memoria.');
    repository = new MemorySociosRepository();
  }

  const app = buildSociosApp({ repository, logger: true });

  const port = Number(process.env.PORT ?? 3000);
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
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar Socios y Membresias.');
  process.exitCode = 1;
});
