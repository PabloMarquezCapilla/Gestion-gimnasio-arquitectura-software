# D5 - Comunicación entre servicios

**Actualización Accesos, 30/10/2026:** ingreso → Socios con clave técnica, contexto W3C y 3000 ms totales incluido cuerpo; hasta un reintento GET de red/502/503/504. Egreso y replay no consultan membresía. Ver [ADR-019](ADR-019-accesos-mongodb-recepcion.md).

**Estado, 07/11/2026.** Suspensión, Outbox, publicador RabbitMQ y consumidor Inbox implementados y verificados con PostgreSQL/RabbitMQ reales y Compose/NGINX. HTTP existente conservado. Resultados y límites en [EVIDENCIA-EVENTOS-MEMBRESIA](../EVIDENCIA-EVENTOS-MEMBRESIA.md).
**Fecha inicial:** 07/10/2026. **Validación:** 23/10/2026.
**Enunciado:** §2.5, página 2; §4.1, páginas 5–6; §5 D5, página 6; §6.2–6.3, página 8.

## Contexto y decisión

Se utiliza HTTP/JSON cuando el resultado de una operación necesita una respuesta inmediata y mensajería para propagar cambios de membresía. Los servicios llaman directamente a sus dependencias; nuestro gateway solo enruta el tráfico entrante. La integración de Tienda pertenece al servicio responsable, no al navegador ni al gateway.

## Comunicación síncrona

| Interacción | Estado y política |
|---|---|
| Clases → Socios: `GET /api/v1/socios/:id/habilitacion?fecha=...` | Operativa. Evalúa habilitación ahora y al inicio de la clase antes de reservar/esperar/promover. Dos lecturas en paralelo, `X-Service-Key` y contexto de traza. |
| Consumidor externo → gateway → Socios: POST de empleados anterior | API anterior operativa localmente. `X-API-Key`, `Idempotency-Key` y transacción. Se conserva, pero no representa el nuevo flujo con Car Cruds. [ADR-014](ADR-014-contrato-empleados.md). |
| Socios → Car Cruds: empleados, estado laboral y evidencia de membresía | Lecturas GET y POST de evidencia implementados, con contrato externo 0.4.0 y Bearer gym. Presupuesto total de 3000 ms configurable, cuerpo incluido. Lectura: un reintento máximo de red/502/503/504. Envío: un solo POST, desde un mensaje durable confirmado por ADMIN; recuperación manual con el mismo cuerpo. Token del proveedor y prueba conjunta pendientes. Salida directa desde Socios. [D8 vigente](ADR-018-integracion-car-cruds.md). |
| Tienda → distribuidora: productos/stock | Pendiente de contrato, URL y autenticación. La ruta interna autenticada ya informa `503 INTEGRACION_PENDIENTE`; no llama al proveedor. [D9](ADR-009-consumo-del-proveedor.md). |
| Accesos → Socios: habilitación al ingresar | Implementada en ADR-019; egreso/replay no consultan membresía. |
| Clases → Accesos: sede al publicar/editar | Implementada. `GET /api/v1/accesos/sedes`, JWT ADMIN recibido y traza W3C. `ACCESOS_SERVICE_URL` y 3000 ms totales, cuerpo incluido con máximo de 1 MiB. Redirección, error o lista incompatible producen 503. Ocurre antes de la transacción SQL. |

### Tiempo, errores y reintentos internos

Publicación/edición de clases recupera primero una operación confirmada por actor/clave y contenido normalizado. Un replay no vuelve a consultar Accesos ni exige que el horario siga siendo futuro. Una operación nueva necesita validar la sede. El panel conserva las escrituras inciertas para repetir la misma solicitud. La consulta a Accesos hace un único intento HTTP dentro de su presupuesto. [D6](ADR-006-busqueda.md).

Cada verificación HTTP a Socios tiene **3000 ms totales**, incluida conexión, cuerpo y como máximo un reintento dentro del presupuesto. El cliente contempla errores de red y HTTP 502/503/504, con espera aleatoria de 75–124 ms. Un cuerpo inválido se trata como fallo y puede consumir el reintento acotado; nunca se acepta como habilitación.

Un 404 de Socios se interpreta como socio no encontrado; una respuesta válida no habilitada es un rechazo de negocio. Ante red/error desconocido, reservar produce 503. Durante una promoción, ese fallo conserva al primero de espera para reintentar, sin retirarlo como si estuviera inhabilitado. Un candidato comprobado no habilitado sí se retira. La cancelación se acepta localmente sin depender de la llamada remota; [D4](ADR-017-consistencia-y-recuperacion-de-espera.md).

El POST externo repite el resultado por origen/clave/cuerpo; no se reintenta automáticamente cualquier escritura cuyo resultado sea incierto. El consumidor debe conservar clave y datos al reintentar. Gateway: conexión 3 s, lectura 10 s y siguientes intentos acotados, sin habilitar `non_idempotent`; límites y detección en [D12](ADR-012-balanceo-de-carga.md).

La vinculación administrativa consulta el estado de un ID conocido en Car Cruds antes de abrir la transacción local. Un error remoto bloquea la asociación/corrección, sin modificar datos. `active:false` es informativo y no cancela membresías ni impide asociaciones históricas. Consultar vínculos/historial o desvincular no requiere al proveedor. El gateway no reintenta estas escrituras; una respuesta incierta requiere consultar el estado local antes de confirmar otra vez.

El envío de evidencia Car Cruds conserva exactamente `sourceReference`, `version`, `observedAt` y cuerpo original en cada reintento manual. Usa fotografías completas versionadas, sin `Idempotency-Key`. El presupuesto HTTP cubre la respuesta; un timeout/5xx/cuerpo inválido queda `PENDIENTE` y un rechazo definitivo requiere revisión. Un `409` no aumenta automáticamente la versión. El reclamo durable tiene lease de 60 s y UUID para impedir intentos simultáneos o finalizaciones tardías; HTTP se ejecuta fuera del bloqueo y no hay cron. La preparación nueva ante un vínculo corregido requiere confirmación explícita y conserva recibos anteriores. [ADR-018](ADR-018-integracion-car-cruds.md).

### Correlación

Clases propaga su `traceparent` y `X-Correlation-ID`; Socios crea spans hijos con la misma traza. Se correlacionan los logs de negocio y las respuestas. La prueba HTTP con PostgreSQL exige ese vínculo; la demostración con `inject` es complementaria. [D11](ADR-011-observabilidad.md).

## Comunicación asíncrona de suspensiones

Se concreta RabbitMQ con **`MembresiaActualizada`**, esquema 1.0.0 y `schemaVersion=1`, para la transición `SUSPENSION`. ADMIN elige una membresía y la suspende inmediatamente, conservando sus fechas. El equipo confirmó la regla y dejó reactivación para otra etapa. [Esquema versionado](../contracts/membresia-actualizada-v1.schema.json), [API y operación](../contracts/membresias-eventos.md).

- **Outbox de Socios.** Estado, evento y resultado idempotente se confirman en la misma transacción. Un publicador toma un reclamo durable de 30 s y publica fuera del bloqueo SQL. Marca publicado tras confirmación del broker. Una caída antes de marcar puede repetir el evento. El UUID de reclamo impide que un trabajador antiguo finalice un reclamo nuevo.
- **RabbitMQ.** Exchange topic durable `gimnasio.dominio.v1`, clave `membresia.actualizada.v1`, cola durable compartida `clases.membresias.v1` y mensajes persistentes. El publicador declara enlace/cola antes de enviar, incluso sin consumidor. Publicación obligatoria detecta falta de enrutamiento. Conexión y confirmación tienen presupuestos de 3 s y 5 s. Reconexión cada segundo.
- **Inbox de Clases.** Valida versión/esquema antes de persistir. `membresias_inbox` registra ID, contenido y efecto junto con las cancelaciones y la proyección `membresias_suspendidas`. Repetir ID/contenido no repite efectos. ID reutilizado con otros datos requiere revisión. Cada réplica consume con `prefetch=1` y confirma después del commit.
- **Reservas y prioridad.** Cancela reservas confirmadas de clases futuras cuya cobertura actual o al inicio resulta afectada. Clases ya iniciadas permanecen como historial. Evento y escrituras de reserva/espera/promoción se serializan por socio antes de bloquear clase. La proyección impide reservar con una evaluación HTTP anterior después de aplicar la suspensión. Reasignación reutiliza el trabajador FIFO y sus validaciones HTTP fuera de SQL. Si Socios falla conserva primero y cupo protegido.
- **Mensajes fallidos.** Tres reintentos con esperas de 1, 5 y 15 s conservando la entrega sin confirmar durante la espera. Se republica mensaje persistente con número de intento y confirmación antes de confirmar el original. Error de esquema/conflicto va directamente a `clases.membresias.v1.dlq`. Al agotar intentos también queda allí con causa técnica. Caer entre republicar y confirmar puede duplicar entregas, cubiertas por Inbox. No se depende de un salto TTL/DLX sin confirmación.

La suspensión local puede responder con broker caído, dejando el evento pendiente. Existe consistencia eventual hasta el consumo. Socios rechaza nuevas validaciones desde el commit. Una evaluación anterior puede completarse antes de llegar el evento y será revisada al consumirlo. El bloqueo cierra la carrera posterior al consumo, sin atomicidad distribuida. La proyección representa suspensiones y fechas con la política actual de nuevos períodos sin superposición. Reactivación requiere ampliar/versionar esta proyección antes de habilitarla.

RabbitMQ y PostgreSQL siguen siendo instancias únicas. El HTTP `/health` informa almacenamiento disponible, y el fallo del broker se observa en logs y pendientes. El evento omite DNI, email, contraseña y pagos. `eventId` enlaza registro HTTP, publicación y consumo. Tablero/alertas corresponden a la etapa 8.

## Alternativas y consecuencias

Se evita consultar bases ajenas o canalizar dependencias por el gateway. Usar solo llamadas síncronas para difundir suspensiones acoplaría la disponibilidad de ambos servicios; la mensajería exige entrega repetible y consumidores idempotentes.

Las reservas nuevas dependen de Socios y las cancelaciones locales se conservan ante su caída. La publicación accesible y pruebas conjuntas siguen pendientes. La verificación del evento se registra por separado de las pruebas HTTP anteriores.
