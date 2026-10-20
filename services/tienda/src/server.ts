import { buildTiendaApp } from './app';

async function start() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe ser un entero entre 1 y 65535.');
  const app = buildTiendaApp({ logger: { base: { service: 'tienda' }, redact: ['req.headers.authorization'] } });
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
