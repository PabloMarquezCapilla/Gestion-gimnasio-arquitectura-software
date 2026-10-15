# D6 - Búsqueda

**Estado:** decidida para la Entrega 2; implementada inicialmente con índices B-Tree en PostgreSQL para el contrato actual y planificada con FTS/GIN para texto libre en la siguiente fase.  
**Fecha:** 12/10/2026.

## Contexto

El catálogo de clases y actividades del gimnasio constituye la principal vía de descubrimiento para los socios y para los sistemas consumidores externos. Los usuarios necesitan encontrar clases mediante múltiples dimensiones de búsqueda:
- Texto libre (nombre de la actividad, disciplina o profesor).
- Sede geográfica (`sedeId`).
- Ventana temporal (rango de fechas y franjas horarias `desde` y `hasta`).
- Nivel de intensidad o categoría.
- Clases que cuenten con cupos disponibles para reserva inmediata.

Es necesario definir la estrategia de indexación, los criterios de consulta, la arquitectura de actualización del índice y el retraso de sincronización aceptable para el negocio.

## Decisión

Se adopta una estrategia evolutiva donde en la **Entrega 2** la búsqueda opera mediante **índices B-Tree compuestos** (`publicada`, `sede_id`, `inicio`) sobre PostgreSQL para dar soporte al contrato actual `GET /api/v1/clases`, y se proyecta la incorporación de **PostgreSQL Full-Text Search (FTS) con índices GIN** para la búsqueda por texto libre y similitud en la fase de escalabilidad:.

### 1. Información indexada

El índice de búsqueda del servicio `Clases y Reservas` cubre:

| Campo | Tipo de índice | Criterio de uso |
|---|---|---|
| `nombre`, `actividad`, `profesor` | Índice GIN sobre vector de texto (`tsvector`) con ponderaciones | Búsqueda por texto libre, similitud y lenguaje natural (stemming en español). |
| `sede_id` | B-Tree | Filtrado exacto por sede. |
| `inicio`, `fin` | B-Tree | Filtrado por rango temporal y ordenamiento cronológico. |
| `publicada` | B-Tree parcial | Filtrado para omitir borradores o clases despublicadas. |
| `(inicio, clase_id)` | B-Tree compuesto | Desempate determinista para paginación estable por cursor u offset. |

Definición del vector de búsqueda en PostgreSQL:
```sql
ALTER TABLE clases ADD COLUMN IF NOT EXISTS documento_busqueda tsvector
GENERATED ALWAYS AS (
  setweight(to_tsvector('spanish', coalesce(nombre, '')), 'A') ||
  setweight(to_tsvector('spanish', coalesce(actividad, '')), 'B') ||
  setweight(to_tsvector('spanish', coalesce(profesor, '')), 'C')
) STORED;

CREATE INDEX IF NOT EXISTS idx_clases_fts ON clases USING GIN (documento_busqueda);
CREATE INDEX IF NOT EXISTS idx_clases_consulta ON clases (publicada, sede_id, inicio);
```

### 2. Criterios de consulta y paginación

- **Filtros combinados:** Las consultas aplican intersección booleana entre el filtro de texto (`@@ plainto_tsquery('spanish', :query)`), filtros de igualdad (`sede_id = :sedeId`), y restricciones de intervalo temporal (`inicio >= :desde AND inicio < :hasta`).
- **Orden determinista:** Los resultados se ordenan en primer término por fecha y hora de inicio (`inicio ASC`) y, en caso de coincidencia idéntica, por identificador único (`clase_id ASC`). Esto garantiza que la paginación no duplique ni omita registros entre páginas consecutivas.
- **Paginación estricta:** Límite máximo de 100 resultados por página (por defecto 20), evitando consultas masivas no acotadas que saturen la memoria de los procesos Node.js.

### 3. Actualización y reconstrucción del índice

- **Actualización sincrónica inmediata:** Al utilizar columnas generadas almacenadas (`GENERATED ALWAYS ... STORED`) e índices GIN sobre PostgreSQL, la actualización del índice ocurre en la **misma transacción** que da de alta o modifica la clase.
- **Retraso aceptable:** **0 segundos (retraso nulo)** respecto de los datos transaccionales de la clase. Tan pronto como un administrador publica una clase o modifica sus horarios, la clase aparece inmediatamente disponible en las búsquedas.
- **Reconstrucción del índice:** En caso de mantenimiento, cambio de diccionarios de idioma o corrupción de índices, PostgreSQL permite la reconstrucción sin bloqueo de lecturas mediante:
  ```sql
  REINDEX INDEX CONCURRENTLY idx_clases_fts;
  ```

### 4. Alternativa considerada: Motor dedicado (Elasticsearch / OpenSearch)

- *Alternativa:* Levantar un cluster independiente de Elasticsearch y sincronizar los datos de clases mediante eventos de RabbitMQ o Change Data Capture (Debezium).
- *Motivos de descarte en esta etapa:*
  1. **Complejidad operativa excesiva:** Requiere administrar un cluster Java con alto consumo de memoria RAM (mínimo 2-4 GB adicionales), configuración de shards y monitoreo dedicado.
  2. **Consistencia eventual no deseada para cupos:** Elasticsearch introduce una ventana de refresco de 1 a 2 segundos (`refresh_interval`), lo que causaría que un usuario vea una clase con disponibilidad cuando el cupo real ya fue tomado.
  3. **Volumen del negocio:** Un gimnasio maneja decenas o cientos de clases semanales, un orden de magnitud que PostgreSQL maneja en submilisegundos mediante índices GIN sin necesidad de componentes externos.

## Consecuencias

- **Cero latencia de sincronización:** La búsqueda refleja el estado real de publicación de forma instantánea.
- **Menor huella de infraestructura:** Se aprovecha el motor PostgreSQL 17 ya existente sin incorporar contenedores o servicios adicionales.
- **Evolución futura protegida:** La capa de abstracción del repositorio (`IClaseRepository.listarClases`) aísla la consulta; si en el futuro se incorpora Elasticsearch, solo se reemplazará la implementación del repositorio sin alterar la API de Fastify ni los contratos expuestos.
