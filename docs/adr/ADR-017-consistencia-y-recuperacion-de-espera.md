# D4 - Consistencia y recuperación de la lista de espera

**Ampliación independiente, 30/10/2026:** [ADR-019](ADR-019-accesos-mongodb-recepcion.md) concreta consistencia de Accesos: serialización por socio/sede y transacción MongoDB de presencia, movimiento e idempotencia. No cambia la política FIFO ni PostgreSQL. Un replay tardío no reabre presencias; ocupación deriva de presencias confirmadas.

**Estado:** aceptada e implementada, 19/10/2026. Reemplaza [ADR-004](ADR-004-consistencia-y-concurrencia.md).

**Referencias:** consistencia en sección 2.8, página 3; fallas de comunicación en sección 2.5, página 2; D4 e historia de decisiones en sección 5, páginas 6–7. El equipo confirmó que una cancelación debe aceptarse aunque Socios esté caído y que debe conservarse la prioridad FIFO.

## Contexto

Cancelar y validar remotamente a todos los candidatos dentro de una transacción prolongaba los bloqueos y podía impedir cancelar ante una caída de Socios. Bloquear primero una reserva en una operación y primero la clase en otra exponía a interbloqueos. La reserva y el ingreso voluntario a espera tampoco debían dejar una ventana donde otro solicitante tomara el cupo.

## Decisión

1. **Escrituras locales atómicas.** Reserva, espera, cancelación y promoción bloquean primero la fila de la clase y luego consultan sus reservas y espera. Capacidad, inicio, duplicados y prioridad se vuelven a comprobar dentro de la transacción. Los índices únicos parciales impiden dos reservas confirmadas o dos esperas pendientes del mismo socio para la misma clase. En memoria se usa exclusión por clase, conservando las mismas reglas.
2. **Validación fuera de los bloqueos.** `ReservasService` consulta Socios para el momento actual y para el inicio de la clase antes de reservar o entrar a espera. Las dos lecturas se ejecutan en paralelo. Una falla remota produce 503 sin confirmar una reserva; una respuesta válida no habilitada produce 422. Una renovación futura no oculta la membresía que cubre el momento actual.
3. **Cancelación local.** Antes del inicio se cancela la reserva aunque Socios no responda. La respuesta incluye `reasignacionPendiente` cuando queda un candidato por evaluar. Una solicitud nueva no puede ocupar el cupo mientras haya espera pendiente; volver a reservar después de cancelar sigue permitido si no perjudica esa prioridad.
4. **Promoción recuperable.** Un trabajador del servidor busca clases futuras con cupo y espera pendiente. Obtiene el primer candidato, valida su membresía fuera de la transacción y vuelve a bloquear la clase para comprobar que sigue siendo el primero, que no comenzó la clase y que existe cupo. Solo entonces confirma la reserva y marca la espera promovida, atómicamente.
5. **Falla versus inhabilitación.** Una falla de red conserva al primero y deja pendiente el trabajo. Una inhabilitación comprobada retira al candidato y evalúa al siguiente. El trabajador se ejecuta al iniciar y cada `RESERVAS_REINTENTO_MS` (5000 ms por defecto); no superpone pasadas en una instancia. Dos instancias pueden procesar lo mismo: la comprobación transaccional evita duplicar la promoción.
6. **Estado durable sin tabla adicional.** La combinación de cupo libre y espera pendiente ya almacenada permite que otra instancia o un proceso reiniciado recupere la tarea. No se incorpora un nuevo broker ni una tabla de tareas para esta recuperación.

## Alternativas y consecuencias

Se descarta rechazar la cancelación por una caída de Socios y se descarta consultar la red bajo un bloqueo SQL. El cupo puede quedar temporalmente sin asignar mientras se recupera Socios; la prioridad se mantiene y la reasignación es eventual. El resultado de validación remota es una comprobación puntual: no existe una transacción distribuida entre ambas bases.

La cancelación automática de reservas por una suspensión posterior de membresía requiere el evento de dominio de D5 y sigue pendiente; no debe confundirse con esta recuperación de promociones.

## Verificación

### Alta externa de empleados

Sin modificar la política de reservas, se concreta otra operación consistente dentro de Socios: el alta externa guarda socio, solicitud pendiente, referencia externa y resultado de idempotencia en una transacción PostgreSQL. Bloqueos consultivos por clave/empleado e índices únicos impiden duplicados entre instancias. Un replay se resuelve antes de comprobar duplicados de negocio; una solicitud nueva en conflicto revierte la transacción sin sobrescribir datos. La estructura y comprobaciones están en [D3](ADR-003-persistencia.md) y [D8](ADR-014-contrato-empleados.md). Se conserva esta decisión; no se reemplaza la política FIFO.

### Vinculación administrativa con Car Cruds

La nueva relación uno a uno se conserva en tablas separadas del alta anterior. El vínculo y su auditoría se escriben en una transacción; un índice único parcial impide compartir socio y el bloqueo por empleado con revisión esperada evita cambios perdidos entre instancias. Quitar el vínculo conserva revisión e historial. La consulta remota ocurre antes de la transacción y la desvinculación no depende de ella. `npm run test:postgres` comprueba carreras, durabilidad y rollback de asociación/auditoría. Detalle en [ADR-018](ADR-018-integracion-car-cruds.md). Esta operación no altera la política FIFO.

### Fotografías Car Cruds

Las fotografías Car Cruds agregan otra operación local en Socios: preparación con fuente y revisión del vínculo bajo transacción, cuerpo inmutable y un reclamo durable antes de HTTP. El lease y su UUID permiten recuperar el mismo mensaje y descartar respuestas tardías entre réplicas. Cambiar un vínculo conserva los recibos y exige revisión explícita para una nueva fotografía. Se verifican rollback de cabecera/fotografía, concurrencia y recuperación en PostgreSQL. La entrega manual de esta integración no utiliza el trabajador FIFO ni altera sus reglas; [ADR-018](ADR-018-integracion-car-cruds.md).

### Reservas y recuperación

Pruebas de aplicación y repositorio en `services/clases-reservas/test/reservas.test.mjs`, concurrencia del último cupo en `test/concurrencia.test.mjs` y flujo en `test/flujo-principal.test.mjs`. `npm run test:postgres` ejecuta HTTP real y dos instancias con pools independientes, comprueba el último cupo y la cancelación con caída/recuperación de Socios, y retira únicamente su contenedor efímero. La reproducción se documenta en README; los resultados de caída y carga están en POSTMORTEM y D13.
