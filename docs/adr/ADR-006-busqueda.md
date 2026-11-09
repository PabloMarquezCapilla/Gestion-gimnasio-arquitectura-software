# D6 - Búsqueda

**Estado.** PostgreSQL FTS conectado a API y portal con filtros, páginas y orden. Publicación/edición ADMIN implementadas localmente. Reconstrucción del índice y recorrido del paso 5 verificados en el entorno local.
**Fecha original.** 12/10/2026. **Revisión factual.** 08/11/2026.
**Enunciado:** §5, D6, página 7; §6.3, página 8; requisito general §2.6, página 2.

## Contexto y decisión

Clases y Reservas es propietario del catálogo. Se mantiene PostgreSQL Full-Text Search (FTS) con GIN para buscar texto en nombre, actividad y profesor, evitando operar un segundo motor y sincronizar otra copia del catálogo. Un motor dedicado sigue siendo una alternativa si las mediciones justifican su complejidad. No se afirma una cantidad de usuarios o clases que el equipo no haya confirmado.

## Implementado y verificado

- `PostgresClaseRepository.inicializarEsquema` crea `documento_busqueda`, columna `tsvector` generada con diccionario español y pesos A/B/C para nombre/actividad/profesor, e índice GIN `idx_clases_fts`.
- El índice B-Tree real es `idx_clases_consulta (publicada, sede_id, inicio)`.
- `listarClases` consulta clases publicadas, filtra por sede y rango de inicio `[desde, hasta)`, pagina con offset (20 por defecto, máximo 100) y ordena por `inicio, clase_id`. El desempate es estable para un conjunto sin modificaciones; no garantiza una instantánea entre páginas ante escrituras concurrentes.
- Vector e índices se actualizan en la misma transacción que los campos de la clase: no hay sincronización por eventos ni demora adicional de indexación. Esto no equivale a latencia de consulta cero.

## API interna de búsqueda

`GET /api/v1/catalogo/clases` requiere JWT SOCIO/ADMIN y consulta clases publicadas con inicio posterior a `consultadoEn`, siguiendo el recorrido de futuras que ya utiliza el portal. Combina texto, sede, profesor completo y rango de inicio `[desde,hasta)`. El equipo confirmó también el filtro de cupo directo, que exige capacidad libre y ausencia de espera pendiente. La lectura conserva el estado de la cola y la reserva vuelve a evaluar membresía, duplicados y capacidad. [OpenAPI interno 1.2.0](../contracts/openapi-catalogo-v1.yaml).

La consulta usa `@@ plainto_tsquery('spanish', texto)` y relevancia con `ts_rank_cd`, manteniendo pesos A/B/C. Se buscan palabras normalizadas por el diccionario español, combinadas con AND tras retirar stop words. Relevancia exige texto. Los otros órdenes son inicio ascendente o descendente, con desempates estables por ID. Un texto compuesto sólo por stop words devuelve cero coincidencias. [Documentación de FTS](https://www.postgresql.org/docs/17/textsearch-controls.html).

La capa HTTP valida filtros y sesión, `application/busqueda-clases.service.ts` define el puerto y el caso de uso, y `busqueda-clases.postgres.ts` implementa la consulta. Una sentencia con CTE obtiene resultados, disponibilidad, total y página en un mismo snapshot, incluso si la página pedida queda fuera del conjunto. Las páginas consultadas en solicitudes distintas pueden observar cambios concurrentes. El tamaño es 20 por defecto, máximo 100, y el texto tiene un límite técnico de 200 caracteres. Las fechas llevan zona horaria y los parámetros repetidos/desconocidos se rechazan.

El GET histórico `/api/v1/clases` conserva su contrato y los campos anteriores. El nuevo catálogo muestra actividad/profesor como `null` cuando los registros previos carecen de esos datos. Su adaptador requiere PostgreSQL y responde 503 si falta o falla. La inicialización existente de vector/GIN se reutiliza.

## Portal y reservas propias

El portal consulta esta API mediante el gateway con el JWT del usuario. Aplica filtros explícitamente, vuelve a página 1 al buscar y navega de a 20 resultados. Las fechas locales se convierten a ISO con zona antes de enviarlas. Cada tarjeta muestra los datos reales de actividad/profesor y permite reserva directa o ingreso voluntario en espera según la respuesta del servidor.

El cliente valida estructura, paginación, fechas y disponibilidad antes de mostrar resultados. Distingue carga, resultados vacíos y errores con reintento. Al cambiar la consulta aborta la anterior y descarta respuestas tardías. Las mutaciones conservan los controles de membresía/propietario del backend y actualizan catálogo y reservas propias.

La consulta privada de reservas agrega un detalle mínimo por clase propia (`clasesPersonales`) para mostrar nombre, sede e inicio aunque la clase quede fuera de las primeras cien o de la página filtrada. Ambos repositorios implementan la lectura por IDs de esas reservas/esperas. El cliente conserva compatibilidad con respuestas anteriores que omitan ese campo. No se agrega otro almacenamiento.

## Mantenimiento y verificación

La publicación/edición usa `GestionClasesService` con puertos `GestionClasesRepository` y `SedesClient`, compuestos por `server.ts` mediante `PostgresGestionClases` y `HttpSedesClient`. La capa HTTP exige ADMIN. El servicio normaliza campos y fechas, recupera replays y consulta sedes en Accesos antes de la transacción. El portal presenta el formulario y el listado con búsqueda.

El esquema agrega `clases.version` con valor 1 para registros anteriores y `clases_operaciones` por actor/clave, sin alterar sus datos previos. La edición exige versión esperada y bloquea la fila compartida con reservas/espera. Comprueba horario original y nuevo futuros y ausencia de inscriptos activos. La mutación, el vector generado y el resultado idempotente se confirman juntos. Las repeticiones recuperan la respuesta original aun cuando haya comenzado la clase o Accesos esté caído. El panel conserva operaciones inciertas por actor en sessionStorage, sin JWT.

Una reserva o espera cuya membresía se evaluó para otro horario se rechaza con `CLASE_MODIFICADA` bajo el bloqueo de clase, para volver a evaluar con sus datos actuales. Las sedes conservan propiedad exclusiva de Accesos y se validan con HTTP/JWT ADMIN y traza, dentro de 3000 ms y sin bloqueos SQL durante la llamada. Validación y escritura entre dos servicios no forman una transacción distribuida.

`npm run test:busqueda` ensaya HTTP, dos instancias y PostgreSQL real con datos ficticios. Verifica filtros, orden, páginas, prioridad FIFO, registros previos, actualización de campos con commit/rollback y caída de base. `npm run test:gestion-clases` verifica las APIs administrativas con Accesos/MongoDB y Socios HTTP reales, migración aditiva, replays, versiones, rollback y carreras. También publica y edita mediante HTTP, reserva y registra espera, y compara cinco consultas antes/durante/después de reconstruir GIN. Veinte lecturas terminan en las dos instancias mientras `pg_stat_progress_create_index` confirma la fase `waiting for old snapshots`. Un lector antiguo del fixture mantiene esa fase hasta terminar las lecturas y luego libera su transacción. Se verifican reemplazo del índice, validez y conservación de clases, reservas, espera y resultados idempotentes. La prueba por NGINX complementa ese ensayo.

El mantenimiento usa `REINDEX INDEX CONCURRENTLY idx_clases_fts`, fuera de transacción explícita, y comprueba resultados equivalentes mientras otra instancia consulta. Después de una carga sintética de 12.000 clases se ejecuta `VACUUM (ANALYZE)` y se inspecciona el plan real de una búsqueda selectiva. El optimizador decide el acceso en cada consulta. GIN mantiene una lista de inserciones pendientes, procesada también por VACUUM. [GIN](https://www.postgresql.org/docs/17/gin.html), [REINDEX](https://www.postgresql.org/docs/17/sql-reindex.html).

Resultados finales y límites en [EVIDENCIA-BUSQUEDA](../EVIDENCIA-BUSQUEDA.md).

### Procedimiento de mantenimiento local

El responsable de la base puede abrir psql en el entorno Compose local. La reconstrucción se ejecuta como operación independiente, fuera de `BEGIN`. Requiere espacio para el índice nuevo y puede esperar transacciones antiguas. El ensayo observado usa una espera controlada para comprobar las lecturas concurrentes. [REINDEX de PostgreSQL 17](https://www.postgresql.org/docs/17/sql-reindex.html).

```powershell
docker compose exec postgres psql -U postgres -d clases -v ON_ERROR_STOP=1
```

Consultar el índice y anotar su OID antes de reconstruir.

```sql
SELECT c.oid, c.relname, am.amname AS metodo, i.indisvalid, i.indisready
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
JOIN pg_am am ON am.oid = c.relam
WHERE c.oid = 'public.idx_clases_fts'::regclass;
```

Ejecutar la reconstrucción y volver a consultar el índice con el SELECT anterior. Verificar `gin`, `indisvalid=true`, `indisready=true`, reemplazo del OID y las mismas búsquedas desde el portal/API sobre datos sin cambios.

```sql
REINDEX INDEX CONCURRENTLY public.idx_clases_fts;
```

Otra sesión puede observar el progreso con la consulta siguiente. Al terminar se contrasta el resultado del comando y el estado final del índice. Ante un error, registrar el detalle y revisar el estado y las transacciones abiertas antes de reintentar. [Progreso de índices de PostgreSQL 17](https://www.postgresql.org/docs/17/progress-reporting.html#CREATE-INDEX-PROGRESS-REPORTING).

```sql
SELECT pid, command, phase
FROM pg_stat_progress_create_index
WHERE relid = 'public.clases'::regclass;
```

## Consecuencias

Se reutiliza la base propietaria y se evita una copia eventual del catálogo. Los cupos se calculan sobre reservas transaccionales; incluso una lectura reciente no garantiza que el cupo continúe libre al reservar.

La API y el portal concretan búsqueda textual y publicación/edición con las reglas confirmadas. Se reutiliza el índice generado y se agregan controles técnicos de versión e idempotencia para evitar sobrescrituras y altas duplicadas entre réplicas. El paso 5 queda verificado localmente con reconstrucción y procedimiento de mantenimiento documentados. El retiro voluntario de espera se completó posteriormente en el paso 6, con sus verificaciones en [D4](ADR-017-consistencia-y-recuperacion-de-espera.md).
