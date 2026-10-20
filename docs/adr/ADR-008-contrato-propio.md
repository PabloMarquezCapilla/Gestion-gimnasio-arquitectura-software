# D8 - Contrato de la capacidad propia

**Estado actual:** reemplazado el 19/10/2026 por [ADR-014 - Contrato de recepción de empleados](ADR-014-contrato-empleados.md). Se conserva el contenido siguiente como antecedente de la capacidad anterior.

**Fecha:** 07/10/2026 (diseño inicial y mock) | 12/10/2026 (actualización e implementación operativa sobre PostgreSQL).

**Aclaración de evidencia del 19/10/2026:** las pruebas `contract.test.mjs` y `flujo-principal.test.mjs` citadas en este registro utilizan repositorios en memoria. Sus resultados no representan una validación exhaustiva de PostgreSQL. La consulta de clases continúa como función del gimnasio; la capacidad ofrecida al otro grupo pasa a ser el POST de empleados documentado en el sucesor.

## Contexto

El enunciado exige publicar una capacidad utilizable por otro grupo, con un contrato formal, estándar y versionado en `docs/contracts/`. En la Entrega 1 se definió la capacidad de **consulta de clases y cupos disponibles** y se proveyó un mock local.

Para la Entrega 2, el enunciado solicita presentar *la funcionalidad a compartir funcionando* y actualizar D8 si el contrato hubiera cambiado.

## Decisión y Estado en la Entrega 2

### 1. Estado del contrato: sin cambios incompatibles (v1.0.0 conservada)
El contrato publicado en [docs/contracts/openapi-v1.yaml](../contracts/openapi-v1.yaml) se mantiene en la versión **`1.0.0`** bajo la especificación OpenAPI 3.1.1. No se requirieron modificaciones breaking changes de rutas, parámetros ni esquemas, lo que preserva la estabilidad para el grupo consumidor que sea asignado:
- `GET /api/v1/clases`: listado con filtros opcionales (`sedeId`, `desde`, `hasta`), paginación (`pagina`, `tamanio`) y orden determinista por inicio ascendente y claseId ascendente.
- `GET /api/v1/clases/{claseId}`: detalle y disponibilidad de una clase concreta.

### 2. Transición de Mock a Implementación Operativa Real
En la Entrega 2, la capacidad dejó de responder desde un conjunto de datos estáticos en memoria con cabecera `X-Mock: true` y pasó a ejecutarse contra el almacenamiento transaccional en **PostgreSQL 17**:
- **Cálculo dinámico de cupos:** el campo `cuposDisponibles` ahora se calcula directamente en la consulta SQL a partir del aforo de la clase menos la cantidad de reservas confirmadas activas (`c.capacidad - count(r.reserva_id)`).
- **Consistencia temporal:** cada consulta devuelve el instante de evaluación en `consultadoEn` (formato RFC 3339 con zona horaria).
- **Control de caché:** se mantiene la emisión de la cabecera estándar `Cache-Control: no-store` para impedir que intermediarios HTTP almacenen respuestas obsoletas que induzcan a error a los socios o consumidores.
- **Seguridad:** se mantiene la autenticación mediante la cabecera `X-API-Key` validada contra `CAPACIDAD_API_KEY` en el entorno.

### 3. Verificación de cumplimiento del contrato
La suite de pruebas automatizadas (`services/clases-reservas/test/contract.test.mjs` y `test/flujo-principal.test.mjs`):
- Comprueba exhaustivamente que todas las respuestas de la capacidad real cumplan los esquemas JSON Schema de OpenAPI compilados con AJV 2020.
- Valida que una reserva confirmada decremente de forma inmediata y observable los `cuposDisponibles` en la siguiente consulta al endpoint `/api/v1/clases/{claseId}`.
- Valida que la cancelación de una reserva restituya el cupo o promueva a la lista de espera, reflejándose fielmente en el contrato compartido.

## Compatibilidad y versionado futuro

- **Compatibilidad hacia atrás:** Cualquier agregado futuro (ej. nuevos campos opcionales en el detalle) incrementará la versión menor (`1.1.0`) sin alterar los clientes existentes.
- **Cambios incompatibles:** En caso de alterar tipos de datos, rutas o eliminar campos requeridos, se publicará una nueva versión mayor (`/api/v2/...`), manteniendo la versión `v1` activa durante un período de deprecación acordado.

## Consecuencias

- La capacidad compartida está 100% operativa y lista para ser consumida por otro grupo tanto en local a través del API Gateway como en el entorno operativo.
- No se trasladó deuda técnica ni cambios de interfaz al consumidor asignado.
