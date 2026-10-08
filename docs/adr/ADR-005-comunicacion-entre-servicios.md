# D5 - Comunicación entre servicios

**Estado:** propuesta inicial para la Entrega 1.  
**Fecha:** 07/10/2026.

## Requisito del enunciado

- **Sección 5, página 6:** D5 debe justificar comunicación síncrona y asíncrona, tiempos de espera, reintentos, eventos e idempotencia.
- **Sección 6.2, página 8:** la Entrega 1 requiere una versión inicial de D5.
- **Sección 2.5, página 2:** exige ambas comunicaciones, tratamiento de respuestas tardías o ausentes y publicación/consumo de un evento de dominio con manejo de mensajes fallidos.

HTTP con JSON y RabbitMQ son decisiones propuestas para satisfacer esos requisitos. Este ADR describe el diseño inicial; su funcionamiento se verificará al implementar los servicios.

## Comunicación síncrona: HTTP con JSON

Los servicios llaman directamente a las interfaces de sus dependencias. El API Gateway dirige solicitudes del frontend y del consumidor de nuestra capacidad publicada.

| Consumidor | Proveedor | Consulta necesaria |
|---|---|---|
| Clases y Reservas | Socios y Membresías | Habilitación actual y vigencia para el inicio de la clase al reservar, ingresar voluntariamente a espera y evaluar una promoción. La respuesta identifica la membresía y la versión de su estado utilizada. |
| Accesos y Ocupación | Socios y Membresías | Habilitación actual para aceptar un ingreso. El egreso se resuelve con el ingreso abierto del propio servicio. |
| Clases y Reservas | Accesos y Ocupación | Existencia y datos de la sede al publicar una clase. |
| Microservicio del grupo consumidor | Nuestra capacidad de Clases y Reservas, mediante nuestro API Gateway | Las dos consultas definidas en el [contrato publicado](../contracts/README.md). El grupo todavía no fue asignado. |

Nuestro consumo de una capacidad externa se definirá cuando se conozca el proveedor. Se iniciará desde el microservicio responsable del flujo que la utilice, como exige la sección 4.1, página 5.

### Tiempo de espera, errores y reintentos

Para las consultas HTTP internas se propone un **plazo total de 3 segundos**, incluyendo como máximo **un reintento**, con una espera de **100 ms** si todavía queda presupuesto. Cada intento queda limitado por el tiempo restante del plazo total. Son parámetros iniciales de diseño, configurables y sujetos a validación; no son valores impuestos por la cátedra ni resultados de mediciones.

- Reintentar únicamente consultas de lectura ante fallas de conexión o respuestas temporales `502`, `503` o `504`, dentro del plazo disponible. No repetir automáticamente errores de datos, autenticación o una respuesta válida que indique falta de habilitación.
- Al agotarse el plazo, finalizar con un error temporal. Una respuesta posterior no cambia el resultado de esa solicitud ni habilita una operación descartada.
- Una respuesta ausente, inválida o incompleta no se interpreta como autorización. Sin validación confiable no se confirma una nueva reserva ni se acepta un ingreso.
- No repetir automáticamente escrituras cuyo resultado sea desconocido. La idempotencia y la consulta del resultado de pagos, reservas o movimientos se precisarán en D4.
- Si falla la consulta de membresía al promover desde espera, conservar la persona y la reasignación pendiente. No retirarla como si fuera inválida ni permitir que otra solicitud se adelante. Reintentar la tarea al recuperarse la dependencia y verificar nuevamente que la clase no haya comenzado.
- La cancelación ya registrada puede completarse dejando la reasignación pendiente. El cupo conserva la prioridad de la lista de espera durante esa recuperación.

## Comunicación asíncrona: RabbitMQ

El evento inicial será **`MembresiaActualizada`**, versión de formato **1**. Socios y Membresías lo publica cuando cambia el estado o la vigencia que determina la habilitación. Clases y Reservas lo consume para cancelar reservas futuras afectadas y dejar sus cupos listos para reasignar según las reglas confirmadas.

Su contenido incluirá identificador de evento (`eventId`), versión del formato, `socioId`, membresía afectada, secuencia de cambios por socio, instante del cambio y estado/fechas de vigencia anteriores y posteriores. Esa información permite distinguir las transiciones y las reservas afectadas; la consulta de candidatos a promoción continúa siendo síncrona.

El vencimiento por paso del tiempo requiere detección: Socios y Membresías evaluará las fechas en cada consulta y tendrá una tarea periódica que registre vencimientos y sus avisos, recuperando los pendientes al reiniciar. El intervalo de esa tarea se fijará al implementar y validar D5; la tarea no reemplaza la comprobación de fechas al reservar o ingresar.

### Publicación, consumo e idempotencia

1. **Guardar el aviso junto al cambio:** Socios y Membresías registra el cambio y su evento pendiente en una misma transacción PostgreSQL. Ese registro de salida, denominado *outbox*, permite publicar después de confirmar los datos y recuperar avisos si el proceso o RabbitMQ falla.
2. **Confirmar la publicación:** un publicador envía mensajes persistentes a una cola durable, utiliza confirmaciones del broker y detecta mensajes sin cola de destino. Solo entonces marca el aviso como publicado. Ante una falla o confirmación ausente conserva el evento pendiente y reintenta con espera creciente; puede publicarlo otra vez con el mismo `eventId`.
3. **Registrar el consumo:** Clases y Reservas conserva un registro de recepción/procesamiento, denominado *inbox*. Aplica las cancelaciones afectadas y registra las reasignaciones pendientes y el evento procesado en una misma transacción local. Un `eventId` ya procesado no repite esos efectos.
4. **Confirmar después de guardar:** se confirma el mensaje al broker (*ACK*) después de confirmar la transacción. Si el proceso cae antes del ACK, la repetición se reconoce por `eventId`.

Se diseña para entrega **al menos una vez** con efectos idempotentes. Las confirmaciones del publicador y del consumidor cubren etapas distintas; no equivalen a una transacción entre ambos servicios. Véanse [RabbitMQ: confirmaciones](https://www.rabbitmq.com/docs/confirms) y [patrón outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html).

### Orden y mensajes fallidos

- Procesar las transiciones por socio en orden de secuencia. El publicador preservará ese orden; inicialmente se propone una cola con un consumidor activo y una entrega pendiente por vez. El control de secuencia sigue siendo necesario ante reintentos y recuperaciones.
- Una secuencia adelantada se guarda como pendiente en la inbox antes de confirmar su recepción al broker; un trabajador la aplicará cuando se recuperen y procesen sus predecesoras. Guardarla no equivale a marcarla como procesada. No se descarta una suspensión pendiente porque haya llegado un estado posterior: eso podría omitir una cancelación exigida por negocio. Los detalles de coordinación con reservas concurrentes se resolverán en D4.
- Para errores transitorios de procesamiento se propone un intento inicial y hasta **3 reintentos**, con esperas de **1, 5 y 15 segundos**. Estos valores son configurables y se revisarán con la implementación.
- Un mensaje inválido, incompatible o que agote esos intentos se conserva en una cola de mensajes fallidos junto con el motivo. La transferencia a esa cola debe confirmarse antes de liberar el original; no se presume que una configuración básica de descarte sea suficiente para evitar pérdidas.
- Las transiciones posteriores del mismo socio quedan pendientes si falta una anterior. La recuperación debe reprocesar la secuencia fallida; trasladarla a la cola de fallidos no significa haber aplicado su efecto.
- El registro durable de recepción debe diferenciar pendiente, fallido y procesado; solo procesado permite omitir una repetición. El contador de intentos se conserva durante la recuperación.

Referencia técnica: [orden de mensajes en RabbitMQ](https://www.rabbitmq.com/docs/queues#message-ordering). La espera por mensajes fallidos puede retrasar cancelaciones y se debe hacer visible durante la implementación.

## Alternativas y limitaciones

- Se usa HTTP para decisiones que necesitan una respuesta al ejecutar la operación. Se usa mensajería para propagar cambios de membresía y recuperarlos tras una interrupción.
- Usar solo HTTP o solo mensajería no cubre la exigencia de ambas comunicaciones. Las consultas y el evento anterior les dan un uso dentro de los flujos del gimnasio.
- RabbitMQ requiere configuración y persistencia; outbox e inbox agregan registros y tareas de recuperación. Se proponen para tratar fallas entre guardar, enviar y aplicar un cambio.
- La cancelación por evento tiene una ventana de propagación. HTTP y las transacciones locales no hacen atómica la validación de membresía con la reserva en otro servicio. D4 deberá concretar esa coordinación, el tratamiento de eventos respecto de nuevas reservas y las garantías ante concurrencia; no se promete resolución instantánea con este diseño inicial.
- La estructura inicial levanta RabbitMQ 4.1 con credenciales fuera del repositorio y volumen persistente. Declara las URLs internas entre servicios; todavía no publica ni consume eventos. Contratos HTTP internos, formato procesable del evento y configuración concreta de colas se completarán al implementar. El proveedor externo sigue pendiente. D5 se validará en la Entrega 2 según la sección 6.3, página 8.
