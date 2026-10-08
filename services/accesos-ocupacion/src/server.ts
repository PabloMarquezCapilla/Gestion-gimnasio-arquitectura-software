import Fastify from 'fastify';

// Estructura inicial: no implementa todavía sedes, movimientos ni ocupación.
const app = Fastify({ logger: true, disableRequestLogging: true });
app.get('/health', async () => ({ servicio: 'accesos-ocupacion', estado: 'estructura' }));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().catch(() => { process.exitCode = 1; });
  });
}

void app.listen({ port: Number(process.env.PORT ?? 3000), host: '0.0.0.0' })
  .catch(() => {
    app.log.error('No se pudo iniciar Accesos y Ocupación.');
    process.exitCode = 1;
  });
