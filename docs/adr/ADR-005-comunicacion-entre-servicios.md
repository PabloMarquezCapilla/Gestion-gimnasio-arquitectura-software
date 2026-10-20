# D5 - Comunicación entre servicios

**Estado actual:** consultas de habilitación comprobadas en el paso 4; recepción de empleados con PostgreSQL y gateway implementada en el paso 5. El mock se conserva y la mensajería de dominio sigue pendiente.

**Fecha:** 07/10/2026 (propuesta inicial) | 12/10/2026 (validación con implementación punta a punta).

## Aclaración de integración - 19/10/2026

Se conserva la decisión general de consultas HTTP y mensajería interna. Se actualiza el alcance de integración según [ADR-014](ADR-014-contrato-empleados.md), sucesor del contrato anterior:

| Dirección | Responsable / contraparte | Diseño acordado y estado |
|---|---|---|
| Entrada al gimnasio | Otro grupo → Socios y Membresías | `POST /api/v1/integraciones/empleados`; `X-API-Key` identifica el origen y `Idempotency-Key` controla repeticiones. Se recibe `empleadoExternoId`, `dni`, `nombre` y `email`; se crea socio y solicitud pendiente, sin membresía habilitada. PostgreSQL y gateway operativos; mock separado conservado. |
| Salida del gimnasio | Tienda → distribuidora | Consulta de productos y stock. Tienda es un servicio separado previsto, según [ADR-015](ADR-015-limites-con-tienda.md). Identidad, URL, contrato, autenticación y parámetros operativos del proveedor pendientes. |

El POST devuelve la respuesta original ante mismo origen, clave y cuerpo. Una reutilización incompatible de la clave, un empleado externo asociado a otro DNI o un alta nueva con DNI/email existente devuelve `409`, sin sobrescribir registros. La repetición explícita con la clave acordada es distinta de repetir automáticamente cualquier escritura cuyo resultado se desconoce.

El API Gateway dirige el nuevo POST a Socios y Membresías desde el paso 5. La credencial `EMPLEADOS_API_KEY` identifica `EMPLEADOS_ORIGEN_ID`; el inicio local utiliza un origen explícitamente ficticio mientras no se acuerde el real. El POST no reenvía datos a otro grupo ni inicia pagos. Un reintento del consumidor debe conservar clave y cuerpo; no se activan reintentos genéricos de escrituras en el gateway.

El consumo de la distribuidora partirá de **Tienda**, conforme a la sección 4.1, página 5. Desde el paso 6 el portal consulta una ruta interna autenticada de Tienda a través del gateway; devuelve `503 INTEGRACION_PENDIENTE`, sin productos ni stock, mientras falta el contrato. El proceso tiene salud propia, sin dependencias de base o broker. Las operaciones externas se definirán con el contrato real, sin inventar rutas ni datos de conexión. No se configura una llamada directa desde el frontend al proveedor.

La nueva integración no está incluida en las validaciones anteriores. La fila de publicación de clases y los parámetros registrados el 12/10 se conservan debajo como antecedentes; las consultas de clases continúan como función interna y la nueva publicación se documenta en el contrato de empleados.

**Referencias:** sección 3, página 4; sección 4.1, página 5; sección 5, páginas 6–7. Se mantiene la estrategia de comunicación de D5; el cambio de capacidad publicada queda registrado por el sucesor de D8.

## Requisito del enunciado

- **Sección 5, página 6:** D5 debe justificar comunicación síncrona y asíncrona, tiempos de espera, reintentos, eventos e idempotencia.
- **Sección 6.2 y 6.3:** la Entrega 1 requería la propuesta inicial y la Entrega 2 requiere validar la comunicación entre servicios en el flujo de punta a punta.
- **Sección 2.5, página 2:** exige ambas comunicaciones, tratamiento de respuestas tardías o ausentes y publicación/consumo de un evento de dominio con manejo de mensajes fallidos.

## Comunicación síncrona: HTTP con JSON

### Implementación verificada en el paso 4 - 19/10/2026

- `ReservasService` consulta la habilitación para el instante actual y para el inicio de la clase en paralelo, antes de reservar/entrar en espera y antes de promover. La selección por fecha de Socios conserva la cobertura actual aunque exista una renovación futura.
- `HttpSociosClient` utiliza `X-Service-Key` (`SERVICIOS_API_KEY`), distinta de la credencial externa. Socios limita esa clave a la consulta de habilitación; los usuarios utilizan JWT con permisos propios o ADMIN, según [ADR-016](ADR-016-autenticacion-y-altas.md).
- Cada verificación tiene **3000 ms totales**, incluyendo conexión, lectura del cuerpo y como máximo un reintento dentro del mismo presupuesto. Solo se reintentan fallas de conexión y HTTP 502/503/504, con espera breve de 75–124 ms. Un 401/403, cuerpo inválido o indisponibilidad nunca se convierte en `habilitado: false` para descartar un candidato.
- Una validación fallida impide crear una reserva y produce 503. La cancelación local se acepta sin consultar la red y la promoción se recupera mediante el trabajador descrito en [D4 vigente, ADR-017](ADR-017-consistencia-y-recuperacion-de-espera.md). No hay HTTP mientras se conserva un bloqueo SQL.
- El gateway tiene `proxy_read_timeout 10s` para permitir la respuesta controlada del servicio. No implica que todos los fallos de base de datos estén contenidos en un plazo global de 10 s.
- `npm run test:postgres` comprueba HTTP real contra Socios y dos instancias de Clases con PostgreSQL, incluyendo caída y recuperación. La demostración `scripts/demostrar-traza-distribuida.mjs` sigue siendo una prueba separada en memoria mediante `inject`.

Los parámetros del apartado histórico del 12/10 se conservan como antecedente; las garantías actuales son las de este apartado. El POST de empleados se implementa en el paso 5; la comunicación de Tienda permanece pendiente.

Los servicios llaman directamente a las interfaces de sus dependencias. El API Gateway dirige solicitudes del frontend y del consumidor de nuestra capacidad publicada.

| Consumidor | Proveedor | Consulta necesaria |
|---|---|---|
| **Clases y Reservas** | **Socios y Membresías** | Habilitación actual y vigencia para el inicio de la clase al reservar, ingresar voluntariamente a espera y evaluar una promoción. La respuesta identifica la membresía y la versión de su estado utilizada. |
| **Accesos y Ocupación** | **Socios y Membresías** | Habilitación actual para aceptar un ingreso. El egreso se resuelve con el ingreso abierto del propio servicio. |
| **Clases y Reservas** | **Accesos y Ocupación** | Existencia y datos de la sede al publicar una clase. |
| **Microservicio del grupo consumidor (antecedente de E1)** | **Capacidad anterior de Clases y Reservas** | Las consultas del [contrato histórico](../contracts/openapi-v1.yaml), reemplazadas como capacidad publicada por [ADR-014](ADR-014-contrato-empleados.md). |

## Antecedente del 12/10: flujo síncrono y trazabilidad

Los puntos siguientes conservan el registro anterior. Sus afirmaciones de timeout estricto y observabilidad completa requieren las correcciones detectadas en la revisión; el script citado usa memoria e `inject`. Este registro no acredita esas garantías para el nuevo POST ni reemplaza una comprobación entre procesos reales.

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

## Comunicación asíncrona: diseño pendiente de implementación

El evento de dominio definido es **`MembresiaActualizada`** (versión de esquema 1). El diseño prevé que Socios y Membresías lo publique ante revocaciones, suspensiones o cancelaciones, y que Clases y Reservas lo consuma para cancelar reservas futuras afectadas y liberar cupos. RabbitMQ está configurado; el evento, outbox, inbox, workers y recuperación de mensajes todavía no están implementados.

### Publicación, consumo e idempotencia previstos (Outbox / Inbox)
1. **Patrón Outbox:** `Socios y Membresías` guarda el evento en su propia base PostgreSQL en la misma transacción donde actualiza el estado de la membresía, garantizando que ningún cambio quede sin evento.
2. **Entrega y Confirmación (ACK):** Un worker lee los eventos pendientes de la tabla outbox y los publica en el exchange de RabbitMQ requiriendo confirmación de publicación (*publisher confirms*).
3. **Patrón Inbox:** `Clases y Reservas` registra el `eventId` recibido antes de aplicar cancelaciones para descartar duplicados ante reenvíos de la red.
4. **Cola de Mensajes Fallidos (Dead Letter Queue - DLQ):** Ante fallas no recuperables tras 3 reintentos con esperas de 1s, 5s y 15s, el mensaje se traslada a una cola DLQ con registro de causas para auditoría técnica.

Los cuatro puntos anteriores describen el diseño conservado, no tareas actualmente ejecutadas. Los tiempos son parámetros propuestos del antecedente y requieren validación al implementar.

## Consecuencias y verificaciones pendientes

- La consulta síncrona comprueba ambos momentos del alcance en el paso 4; las pruebas no sustituyen la cancelación por un cambio posterior de membresía, que requiere el evento pendiente.
- La correlación mediante `trace_id` permite relacionar operaciones; su cobertura y evidencia entre procesos deben comprobarse para el flujo operativo y documentarse en D11.
- RabbitMQ 4.1 está configurado en `compose.yaml`; su presencia no demuestra publicación ni consumo de eventos.
