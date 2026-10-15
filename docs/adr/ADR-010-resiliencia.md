# D10 - Resiliencia

**Estado:** decidida para la Entrega 2.  
**Fecha:** 12/10/2026.

## Contexto

En una arquitectura de microservicios distribuida, las fallas de red, caídas de instancias, saturación de bases de datos o lentitud en servicios dependientes son inevitables. Si no se diseñan mecanismos de contención, una falla localizada en un servicio dependiente (ej. lentitud transitoria en `Socios y Membresías` o caída del proveedor externo) puede propagarse en cascada, agotar los pools de hilos y conexiones del llamador (`Clases y Reservas`), y terminar provocando el colapso global de la plataforma.

Es imperativo definir los patrones y políticas de resiliencia del sistema para contener fallas y garantizar la degradación controlada.

## Decisión

Se adopta una estrategia de **Defensa en Profundidad** basada en cinco patrones complementarios de resiliencia: **Timeouts estrictos**, **Retries con Exponential Backoff y Jitter**, **Circuit Breaker**, **Bulkhead (Aislamiento de Recursos)** y **Degradación Elegante (Graceful Fallback)**.

### 1. Tiempos de espera estrictos (Timeouts)

Ninguna llamada a red, consulta a base de datos o petición HTTP puede quedar bloqueada indefinidamente:

- **Llamadas HTTP entre microservicios internos:** Timeout global de **3.0 segundos** vía `AbortSignal`.
- **Llamadas a proveedores externos:** Timeout de **2.5 segundos**.
- **Consultas y bloqueos transaccionales en PostgreSQL:**
  - `statement_timeout = 4000` (4 segundos máximo para cualquier consulta).
  - `lock_timeout = 2500` (2.5 segundos máximo esperando un bloqueo de fila `FOR UPDATE`).
  - `connectionTimeoutMillis = 5000` (5 segundos máximo para adquirir una conexión del pool).
- **Consultas a Redis (Caché):** Timeout de **200 milisegundos**.

### 2. Reintentos con Backoff Exponencial y Jitter (Retries)

Para mitigar problemas transitorios de red sin provocar tormentas de reintentos (*retry storms*):

- **Solo sobre operaciones idempotentes de lectura:** Se reintentan únicamente peticiones `GET` seguras ante códigos `502`, `503`, `504` o errores de socket `ECONNRESET`. Jamás se reintentan automáticamente mutaciones `POST` o `DELETE` cuyo estado sea incierto.
- **Límite de intentos:** Máximo **1 reintento** adicional.
- **Fórmula de retardo:**
  $$\text{Espera} = \text{Base} \times 2^{\text{intento}} \pm \text{Jitter}$$
  Para llamadas internas: espera de 100 ms con ±25 ms de variación aleatoria para desincronizar solicitudes concurrentes.

### 3. Disyuntor / Cortacircuitos (Circuit Breaker)

Protege al servicio llamador y al servicio llamado cuando una dependencia entra en falla sostenida:

- **Estados del circuito:**
  - **Cerrado (Closed):** Flujo normal. Monitorea la tasa de fallas en una ventana móvil de 10 segundos.
  - **Abierto (Open):** Si más del 50% de las solicitudes fallan consecutivamente en la ventana (o superan el timeout), el circuito se abre. Todas las llamadas subsiguientes fallan inmediatamente (*Fail-Fast*) en < 1 ms sin tocar la red.
  - **Semi-Abierto (Half-Open):** Luego de 20 segundos de reposo (*cooling period*), se permite el paso de una solicitud de prueba. Si es exitosa, el circuito se cierra; si falla, vuelve a abrirse por otros 20 segundos.

### 4. Aislamiento de recursos (Bulkheads)

Para evitar que una falla en una función absorba todos los recursos del sistema:

- **Pools de conexiones separados por base de datos:** `Clases y Reservas` y `Socios y Membresías` cuentan con pools independientes de `pg.Pool` (máximo 20 conexiones cada uno). La saturación de consultas en clases no impide que socios atienda verificaciones.
- **Límites de concurrencia en Fastify:** Configuración de `maxRequestsPerSocket` y límites en el tamaño de carga útil (`bodyLimit: 1048576` = 1 MB) para prevenir agotamiento de memoria del Event Loop de Node.js ante ataques de denegación de servicio.

### 5. Mecanismos de Degradación Controlada (Graceful Degradation)

Cuando un componente secundario falla, el sistema prioriza mantener disponible el negocio central:

| Escenario de falla | Impacto potencial | Mecanismo de degradación |
|---|---|---|
| **Caída de Redis (Caché)** | Imposibilidad de leer ocupación o catálogo desde memoria. | **Fail-Open:** La aplicación captura la desconexión y redirige de inmediato la lectura a la base de datos principal sin interrumpir el servicio. |
| **Falla en `Socios y Membresías` durante promoción de lista de espera** | Imposibilidad de validar membresía del socio en espera. | **Conservación de prioridad:** No se descarta al socio de la lista ni se le asigna el cupo a otro usuario nuevo. El cupo queda retenido y la reasignación queda en estado pendiente para reintento posterior. |
| **Falla del proveedor externo** | Pérdida de datos enriquecidos o complementarios. | El flujo principal de reserva o consulta se completa exitosamente informando los datos propios del gimnasio y omitiendo el campo externo opcional. |

## Consecuencias

- **Sin fallas en cascada:** Una falla en un microservicio queda confinada en su frontera.
- **Recuperación rápida:** El sistema vuelve a operar a plena capacidad tan pronto como el servicio degradado se restablece, sin requerir reinicios manuales de contenedores.
- **Experiencia de usuario predecible:** Los errores retornan códigos HTTP semánticos y mensajes claros en lugar de timeouts infinitos en el navegador.
