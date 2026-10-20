# D4 - Consistencia y concurrencia

**Estado:** reemplazada por [ADR-017](ADR-017-consistencia-y-recuperacion-de-espera.md) el 19/10/2026. Se conserva el texto como antecedente; la validación remota durante la transacción de cancelación y las garantías temporales indicadas debajo ya no describen la implementación vigente.
**Fecha:** 12/10/2026.

## Contexto

El sistema de gestión de gimnasio presenta operaciones críticas de negocio donde la pérdida de consistencia o las anomalías por concurrencia acarrean impacto directo en la operación física del gimnasio:
1. **Sobreventa de cupos:** si dos socios intentan reservar simultáneamente el último cupo de una clase de capacidad limitada, nunca debe superarse el aforo permitido.
2. **Duplicación de reservas:** un socio no puede poseer más de una reserva confirmada activa para la misma clase.
3. **Prioridad estricta en lista de espera:** ante la liberación de un cupo por cancelación previa, el lugar debe ofrecerse en estricto orden de inscripción a socios con membresía habilitada, sin que una nueva solicitud externa pueda adelantar su posición.
4. **Fallas parciales en comunicación:** si la consulta de validación de membresía falla o tarda en responder, no debe registrarse una reserva en estado inconsistente.

## Decisión

Se adopta una combinación de **Aislamiento Transaccional ACID en PostgreSQL**, **Bloqueo Pesimista a nivel de fila (`SELECT ... FOR UPDATE`)**, y **Restricciones de Unicidad Parciales en el motor de base de datos**.

### 1. Mecanismo contra la reserva concurrente del último cupo

Para resolver la carrera por el último cupo disponible entre múltiples hilos o solicitudes simultáneas:

1. El servicio `Clases y Reservas` abre una transacción PostgreSQL (`BEGIN`).
2. Adquiere un bloqueo exclusivo sobre la fila de la clase mediante:
   ```sql
   SELECT clase_id, capacidad, inicio FROM clases WHERE clase_id = $1 FOR UPDATE;
   ```
   Cualquier otra transacción concurrente que intente reservar la misma clase queda pausada en la base de datos hasta que la primera confirme (`COMMIT`) o descarte (`ROLLBACK`).
3. Se verifica que la clase no haya iniciado (`NOW() < inicio`).
4. Se cuenta la cantidad exacta de reservas confirmadas activas bajo el mismo contexto transaccional:
   ```sql
   SELECT count(*)::int FROM reservas WHERE clase_id = $1 AND estado = 'CONFIRMADA';
   ```
5. Si `ocupados < capacidad`:
   - Se inserta la reserva con estado `CONFIRMADA`.
   - Se confirma la transacción (`COMMIT`).
6. Si `ocupados >= capacidad`:
   - Se revierte la transacción (`ROLLBACK`) o se deriva a la lista de espera.
   - Se retorna código HTTP `409 Conflict` (`CLASE_SIN_CUPOS`), impidiendo cualquier sobreventa.

### 2. Prevención de reservas duplicadas

Para garantizar que un socio no obtenga dos cupos para la misma clase, ni siquiera disparando clics simultáneos o solicitudes concurrentes desde múltiples pestañas:

- Se implementa un **índice único parcial**:
  ```sql
  CREATE UNIQUE INDEX uq_reserva_activa ON reservas (clase_id, socio_id) WHERE estado = 'CONFIRMADA';
  ```
- Si dos transacciones intentan insertar simultáneamente una reserva confirmada para el mismo par `(clase_id, socio_id)`, el motor de PostgreSQL rechaza inmediatamente la segunda con una violación de unicidad (`23505 unique_violation`).
- La aplicación captura este caso y retorna `409 RESERVA_DUPLICADA` de manera idempotente.
- Al permitir que las reservas canceladas (`estado = 'CANCELADA'`) queden excluidas del índice parcial, un socio puede volver a reservar legítimamente una clase que había cancelado con anterioridad si vuelve a haber cupo.

### 3. Reasignación atómica de cupos liberados (Lista de espera)

Al cancelarse una reserva confirmada:

1. La transacción bloquea la reserva a cancelar (`FOR UPDATE`) y cambia su estado a `CANCELADA`.
2. Inspecciona las entradas de `lista_espera` bloqueándolas en orden de inscripción:
   ```sql
   SELECT espera_id, socio_id FROM lista_espera WHERE clase_id = $1 AND estado = 'PENDIENTE' ORDER BY orden ASC FOR UPDATE;
   ```
3. Para cada candidato, se verifica sincrónicamente su membresía vigente.
4. Si está habilitado:
   - Se actualiza su entrada en `lista_espera` a `PROMOVIDO`.
   - Se inserta una nueva reserva `CONFIRMADA` a su nombre.
   - Se completa la transacción (`COMMIT`).
5. Si un candidato ya no cuenta con membresía vigente:
   - Se actualiza a `CANCELADO` y se evalúa automáticamente al siguiente en el orden sin liberar el cupo hacia solicitantes nuevos externos.

### 4. Tratamiento de fallas parciales

- **Validación remota antes de escribir:** La consulta a `Socios y Membresías` se realiza antes de abrir la transacción de inserción en PostgreSQL. Si `Socios y Membresías` no responde (timeout 3s) o arroja error, la operación falla limpiamente (`503 SERVICIO_NO_DISPONIBLE`) sin dejar datos huérfanos ni bloqueos residuales.
- **Fail-Safe de Negocio:** Una falta de respuesta o respuesta con error de validación nunca se asume como "socio habilitado". Sin comprobación fehaciente no se reserva ningún cupo.

## Consecuencias

- **Consistencia Inquebrantable:** Imposibilidad matemática de sobrepasar la capacidad de una clase o de duplicar reservas en la misma actividad.
- **Sobrecarga de Bloqueos Aceptable:** Los bloqueos `FOR UPDATE` afectan únicamente a la fila de la clase específica en disputa, duran menos de 15 milisegundos y no interfieren con la reserva de otras clases ni con consultas de lectura pública.
- **Verificación Automatizada:** Las pruebas de integración en `test/flujo-principal.test.mjs` comprueban explícitamente el rechazo de duplicados, la contención por aforo y la promoción en lista de espera.
