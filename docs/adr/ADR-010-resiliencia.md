# D10 - Resiliencia

**Estado:** timeouts, reintento interno, cancelación recuperable y detección de réplica verificados; protección completa pendiente.
**Fecha inicial:** 12/10/2026. **Validación:** 19/10/2026.
**Enunciado:** §2.5, página 2; §2.9, página 3; §5 D10, página 7; §6.3, página 8.

## Contexto y decisión

Una dependencia lenta o caída no debe producir reservas sin validar membresía, perder una cancelación ni alterar el orden de espera. Se conserva el diseño de tiempos acotados, reintentos de lecturas, aislamiento y degradación controlada. Circuit breaker y límites de concurrencia por dependencia siguen propuestos, sin implementación.

## Dependencias y comportamiento actual

| Dependencia / falla | Respuesta implementada y límite |
|---|---|
| Socios lento/caído al reservar o entrar a espera | Cada consulta tiene presupuesto total de 3000 ms y como máximo un reintento; el fallo produce 503 sin confirmar reserva. Se distingue de una inhabilitación válida. [D5](ADR-005-comunicacion-entre-servicios.md). |
| Socios caído al cancelar/promover | La cancelación local se guarda; se conserva el primer candidato y se reintenta al recuperar Socios. El estado durable permite recuperación desde otra instancia, sin red bajo bloqueo SQL. [D4](ADR-017-consistencia-y-recuperacion-de-espera.md). |
| PostgreSQL lento, bloqueo o conexión fallida | Pools independientes por servicio/instancia, máximo 20; conexión 5000 ms, `statement_timeout` 4000 ms y `lock_timeout` 2500 ms. Un fallo en la transacción no produce éxito y dispara rollback. Esos límites no constituyen un plazo global de transacción ni eliminan el impacto de una instancia física compartida. |
| Una réplica de Clases deja de responder | NGINX usa DNS dinámico y fallos pasivos; puede haber errores durante detección. Se comprobó operación estable con la superviviente y reemplazo sin reiniciar gateway. [D12](ADR-012-balanceo-de-carga.md). |
| Configuración/almacenamiento ausente al iniciar | Los servidores operativos exigen configuración; no convierten una caída en un mock habilitado. Memoria requiere modo explícito de desarrollo/prueba. |
| Distribuidora | Todavía no se invoca. Tienda informa integración pendiente. Las políticas reales y el ensayo de caída requieren contrato. |
| RabbitMQ/MongoDB/Redis | RabbitMQ y MongoDB están configurados pero sin sus flujos de dominio; Redis no está incorporado. No se acredita recuperación de esos flujos ni fallback de caché. |

El gateway usa conexión 3 s, lectura 10 s y presupuesto para pasar al siguiente upstream de 5 s, hasta tres intentos, sin habilitar reenvío de POST ya enviado mediante `non_idempotent`. No se promete un timeout global para todo el recorrido ni cero errores.

## Alternativas y consecuencias

Se evita rechazar una cancelación por indisponibilidad de Socios y se evita interpretar errores de red como pérdida de habilitación. El cupo puede quedar temporalmente sin asignar; se conserva la prioridad.

La propuesta inicial contempla circuit breaker y aislamiento adicional; faltan implementación y medición de sus umbrales. Pools separados y límites de cuerpo no garantizan por sí solos ausencia de cascadas. Un fallo del gateway o de PostgreSQL aún puede interrumpir el flujo.

## Verificación y ensayo de caída

`npm run test:postgres` reproduce la caída/recuperación de Socios y la reasignación FIFO. `npm run test:balanceo` construye un entorno completo aislado y detiene/reemplaza una réplica. El [postmortem](../POSTMORTEM.md) documenta impacto, secuencia, detección y mejoras del ensayo local; no sustituye la futura jornada con el proveedor. No se declaran probados escenarios sin un ensayo equivalente.
