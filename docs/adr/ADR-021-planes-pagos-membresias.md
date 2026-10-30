# ADR-021 — Planes, confirmación manual y habilitación transaccional

**Estado:** implementado para el flujo administrativo definido, 30/10/2026. Amplía D3/D4 y la autenticación de ADR-016; no cambia contratos externos, FIFO, MongoDB ni Redis.

## Fuentes y reglas confirmadas

ALCANCE_PRELIMINAR: ADMIN gestiona planes, registra y confirma pagos y genera comprobantes internos (RF-01–03, RN-G01–04, CA-G01–03). Alta de cuenta no habilita. El socio consulta sus propios datos; no paga ni contrata por autoservicio. No hay pasarela ni factura fiscal. Vigencia aplicable se registra explícitamente y Socios la evalúa tanto ahora como para la fecha de clase (RN-R01). ADR-003 ya conserva períodos históricos y evita que una renovación futura oculte la vigente.

No se encontraron tarifas aprobadas, duración automática por plan, impuestos, promociones, prorrateos, acumulación de días ni política para sustituir/reactivar períodos. No se introducen valores ni reglas comerciales para cubrirlos. El PDF original de WhatsApp ya no existe en su ruta; la revisión usa el alcance vigente y las referencias preservadas, sin afirmar una nueva lectura del PDF.

## Decisión

Conservar Capas en Socios: rutas autenticadas → validación de comandos → repositorio transaccional PostgreSQL. Crear planes mediante ADMIN con nombre, importe entero en unidad mínima y código de moneda reconocido por Intl/ICU del runtime. Sin catálogo/tarifa predeterminados ni conversión. La elección comercial de precio/moneda/unidad corresponde a administración; no se deduce de las tarifas ficticias de tests ni del contrato Car Cruds. Nombre máximo 50 caracteres, compatible con `membresias.tipo_plan` existente. Nombre/precio son inmutables; una tarifa distinta requiere un plan nuevo. Se puede activar/desactivar disponibilidad.

Una solicitud guarda plan, nombre/precio/moneda copiados y fechas RFC3339 normalizadas. No calcula meses. Se admite un pendiente por socio para evitar solicitudes simultáneas ambiguas; es una restricción operativa de esta implementación. Una solicitud rechazada puede reemplazarse por otra conservando historia. Su vencimiento por fechaFin es derivado, no una nueva transición automática.

El administrador registra el pago completo como PENDIENTE con referencia única. El importe y moneda deben coincidir exactamente con la solicitud. Después de verificar el cobro fuera de la aplicación, confirma explícitamente. Esa autorización administrativa es el mecanismo manual definido por el alcance: el sistema no comprueba movimientos bancarios ni ejecuta cobros reales. Una bandera enviada por React no acredita pago. La confirmación requiere cuenta activa, plan activo y período no finalizado; la habilitación conserva fechaInicio/fechaFin y la fecha de inicio puede ser futura.

Confirmar actualiza pago/solicitud y crea una membresía HABILITADA, un comprobante interno y la respuesta idempotente **en la misma transacción**. HABILITADA no equivale a vigente en cualquier fecha: se conserva la evaluación existente. Rechazar una solicitud pendiente rechaza su pago pendiente y no crea membresía. No hay devolución de confirmados.

Para renovación se permite otro período explícito no superpuesto y otra confirmación; la membresía previa permanece. Períodos que se cruzan, incluso con una suspensión, producen `VIGENCIA_REQUIERE_REVISION` sin confirmar ni habilitar. Es un bloqueo conservador ante una política faltante, **no una regla comercial inferida**. No se implementa reactivación, sustitución ni suma de días. Inicio/final inclusivos siguen el evaluador existente: compartir el mismo instante cuenta como superposición.

## Persistencia y concurrencia

- Tablas nuevas: `planes_membresia`, `solicitudes_planes`, `pagos_membresia`, `comprobantes_membresia`, `operaciones_membresia`.
- No se cambia `solicitudes_membresia` del POST externo anterior: su unicidad y estado PENDIENTE se conservan. Las solicitudes nuevas pertenecen al flujo administrativo; no se adjudica una confirmación a los registros externos históricos.
- Claves foráneas; único parcial de solicitud pendiente por socio; un pago por solicitud; referencia global única exacta y sensible a mayúsculas; un comprobante por pago y una membresía por comprobante. Un mismo cobro real ingresado con otra referencia no puede detectarse automáticamente: responsabilidad del operador, sin conciliación bancaria.
- Bloqueo consultivo por actor/clave y fila de socio `FOR UPDATE`. Las instancias vuelven a leer el estado después de bloquear; se serializan confirmación, rechazo y nueva solicitud del mismo socio. El plan se lee con `FOR SHARE` dentro de la operación. La transacción vuelve a verificar ADMIN activo; autenticación también consulta la identidad real en Socios.
- Idempotencia por actor y clave de 8–128 caracteres, compartida entre todos los comandos. Cuerpo normalizado, comando e identificadores forman el contenido. Repetir una operación confirmada conserva respuesta original; cambiar contenido/ruta con esa clave produce 409. Errores anteriores al commit revierten también el registro de clave; no hay efectos parciales y puede reintentarse. El historial de resultados exitosos no se purga automáticamente.
- La confirmación ya aplicada puede consultarse con otra clave sin crear otra membresía/recibo. Dos claves distintas no eluden restricciones de negocio. Las garantías se refieren al estado registrado en PostgreSQL; no revierten dinero gestionado fuera del sistema.

Migración aditiva integrada al inicializador existente bajo `pg_advisory_xact_lock(1002)`: CREATE TABLE/INDEX IF NOT EXISTS dentro de la transacción; sin DROP, truncado o reparación de datos existentes. Se ensayan base vacía, dos inicializadores, actualización desde el DDL real de `db13cee` y repetición sin alterar socio, membresía o solicitud externa de prueba. La inicialización histórica de cuentas demo sigue existente, sin cambiar sus IDs ni reescribir contraseñas; el flujo nuevo no depende de ellas. El arranque requiere los permisos DDL ya usados por el servicio. En memoria la nueva capacidad no está habilitada: responde 503 explícito, sin simular pagos.

## HTTP, interfaz y observabilidad

[OpenAPI propio](../contracts/openapi-membresias-v1.yaml). Gateway enruta planes/solicitudes/pagos a Socios sin reintento de esos upstreams; no cambia APIs externas. Se conserva y no se usa la ruta antigua `POST /socios/:id/membresias`, que rechaza activación directa. No se pasa una membresía activa como cuerpo arbitrario.

El panel muestra socios, planes, solicitudes, pago pendiente/rechazado y comprobante interno. Confirmar exige una acción explícita tras verificar el cobro. SessionStorage conserva por actor una sola operación incierta (ruta/cuerpo/clave, sin JWT), para repetirla después de recargar/iniciar sesión. Tras resolver, vuelve a consultar al servidor; un replay histórico no se interpreta como estado actual. Las respuestas inválidas o errores de red nunca se muestran como confirmación. El socio sólo consulta su historial; no hay botones de pago administrativo.

`membresias_operaciones_total` distingue resuelta, repetida y fallida, por comando/servicio/instancia, sin etiquetas por socio o clave. Logs de petición con traza incluyen comando, repetición, solicitud/plan y estado; no importes ni credenciales. Los fallos de persistencia y rechazos se registran. No hay tablero nuevo.

## Límites conservados

No se implementa RabbitMQ. La suspensión posterior aún no cancela reservas futuras (RN-R08/CA-R09). Clases sigue consultando HTTP antes de reservar y conserva FIFO. Car Cruds mantiene sus APIs y sus hechos de costo/pagos desconocidos: tener registros de cobro no define imputación mensual, monedas o devoluciones del intercambio. No se completa esa integración por inferencia. No se implementan Tienda/FAV, impuestos, pasarela, conciliación o facturación fiscal.

Pruebas y decisiones aún abiertas: [EVIDENCIA-MEMBRESIAS](../EVIDENCIA-MEMBRESIAS.md).
