# D11 - Observabilidad

**Estado:** primera versión implementada para E2: logs JSON, correlación W3C, métricas básicas y primera traza HTTP verificada. Tableros y alertas pendientes.
**Fecha original:** 12/10/2026. **Revisión factual:** 19/10/2026.
**Enunciado:** §6.3, página 8, exige logs correlacionados y primera traza; §5, D11, página 7, pide estrategia, objetivos y alertas.

## Logs y traza implementados

- Socios y Clases usan Pino/Fastify. Los logs de negocio agregan `service`, `trace_id`, `span_id` y `parent_span_id`, además de tiempo, nivel y mensaje. Los logs automáticos de Fastify incluyen `reqId`; no se afirma que todos los logs de todos los procesos tengan contexto distribuido.
- Se recibe `traceparent`, se crea un span servidor por solicitud y se devuelve `traceparent`/`X-Correlation-ID`. Clases propaga su span registrado; cada evaluación de Socios crea un span hijo. No se simula un span cliente sin registro.
- No se registran contraseñas, JWT ni claves técnicas como evidencia. La traza de prueba usa únicamente identidades ficticias.
- NGINX registra JSON con correlación, estado y `upstream_addr`, `upstream_status`, `upstream_response_time`. `X-Instance-ID` permite identificar la réplica de Clases. Esto no convierte NGINX en un servidor de trazas.

### Evidencia reproducible

`npm run test:postgres` levanta PostgreSQL efímero y aplicaciones con puertos HTTP distintos. Envía una reserva con `traceparent` y exige logs correlacionados de Clases y de las dos comprobaciones de Socios (ahora/fecha de clase), relaciones padre/hijo y reserva persistida consultable por la otra instancia.

Ejecución del 19/10/2026 (Argentina): trace ID `c7cab1c968ccd7baa1d58a49564f5e12`; span Clases `f25307e916fabadd`, hijos Socios `99bf85315e5c82ff` y `a7fe699d2555a287`. La salida del ensayo imprime identificadores nuevos en cada ejecución.

`scripts/demostrar-traza-distribuida.mjs` conserva una explicación con memoria e `inject`; es complementaria, no la evidencia de red/almacenamiento real. `npm run test:balanceo` verifica logs de proxy, distribución y recuperación; límites en D12.

## Métricas y estrategia pendiente

Socios y Clases exponen `/metrics` en formato compatible con Prometheus: `http_requests_total`, `http_errors_total`, `process_uptime_seconds` y `pg_pool_active_connections`. Son contadores por proceso que se reinician con él. Las conexiones ocupadas provienen de `totalCount - idleCount` del pool; se corrigió el valor fijo que publicaba Clases.

No existen todavía histogramas de duración, métricas de caché/cola/event loop, recolector Prometheus, Grafana, alertas ni exportador OpenTelemetry. Un identificador W3C permite correlacionar logs, pero enviar spans completos a un backend requiere instrumentación/exportación adicional.

Se conserva como diseño el tablero RED (tasa, errores, duración) y USE (utilización, saturación, errores). Objetivos iniciales propuestos: disponibilidad mensual 99,5%, 95% de reservas bajo 500 ms y 99% de lecturas de clases bajo 150 ms. No están acreditados por una prueba local breve ni confirmados como compromiso del negocio.

Criterios propuestos: alertar ante >1% de 5xx durante 5 min, p99 de reservas >1500 ms durante 3 min, o conexiones ocupadas >85% del máximo por 2 min. Falta implementar ventanas, clasificación de errores, canal y tablero antes de habilitar alertas. Deben contemplar los 504 transitorios observados en D12.

## Consecuencias y rectificación

Ya se puede seguir una reserva real entre servicios sin incorporar una plataforma de monitoreo completa para este hito. La revisión conserva la estrategia y corrige afirmaciones anteriores de histogramas/tableros/exportación ya disponibles. No se presentan esos componentes como parte terminada de E2.
