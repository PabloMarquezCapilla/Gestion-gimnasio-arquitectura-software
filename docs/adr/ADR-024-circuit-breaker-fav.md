# Circuit breaker y caché degradada hacia FAV

**Estado:** aceptada e implementada; verificada con tests unitarios y de aplicación.
**Fecha:** 09/11/2026.
**Complementa:** [ADR-010, D10](ADR-010-resiliencia.md), que dejaba el circuit breaker como propuesta sin implementar, y [ADR-009, D9](ADR-009-consumo-del-proveedor.md).

## Contexto

El catálogo de Tienda depende de FAV, un sistema que el gimnasio no controla. Sin protección, cada solicitud del portal esperaría el timeout completo cuando FAV está caído o lento, ocupando conexiones y empeorando la latencia para todos.

## Decisión

Las capas de protección, de la más cercana a FAV a la más lejana:

1. **Cliente** (`services/tienda/src/clients/fav-catalogo.client.ts`):
   - presupuesto total de 3000 ms (`FAV_CATALOGO_TIMEOUT_MS`);
   - un único reintento con jitter de 75–124 ms, solo ante 429/5xx o error de red;
   - respuesta validada con Ajv contra el contrato fijado 1.1.0, con un tope de 4 MiB.
2. **Circuit breaker** (`services/tienda/src/circuit-breaker.ts`, sin dependencias nuevas):
   - tras 3 fallos consecutivos de disponibilidad pasa a ABIERTO y rechaza sin llamar a FAV durante 30 s;
   - luego admite una sola prueba (SEMIABIERTO): si sale bien cierra, si falla reabre;
   - `FAV_CREDENCIAL_RECHAZADA` y `FAV_RESPUESTA_INVALIDA` no cuentan como indisponibilidad: reintentar no las resuelve.
3. **Caché en memoria** (`services/tienda/src/catalogo.ts`):
   - TTL de 60 s y uso degradado hasta 15 min;
   - las solicitudes simultáneas comparten una sola consulta a FAV.
   - Es por instancia; con dos réplicas puede haber hasta dos consultas por minuto. Es aceptable para un catálogo de cientos de productos.

## Observabilidad

`/metrics` de Tienda expone:
- `tienda_fav_circuito_estado{estado}` (gauge);
- `tienda_fav_consultas_total`, `tienda_fav_fallos_total` y `tienda_fav_rechazos_circuito_total`;
- `tienda_catalogo_respuestas_total{origen="cache_fresca|cache_degradada"}`.

Cada cambio de estado del circuito queda en un log `warn` con `codigo: CIRCUITO_FAV`. `/health` informa `circuitoFav` sin volverse no saludable.

## Demostración de la caída

`npm run mock:fav` levanta el mock local. `POST /__mock/modo` admite `{"modo":"caido"|"lento"|"invalido"|"normal"}`. La secuencia esperada:

1. Catálogo normal.
2. FAV caído: catálogo desde la caché degradada.
3. Tras 3 fallos el circuito queda ABIERTO y no hay más llamadas a FAV.
4. Sin copia válida: 503 `PROVEEDOR_NO_DISPONIBLE`.
5. FAV vuelve: la prueba SEMIABIERTO cierra el circuito.

## Consecuencias

- El estado del circuito es por instancia, no compartido.
- Umbral y espera son constantes de código; alcanzan para la escala actual.
