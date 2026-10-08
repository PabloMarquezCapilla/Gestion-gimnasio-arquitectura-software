import { buildApp } from './app';

async function start() {
  const apiKey = process.env.CAPACIDAD_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    throw new Error('Definí CAPACIDAD_API_KEY antes de iniciar el mock.');
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT debe ser un entero entre 1 y 65535.');
  }
  const app = buildApp({ apiKey, logger: true });
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
  console.error(error instanceof Error ? error.message : 'No se pudo iniciar el mock.');
  process.exitCode = 1;
});
