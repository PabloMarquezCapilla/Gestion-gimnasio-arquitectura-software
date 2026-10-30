# D5 - Comunicación entre servicios

**Actualización Accesos, 30/10/2026:** ingreso → Socios con clave técnica, contexto W3C y 3000 ms totales incluido cuerpo; hasta un reintento GET de red/502/503/504. Egreso y replay no consultan membresía. Ver [ADR-019](ADR-019-accesos-mongodb-recepcion.md); RabbitMQ sigue sin eventos de dominio.

**Estado:** estrategia HTTP y mensajería conservada; lecturas, vinculación y envío manual Car Cruds y POST anterior operativos localmente. Eventos de dominio y conexión conjunta pendientes.
**Fecha inicial:** 07/10/2026. **Validación:** 23/10/2026.
**Enunciado:** §2.5, página 2; §4.1, páginas 5–6; §5 D5, página 6; §6.2–6.3, página 8.

## Contexto y decisión

Se utiliza HTTP/JSON cuando el resultado de una operación necesita una respuesta inmediata y mensajería para propagar cambios de membresía. Los servicios llaman directamente a sus dependencias; nuestro gateway solo enruta el tráfico entrante. La integración de Tienda pertenece al servicio responsable, no al navegador ni al gateway.

## Comunicación síncrona

| Interacción | Estado y política |
|---|---|
| Clases → Socios: `GET /api/v1/socios/:id/habilitacion?fecha=...` | Operativa. Evalúa habilitación ahora y al inicio de la clase antes de reservar/esperar/promover. Dos lecturas en paralelo, `X-Service-Key` y contexto de traza. |
| Consumidor externo → gateway → Socios: POST de empleados anterior | API anterior operativa localmente. `X-API-Key`, `Idempotency-Key` y transacción. Se conserva, pero no representa el nuevo flujo con Car Cruds. [ADR-014](ADR-014-contrato-empleados.md). |
| Socios → Car Cruds: empleados, estado laboral y evidencia de membresía | Lecturas GET y POST de evidencia implementados, con contrato externo 0.3.0 y Bearer gym. Presupuesto total de 3000 ms configurable, cuerpo incluido. Lectura: un reintento máximo de red/502/503/504. Envío: un solo POST, desde un mensaje durable confirmado por ADMIN; recuperación manual con el mismo cuerpo. URL/token reales y prueba conjunta pendientes. Salida directa desde Socios. [D8 vigente](ADR-018-integracion-car-cruds.md). |
| Tienda → distribuidora: productos/stock | Pendiente de contrato, URL y autenticación. La ruta interna autenticada ya informa `503 INTEGRACION_PENDIENTE`; no llama al proveedor. [D9](ADR-009-consumo-del-proveedor.md). |
| Accesos → Socios: habilitación al ingresar | Implementada en ADR-019; egreso/replay no consultan membresía. |
| Clases → Accesos: sede al publicar | Prevista, sin flujo implementado en esta etapa. |

### Tiempo, errores y reintentos internos

Cada verificación HTTP a Socios tiene **3000 ms totales**, incluida conexión, cuerpo y como máximo un reintento dentro del presupuesto. El cliente contempla errores de red y HTTP 502/503/504, con espera aleatoria de 75–124 ms. Un cuerpo inválido se trata como fallo y puede consumir el reintento acotado; nunca se acepta como habilitación.

Un 404 de Socios se interpreta como socio no encontrado; una respuesta válida no habilitada es un rechazo de negocio. Ante red/error desconocido, reservar produce 503. Durante una promoción, ese fallo conserva al primero de espera para reintentar, sin retirarlo como si estuviera inhabilitado. Un candidato comprobado no habilitado sí se retira. La cancelación se acepta localmente sin depender de la llamada remota; [D4](ADR-017-consistencia-y-recuperacion-de-espera.md).

El POST externo repite el resultado por origen/clave/cuerpo; no se reintenta automáticamente cualquier escritura cuyo resultado sea incierto. El consumidor debe conservar clave y datos al reintentar. Gateway: conexión 3 s, lectura 10 s y siguientes intentos acotados, sin habilitar `non_idempotent`; límites y detección en [D12](ADR-012-balanceo-de-carga.md).

La vinculación administrativa consulta el estado de un ID conocido en Car Cruds antes de abrir la transacción local. Un error remoto bloquea la asociación/corrección, sin modificar datos. `active:false` es informativo y no cancela membresías ni impide asociaciones históricas. Consultar vínculos/historial o desvincular no requiere al proveedor. El gateway no reintenta estas escrituras; una respuesta incierta requiere consultar el estado local antes de confirmar otra vez.

El envío de evidencia Car Cruds conserva exactamente `sourceReference`, `version`, `observedAt` y cuerpo original en cada reintento manual. Usa fotografías completas versionadas, sin `Idempotency-Key`. El presupuesto HTTP cubre la respuesta; un timeout/5xx/cuerpo inválido queda `PENDIENTE` y un rechazo definitivo requiere revisión. Un `409` no aumenta automáticamente la versión. El reclamo durable tiene lease de 60 s y UUID para impedir intentos simultáneos o finalizaciones tardías; HTTP se ejecuta fuera del bloqueo y no hay cron. La preparación nueva ante un vínculo corregido requiere confirmación explícita y conserva recibos anteriores. [ADR-018](ADR-018-integracion-car-cruds.md).

### Correlación

Clases propaga su `traceparent` y `X-Correlation-ID`; Socios crea spans hijos con la misma traza. Se correlacionan los logs de negocio y las respuestas. La prueba HTTP con PostgreSQL exige ese vínculo; la demostración con `inject` es complementaria. [D11](ADR-011-observabilidad.md).

## Comunicación asíncrona prevista

Se conserva RabbitMQ y el evento **`MembresiaActualizada`**, esquema versión 1, para que Clases cancele reservas futuras afectadas por cambios de habilitación y reasigne cupos.

- **Outbox:** guardar cambio y evento en la misma transacción de Socios; un publicador enviará con confirmación del broker.
- **Inbox:** el consumidor de Clases deberá registrar `eventId` y aplicar sus efectos en la misma transacción local, descartando duplicados de manera atómica.
- **Mensajes fallidos:** reintentos acotados y DLQ con causa para revisión. Se conservan como propuesta inicial tres esperas de 1, 5 y 15 s, pendientes de validación al implementar.

Solo RabbitMQ está configurado. No hay Outbox, Inbox, publicador, consumidor ni DLQ operativos. Su presencia en Compose no acredita §2.5 ni cancelación por suspensión posterior.

## Alternativas y consecuencias

Se evita consultar bases ajenas o canalizar dependencias por el gateway. Usar solo llamadas síncronas para difundir suspensiones acoplaría la disponibilidad de ambos servicios; la mensajería exige entrega repetible y consumidores idempotentes.

Las reservas nuevas dependen de Socios; las cancelaciones locales y su recuperación reducen esa dependencia. No hay atomicidad distribuida ni política externa definitiva sin contrato. La publicación accesible, el evento y su recuperación siguen pendientes.
