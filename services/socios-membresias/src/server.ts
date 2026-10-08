import Fastify from 'fastify';

// Estructura inicial: no implementa todavía socios, pagos ni membresías.
const app = Fastify({ logger: true, disableRequestLogging: true });
app.get('/health', async () => ({ servicio: 'socios-membresias', estado: 'estructura' }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => { process.exitCode = 1; });
  });
}

void app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
  .catch(() => {
    app.log.error('No se pudo iniciar Socios y Membresías.');
    process.exitCode = 1;
  });
