# D5 - Comunicación entre servicios

**Estado:** validada en la Entrega 2 para interacción síncrona, trazabilidad e idempotencia.  
**Fecha:** 07/10/2026 (propuesta inicial) | 12/10/2026 (validación con implementación punta a punta).

## Requisito del enunciado

- **Sección 5, página 6:** D5 debe justificar comunicación síncrona y asíncrona, tiempos de espera, reintentos, eventos e idempotencia.
- **Sección 6.2 y 6.3:** la Entrega 1 requería la propuesta inicial y la Entrega 2 requiere validar la comunicación entre servicios en el flujo de punta a punta.
- **Sección 2.5, página 2:** exige ambas comunicaciones, tratamiento de respuestas tardías o ausentes y publicación/consumo de un evento de dominio con manejo de mensajes fallidos.

## Comunicación síncrona: HTTP con JSON

Los servicios llaman directamente a las interfaces de sus dependencias. El API Gateway dirige solicitudes del frontend y del consumidor de nuestra capacidad publicada.

| Consumidor | Proveedor | Consulta necesaria |
|---|---|---|
| **Clases y Reservas** | **Socios y Membresías** | Habilitación actual y vigencia para el inicio de la clase al reservar, ingresar voluntariamente a espera y evaluar una promoción. La respuesta identifica la membresía y la versión de su estado utilizada. |
| **Accesos y Ocupación** | **Socios y Membresías** | Habilitación actual para aceptar un ingreso. El egreso se resuelve con el ingreso abierto del propio servicio. |
| **Clases y Reservas** | **Accesos y Ocupación** | Existencia y datos de la sede al publicar una clase. |
| **Microservicio del grupo consumidor** | **Nuestra capacidad de Clases y Reservas** | Las dos consultas definidas en el [contrato publicado](../contracts/README.md). |

## Validación en la Entrega 2: Flujo síncrono operativo y trazabilidad

Durante la Entrega 2 se implementó y validó operativamente la comunicación síncrona entre `Clases y Reservas` y `Socios y Membresías` a través del cliente `HttpSociosClient` y el endpoint `GET /api/v1/socios/:socioId/habilitacion`:

### 1. Parámetros de resiliencia validados
- **Presupuesto de tiempo (Timeout):** cada llamada remota está protegida por una cancelación estricta vía `AbortSignal` con un timeout de **3000 ms**.
- **Reintentos controlados:** las lecturas idempotentes aplican hasta **1 reintento** tras una espera de **100 ms**, únicamente ante errores de conexión o respuestas transitorias `502`, `503` o `504`.
- **No repetición de fallas semánticas:** respuestas como `404 Not Found` (socio no existe) o respuestas exitosas donde `habilitado: false` nunca disparan reintentos automáticos innecesarios.

### 2. Idempotencia y semántica de respuesta
- La verificación de membresía es una operación estrictamente de lectura: no muta registros en `Socios y Membresías`. Repetir la consulta es 100% idempotente y seguro.
- Si la llamada síncrona falla por timeout o indisponibilidad del servicio de Socios, `Clases y Reservas` aborta de inmediato la operación y responde `503 SERVICIO_NO_DISPONIBLE` con un mensaje claro. Jamás se confirma una reserva sin confirmación fehaciente de la membresía.

### 3. Trazabilidad distribuida W3C
- Se comprobó la propagación transversal de cabeceras de contexto de traza:
  - Cabecera estándar W3C: `traceparent: 00-<trace_id>-<span_id>-01`
  - Cabecera de correlación: `X-Correlation-ID: <trace_id>`
- Al invocar a `Socios y Membresías`, `Clases y Reservas` genera un span hijo manteniendo el mismo `trace_id`. Ambos servicios emiten logs estructurados en JSON vinculados al mismo identificador de traza, permitiendo una reconstrucción cronológica inequívoca en tableros de observabilidad (demostrado en `scripts/demostrar-traza-distribuida.mjs`).

## Comunicación asíncrona: RabbitMQ

El evento de dominio definido es **`MembresiaActualizada`** (versión de esquema 1), publicado por `Socios y Membresías` ante revocaciones, suspensiones o cancelaciones de membresías, y consumido por `Clases y Reservas` para cancelar reservas futuras afectadas y liberar cupos hacia la lista de espera.

### Publicación, consumo e idempotencia (Outbox / Inbox)
1. **Patrón Outbox:** `Socios y Membresías` guarda el evento en su propia base PostgreSQL en la misma transacción donde actualiza el estado de la membresía, garantizando que ningún cambio quede sin evento.
2. **Entrega y Confirmación (ACK):** Un worker lee los eventos pendientes de la tabla outbox y los publica en el exchange de RabbitMQ requiriendo confirmación de publicación (*publisher confirms*).
3. **Patrón Inbox:** `Clases y Reservas` registra el `eventId` recibido antes de aplicar cancelaciones para descartar duplicados ante reenvíos de la red.
4. **Cola de Mensajes Fallidos (Dead Letter Queue - DLQ):** Ante fallas no recuperables tras 3 reintentos con esperas de 1s, 5s y 15s, el mensaje se traslada a una cola DLQ con registro de causas para auditoría técnica.

## Consecuencias confirmadas

- El acoplamiento temporal síncrono durante la reserva asegura que nunca se admita un socio sin membresía habilitada.
- La correlación de logs estructurados con `trace_id` resuelve completamente la visibilidad entre servicios ante incidentes en producción.
- La infraestructura de RabbitMQ 4.1 provista en `compose.yaml` asegura el canal desacoplado para eventos reactivos.
