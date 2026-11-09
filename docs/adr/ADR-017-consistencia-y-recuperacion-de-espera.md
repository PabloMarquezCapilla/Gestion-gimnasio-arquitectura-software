# D4 - Consistencia y recuperación de la lista de espera

**Ampliación independiente, 30/10/2026:** [ADR-019](ADR-019-accesos-mongodb-recepcion.md) concreta consistencia de Accesos: serialización por socio/sede y transacción MongoDB de presencia, movimiento e idempotencia. No cambia la política FIFO ni PostgreSQL. Un replay tardío no reabre presencias; ocupación deriva de presencias confirmadas.

**Estado:** aceptada e implementada, 19/10/2026. Reemplaza [ADR-004](ADR-004-consistencia-y-concurrencia.md).

**Ampliación de retiro voluntario, 08/11/2026.** Implementado por propietario o ADMIN, antes del inicio, con exclusión por clase y conservación del historial. La promoción ganadora se informa para una cancelación explícita de la reserva.

**Referencias:** consistencia en sección 2.8, página 3; fallas de comunicación en sección 2.5, página 2; D4 e historia de decisiones en sección 5, páginas 6–7. El equipo confirmó que una cancelación debe aceptarse aunque Socios esté caído y que debe conservarse la prioridad FIFO.

## Contexto

Cancelar y validar remotamente a todos los candidatos dentro de una transacción prolongaba los bloqueos y podía impedir cancelar ante una caída de Socios. Bloquear primero una reserva en una operación y primero la clase en otra exponía a interbloqueos. La reserva y el ingreso voluntario a espera tampoco debían dejar una ventana donde otro solicitante tomara el cupo.

## Decisión

1. **Escrituras locales atómicas.** Reserva, espera y promoción serializan por socio antes de bloquear clase, para coordinarse con el evento de suspensión concretado en D5 el 07/11/2026. La cancelación conserva su bloqueo local de clase. Se revalidan capacidad, inicio, proyección de suspensión, duplicados y prioridad dentro de la transacción. Los índices únicos parciales impiden duplicados activos. En memoria las pruebas HTTP conservan exclusión por clase y la mensajería operativa exige PostgreSQL.
2. **Validación fuera de los bloqueos.** `ReservasService` consulta Socios para el momento actual y para el inicio de la clase antes de reservar o entrar a espera. Las dos lecturas se ejecutan en paralelo. Una falla remota produce 503 sin confirmar una reserva; una respuesta válida no habilitada produce 422. Una renovación futura no oculta la membresía que cubre el momento actual.
3. **Cancelación local.** Antes del inicio se cancela la reserva aunque Socios no responda. La respuesta incluye `reasignacionPendiente` cuando queda un candidato por evaluar. Una solicitud nueva no puede ocupar el cupo mientras haya espera pendiente; volver a reservar después de cancelar sigue permitido si no perjudica esa prioridad.
4. **Promoción recuperable.** Un trabajador del servidor busca clases futuras con cupo y espera pendiente. Obtiene el primer candidato, valida su membresía fuera de la transacción y vuelve a bloquear la clase para comprobar que sigue siendo el primero, que no comenzó la clase y que existe cupo. Solo entonces confirma la reserva y marca la espera promovida, atómicamente.
5. **Falla versus inhabilitación.** Una falla de red conserva al primero y deja pendiente el trabajo. Una inhabilitación comprobada retira al candidato y evalúa al siguiente. El trabajador se ejecuta al iniciar y cada `RESERVAS_REINTENTO_MS` (5000 ms por defecto); no superpone pasadas en una instancia. Dos instancias pueden procesar lo mismo: la comprobación transaccional evita duplicar la promoción.
6. **Estado durable sin tabla adicional.** La combinación de cupo libre y espera pendiente ya almacenada permite que otra instancia o un proceso reiniciado recupere la tarea. No se incorpora un nuevo broker ni una tabla de tareas para esta recuperación.

## Retiro voluntario de espera

`ReservasService.retirarEspera` delega al repositorio local y recibe el reloj de aplicación. Ambos adaptadores, memoria y PostgreSQL, usan el bloqueo existente por clase. PostgreSQL vuelve a leer la entrada bajo bloqueo de fila, y actualiza su estado a `CANCELADO` y su fecha de modificación en una transacción. Conserva ID, orden y fechas históricas. El retiro puede completarse con Socios indisponible.

La autorización HTTP comprueba JWT y propietario de la entrada, con excepción ADMIN. La entrada debe pertenecer a la clase de la ruta. La operación apunta al ID de la espera. Una repetición cancelada devuelve el estado cerrado, aun después del inicio. Una inscripción posterior tiene otro ID y un orden nuevo, por lo que repetir el retiro anterior no la afecta.

Si una evaluación de membresía terminó después del retiro, `aplicarEvaluacionEspera` vuelve a comprobar al primero y descarta ese candidato. El trabajador continúa con el siguiente manteniendo FIFO. Si hay cupo y otro candidato, la respuesta indica `reasignacionPendiente` para el trabajador existente. Cuando se retira el último pendiente, la lectura de disponibilidad vuelve a permitir reserva directa si hay capacidad.

Si la promoción ganó el bloqueo, el retiro devuelve 409 `ESPERA_PROMOVIDA`, con la reserva confirmada actual cuando exista. La reserva conserva su estado. El portal avisa, actualiza las inscripciones y abre «Mis Reservas». «Cancelar reserva» exige una nueva acción del usuario y conserva el límite temporal existente. [Contrato interno 1.2.0 y uso](../contracts/README.md#retirarse-de-la-lista-de-espera).

## Alternativas y consecuencias

Se descarta rechazar la cancelación por una caída de Socios y se descarta consultar la red bajo un bloqueo SQL. El cupo puede quedar temporalmente sin asignar mientras se recupera Socios; la prioridad se mantiene y la reasignación es eventual. El resultado de validación remota es una comprobación puntual: no existe una transacción distribuida entre ambas bases.

La suspensión administrativa y su evento de D5 se concretaron el 07/11/2026. Clases cancela las reservas futuras afectadas junto con Inbox y recupera sus cupos mediante este mismo trabajador FIFO. [Contrato y operación](../contracts/membresias-eventos.md), [evidencia](../EVIDENCIA-EVENTOS-MEMBRESIA.md).

## Verificación

### Alta externa de empleados

Sin modificar la política de reservas, se concreta otra operación consistente dentro de Socios: el alta externa guarda socio, solicitud pendiente, referencia externa y resultado de idempotencia en una transacción PostgreSQL. Bloqueos consultivos por clave/empleado e índices únicos impiden duplicados entre instancias. Un replay se resuelve antes de comprobar duplicados de negocio; una solicitud nueva en conflicto revierte la transacción sin sobrescribir datos. La estructura y comprobaciones están en [D3](ADR-003-persistencia.md) y [D8](ADR-014-contrato-empleados.md). Se conserva esta decisión; no se reemplaza la política FIFO.

### Vinculación administrativa con Car Cruds

La nueva relación uno a uno se conserva en tablas separadas del alta anterior. El vínculo y su auditoría se escriben en una transacción; un índice único parcial impide compartir socio y el bloqueo por empleado con revisión esperada evita cambios perdidos entre instancias. Quitar el vínculo conserva revisión e historial. La consulta remota ocurre antes de la transacción y la desvinculación no depende de ella. `npm run test:postgres` comprueba carreras, durabilidad y rollback de asociación/auditoría. Detalle en [ADR-018](ADR-018-integracion-car-cruds.md). Esta operación no altera la política FIFO.

### Fotografías Car Cruds

Las fotografías Car Cruds agregan otra operación local en Socios: preparación con fuente y revisión del vínculo bajo transacción, cuerpo inmutable y un reclamo durable antes de HTTP. El lease y su UUID permiten recuperar el mismo mensaje y descartar respuestas tardías entre réplicas. Cambiar un vínculo conserva los recibos y exige revisión explícita para una nueva fotografía. Se verifican rollback de cabecera/fotografía, concurrencia y recuperación en PostgreSQL. La entrega manual de esta integración no utiliza el trabajador FIFO ni altera sus reglas; [ADR-018](ADR-018-integracion-car-cruds.md).

### Reservas y recuperación

Pruebas de aplicación y repositorio en `services/clases-reservas/test/reservas.test.mjs`, concurrencia del último cupo en `test/concurrencia.test.mjs` y flujo en `test/flujo-principal.test.mjs`. `npm run test:postgres` ejecuta HTTP real y dos instancias con pools independientes, comprueba el último cupo y la cancelación con caída/recuperación de Socios, y retira únicamente su contenedor efímero. La reproducción se documenta en README; los resultados de caída y carga están en POSTMORTEM y D13.

### Verificación de retiro voluntario

`npm test` aprobó **239 pruebas**, incluidas **54 del cliente web**, y la compilación frontend aprobó **37 módulos**. Se añadieron seis pruebas de aplicación/API en memoria y tres del cliente para retiro, historial, límite exacto, reintentos, nueva inscripción, promoción y autorización. El cliente valida la confirmación `CANCELADO`, su clase e ID, y conserva el conflicto de promoción para actualizar la vista.

`npm run test:gestion-clases` aprobó **17 pruebas** con PostgreSQL, Accesos/MongoDB y Socios HTTP reales y dos instancias de Clases. Cinco escenarios adicionales verifican los siguientes resultados.

- Veinte retiros concurrentes por las dos instancias producen el mismo resultado, con autorización de propietario/ADMIN y rechazo de clase incorrecta. El replay sobrevive a recrear la aplicación y conserva otra inscripción posterior. Una pendiente al inicio exacto se rechaza.
- Retirar al candidato ya evaluado descarta esa evaluación y permite promover al siguiente mediante el trabajador real, conservando la prioridad frente a nuevas reservas.
- Una transacción del fixture mantiene una promoción sin commit mientras el retiro HTTP espera el bloqueo de clase. Al confirmar, el retiro informa el conflicto y conserva la reserva. Sólo una cancelación explícita posterior la modifica.
- Un trigger de fallo del fixture obliga a revertir la actualización. La entrada queda pendiente y el reintento del mismo ID completa el retiro.
- Se cierra la API real de Socios y se cancela/retira localmente. Al quedar cupo sin candidatos pendientes, la consulta de catálogo informa disponibilidad directa.

Estos ensayos usan datos ficticios y bases exclusivas temporales. La ventana de promoción y el trigger de fallo pertenecen al fixture de pruebas.

Chrome comprobó el retiro desde el catálogo y «Mis Reservas» contra los servicios reales y bases temporales. El fixture interrumpió una respuesta después del commit y la actualización de pantalla recuperó el estado cancelado. Tres inscripciones sucesivas conservaron IDs distintos y órdenes 1, 2 y 3. También adelantó la ejecución del trabajador real al retiro para reproducir una promoción ganadora. El POST respondió 409, el portal mostró la reserva confirmada y sólo una acción posterior de «Cancelar reserva» la canceló. El estado final de PostgreSQL confirmó las tres esperas canceladas y la reserva cancelada explícitamente.

`npm run test:balanceo` verificó por NGINX retiro, replay, rechazo de otro propietario y conservación de la reserva existente, con dos réplicas de Clases. El ensayo completo volvió a observar cuatro respuestas 504 transitorias durante la detección pasiva de una réplica detenida. Después, la réplica restante atendió 40 de 40 solicitudes. Las rondas inicial y final también atendieron 40 de 40, con distribución final 20/20. Esta limitación de la transición queda pendiente para la revisión de fallas del paso 8.

El navegador, los servidores y los contenedores temporales de estos recorridos se cerraron al terminar. Los cambios se conservan en `feat/membresias-eventos`; la apertura de PR queda pendiente por decisión del equipo.

La revisión documental comprobó 36 archivos Markdown y 280 enlaces locales, sin destinos ausentes. El OpenAPI interno 1.2.0 tiene 48 referencias resueltas, nueve esquemas compilados y tres ejemplos válidos. `git diff --check` aprobó y `.env` continúa ignorado.

### Planes y pagos manuales — etapa 3

[ADR-021](ADR-021-planes-pagos-membresias.md) conserva pago, comprobante, membresía y resultado juntos. Las validaciones HTTP de Clases continúan. D5 concreta además suspensiones mediante Outbox/RabbitMQ/Inbox, sin transacción distribuida y con la prioridad FIFO existente.
