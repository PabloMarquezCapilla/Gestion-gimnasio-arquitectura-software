import { buildTiendaApp } from './app';
import { Pool } from 'pg';
import { PostgresTiendaStockRepository } from './stock.postgres';

async function start() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un entero entre 1 y 65535.');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Configurar DATABASE_URL de la base propia de Tienda.');
  if (!(process.env.FAV_API_KEY ?? '').trim()) throw new Error('Configurar FAV_API_KEY para la capacidad compartida.');
  const pool = new Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 3000, statement_timeout: 5000, lock_timeout: 3000 });
  const repository = new PostgresTiendaStockRepository(pool);
  let app: ReturnType<typeof buildTiendaApp>;
  try {
    app = buildTiendaApp({ stockRepository: repository, logger: { base: { service: 'tienda' },
      redact: ['req.headers.authorization', 'req.headers.x-api-key', 'req.headers.idempotency-key'] } });
    await repository.inicializarEsquema();
  } catch {
    await pool.end();
    throw new Error('No se pudo iniciar Tienda; revisar autenticación, conexión PostgreSQL y permisos sin borrar datos.');
  }
  pool.on('error', () => { app.log.warn({ codigo: 'PERSISTENCIA_FALLIDA' }, 'Conexión inactiva de PostgreSQL interrumpida'); });
  app.addHook('onClose', async () => { await pool.end(); });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
  }
  try { await app.listen({ port, host: '0.0.0.0' }); }
  catch (error) { await app.close(); throw error; }
}
void start().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar Tienda.');
  process.exitCode = 1;
});
