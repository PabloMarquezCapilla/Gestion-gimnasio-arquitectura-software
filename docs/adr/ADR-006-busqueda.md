# D6 - Búsqueda

**Estado:** decisión de PostgreSQL FTS conservada; catálogo filtrado operativo, búsqueda textual pendiente de conectar a la API.
**Fecha original:** 12/10/2026. **Revisión factual:** 19/10/2026.
**Enunciado:** §5, D6, página 7; §6.3, página 8; requisito general §2.6, página 2.

## Contexto y decisión

Clases y Reservas es propietario del catálogo. Se mantiene PostgreSQL Full-Text Search (FTS) con GIN para buscar texto en nombre, actividad y profesor, evitando operar un segundo motor y sincronizar otra copia del catálogo. Un motor dedicado sigue siendo una alternativa si las mediciones justifican su complejidad. No se afirma una cantidad de usuarios o clases que el equipo no haya confirmado.

## Implementado y verificado

- `PostgresClaseRepository.inicializarEsquema` crea `documento_busqueda`, columna `tsvector` generada con diccionario español y pesos A/B/C para nombre/actividad/profesor, e índice GIN `idx_clases_fts`.
- El índice B-Tree real es `idx_clases_consulta (publicada, sede_id, inicio)`.
- `listarClases` consulta clases publicadas, filtra por sede y rango de inicio `[desde, hasta)`, pagina con offset (20 por defecto, máximo 100) y ordena por `inicio, clase_id`. El desempate es estable para un conjunto sin modificaciones; no garantiza una instantánea entre páginas ante escrituras concurrentes.
- Vector e índices se actualizan en la misma transacción que los campos de la clase: no hay sincronización por eventos ni demora adicional de indexación. Esto no equivale a latencia de consulta cero.

## Pendiente para completar búsqueda de texto

La consulta HTTP todavía no acepta texto ni utiliza `@@ plainto_tsquery`. Tener GIN creado no acredita búsqueda textual operativa. Falta conectar el filtro, validar consultas y probar coincidencias, paginación y actualización del índice. No se agregan ahora filtros de intensidad, similitud o cupo que no estén implementados/acordados.

Para mantenimiento se prevé `REINDEX INDEX CONCURRENTLY idx_clases_fts`, fuera de una transacción explícita; deberá ensayarse antes de una operación real. Las altas/publicación administrativa de clases tampoco están implementadas como flujo completo.

## Consecuencias

Se reutiliza la base propietaria y se evita una copia eventual del catálogo. Los cupos se calculan sobre reservas transaccionales; incluso una lectura reciente no garantiza que el cupo continúe libre al reservar.

El catálogo filtrado y el índice preparado no completan todavía la búsqueda textual requerida por §2.6. La decisión se conserva; faltan conectar y verificar esas consultas.
