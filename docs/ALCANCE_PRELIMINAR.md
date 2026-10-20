# Alcance del sistema

Este documento registra las funcionalidades, reglas de negocio y criterios de aceptación del dominio aprobado por la cátedra. Conserva el alcance de E1 e incorpora las integraciones asignadas y las reglas confirmadas por el equipo. Es el artefacto equivalente a SPEC previsto en §3, página 4.

El alcance describe el sistema objetivo; no implica que todas sus funciones estén implementadas. El estado disponible y sus limitaciones se mantienen en [ARCHITECTURE.md](ARCHITECTURE.md#limitaciones-conocidas-y-deuda-técnica-aceptada). Las integraciones siguen §4.1, páginas 5–6; los campos y políticas concretos son acuerdos del proyecto.

## Problema

Un gimnasio necesita centralizar la administración de sus socios y, al mismo tiempo, controlar operaciones que tienen impacto directo en el negocio: vigencia de membresías, pagos, reservas de clases con capacidad limitada e ingresos a las sedes.

Una solución limitada únicamente a un CRUD de membresías no alcanza para representar estos flujos. Por eso, el dominio se amplía a un sistema integral de gestión del gimnasio.

## Actores

### Socio
Puede consultar su membresía, buscar clases, reservar o cancelar actividades, elegir ingresar a una lista de espera y consultar el estado de sus operaciones. El alcance actualizado incorpora la consulta de productos y stock de la tienda.

### Administrador
Administra socios y membresías, registra y confirma los pagos y genera sus comprobantes internos. También gestiona planes, clases y sedes y consulta información operativa del gimnasio.

Las altas internas requieren un administrador; no hay autorregistro público. El administrador inicial se crea mediante comando local. El alta crea la cuenta sin habilitar membresía; el pago correspondiente es necesario para su habilitación. El POST externo de empleados es una capacidad distinta, con las reglas indicadas más abajo.

### Personal de recepción
Valida el acceso de los socios y registra sus ingresos y egresos desde la aplicación. Puede consultar el estado de una membresía cuando sea necesario. La primera versión no utiliza dispositivos físicos para registrar esos movimientos.

### Grupo consumidor de membresías para empleados
Envía los datos de un empleado mediante el POST publicado por el gimnasio. Se identifica por una credencial del grupo y obtiene el resultado del alta del socio y de su solicitud pendiente. No elige el plan ni confirma pagos mediante esta capacidad.

### Distribuidora proveedora
Provee la información de productos y stock que consultará la tienda. Todavía no se dispone de su identificación, contrato ni datos de conexión.

## Capacidades principales

### Membresías
- Alta de membresía.
- Renovación.
- Suspensión.
- Vencimiento.
- Validación de vigencia y habilitación.

Una membresía nueva o renovada se habilita al confirmar el pago correspondiente. Su uso depende también de su vigencia registrada; una suspensión impide utilizarla mientras deje de estar habilitada.

Para las reservas de la primera versión, todas las membresías vigentes y habilitadas permiten cualquier clase y sede. No se incorporan restricciones adicionales por plan, cantidad de reservas o superposición de horarios.

### Pagos y comprobantes internos
- Registro y confirmación de pagos.
- Evitar duplicación de operaciones.
- Asociación entre pago, socio y membresía.
- Generación de un comprobante interno asociado al pago.

El administrador registra los pagos desde la aplicación. El comprobante es un registro interno del sistema, sin integración con una pasarela de pagos ni con un sistema de facturación fiscal real.

La confirmación del pago asociado al alta o a la renovación habilita la membresía correspondiente de acuerdo con su vigencia registrada. Un mismo pago confirmado no puede registrarse dos veces ni aplicar dos veces sus efectos.

### Clases y reservas
- Publicación de clases y horarios.
- Capacidad máxima.
- Reserva y cancelación.
- Lista de espera.
- Reasignación de cupos.

### Búsqueda
La entidad principal para la búsqueda será **Clase/Actividad**.

Criterios preliminares:
- texto: nombre o tipo de actividad;
- sede;
- profesor;
- día;
- franja horaria;
- disponibilidad;
- nivel o categoría.

La búsqueda deberá admitir paginación y ordenamiento.

### Control de acceso y ocupación
Cada intento de ingreso validará el estado de la membresía. Recepción registra los ingresos y egresos desde la aplicación. El sistema registra el resultado del acceso y mantiene información de ocupación de la sede.

Los ingresos y egresos deben alternarse por socio y sede: no se admite un segundo ingreso sin una salida intermedia ni una salida sin un ingreso abierto. La ocupación de una sede corresponde a la cantidad de socios con un ingreso aceptado que todavía no tiene una salida asociada. Un movimiento rechazado no modifica esa ocupación.

No se incluyen lectores, molinetes ni otros dispositivos físicos en esta versión.

### Integración: membresías para empleados

La capacidad ofrecida al otro grupo pasa a ser **recibir empleados mediante `POST /api/v1/integraciones/empleados`**, a cargo de Socios y Membresías. Reemplaza la consulta de clases y cupos como capacidad compartida. Clases y reservas continúan dentro del dominio del gimnasio.

Reglas confirmadas por el equipo:

- Se reciben `empleadoExternoId`, `dni`, `nombre` y `email`. El grupo de origen se obtiene de su credencial `X-API-Key`, no del cuerpo de la solicitud.
- Un alta aceptada crea al socio y una **solicitud de membresía `PENDIENTE`**. El administrador elige el plan y confirma el pago correspondiente antes de habilitar la membresía.
- La solicitud pendiente es distinta de una membresía habilitada. El POST no asigna plan, vigencia, contraseña ni permisos de administrador.
- Un DNI o email ya registrado produce un conflicto, sin modificar al socio ni su membresía.
- `Idempotency-Key` permite repetir la misma solicitud del mismo grupo y obtener el alta original, sin crear otro socio ni otra solicitud. Reutilizar la clave con otros datos o registrar el mismo identificador de empleado con otro DNI produce un conflicto.
- Se utilizarán datos ficticios. La definición de credenciales de acceso personal de estos socios queda pendiente; esta capacidad no entrega sesiones de usuario.

El contrato y sus ejemplos se publican en [la guía de integración](contracts/README.md). El alta persistente está disponible en el gateway local y conserva la idempotencia en PostgreSQL; el mock separado se mantiene en memoria. La selección del plan, confirmación del pago y acceso personal del empleado siguen pendientes: este POST no los implementa ni simula una membresía habilitada.

### Integración: tienda de consulta

El socio podrá consultar los productos y el stock publicados por la distribuidora. El alcance confirmado es de **solo consulta**, sin compras, pedidos ni reposición.

El equipo confirmó un **servicio Tienda separado**, sin una base de datos nueva, que iniciará la comunicación con la distribuidora conforme a la sección 4.1 del enunciado. Su responsabilidad se documenta en [D1, ADR-015](adr/ADR-015-limites-con-tienda.md). Productos y stock seguirán siendo datos del proveedor. La estructura propia está preparada; el cliente externo depende del contrato de la distribuidora.

**Estado de integración:** el equipo confirmó que aún no dispone del contrato ni los datos de conexión. Quedan preparados el servicio, gateway y pestaña Tienda del portal; la consulta informa integración pendiente sin mostrar productos ficticios ni existencias en cero. RF-11/CA-G11 no quedan satisfechos hasta conectar y verificar la capacidad real del proveedor. Compras, pedidos y reposición continúan fuera del alcance acordado.

El contrato externo, sus operaciones concretas, los datos de conexión y su comportamiento ante fallas se acordarán antes de implementar esa integración. No se presupone una API del proveedor ni se incorpora un almacenamiento local de productos o existencias.

Los datos de prueba serán ficticios; está pendiente confirmar si esa condición continuará durante toda la evaluación.

## Requisitos funcionales de la primera versión

| Identificador | Requisito |
|---|---|
| RF-01 | El administrador puede administrar los socios del gimnasio. |
| RF-02 | El administrador puede gestionar planes y membresías, incluyendo alta, renovación y suspensión; el sistema reconoce su vencimiento y valida su vigencia y habilitación. |
| RF-03 | El administrador puede registrar y confirmar pagos vinculados a un socio y una membresía, con un comprobante interno y sin duplicar el pago ni sus efectos. |
| RF-04 | El administrador puede publicar clases con sede, horario y capacidad máxima. |
| RF-05 | El socio puede consultar su membresía y el estado de sus reservas. |
| RF-06 | El socio puede buscar clases por los criterios del apartado Búsqueda, con paginación y ordenamiento. |
| RF-07 | El socio puede reservar y cancelar clases o elegir ingresar a una lista de espera según las reglas de CU-01. |
| RF-08 | Recepción puede registrar intentos de ingreso y egresos de una sede desde la aplicación, validando la membresía y la alternancia de los movimientos. |
| RF-09 | El sistema permite consultar la ocupación actual por sede a partir de los ingresos aceptados y sus egresos. |
| RF-10 | El grupo consumidor puede enviar un empleado para crear un socio y una solicitud de membresía pendiente, respetando autenticación, ausencia de duplicados e idempotencia. |
| RF-11 | El socio puede consultar los productos y el stock de la distribuidora desde la tienda, conforme al contrato externo que se acuerde. |

## Reglas de negocio generales

| Identificador | Regla |
|---|---|
| RN-G01 | La administración de socios y membresías y el registro de pagos corresponden al administrador en la primera versión. El socio consulta su membresía y gestiona sus reservas. |
| RN-G02 | El alta o la renovación de una membresía requiere la confirmación del pago correspondiente para habilitar su uso, respetando su vigencia registrada. |
| RN-G03 | Un pago confirmado no puede registrarse dos veces ni producir dos veces los efectos de habilitación o renovación. |
| RN-G04 | Los comprobantes de pago son internos y no representan facturas fiscales reales. |
| RN-G05 | Un ingreso solo se acepta si la membresía está vigente y habilitada. |
| RN-G06 | Por socio y sede, un ingreso aceptado requiere que no exista otro ingreso abierto; un egreso aceptado requiere que exista un ingreso abierto. |
| RN-G07 | La ocupación por sede se calcula con los socios que tienen un ingreso aceptado sin una salida asociada; no puede resultar negativa. |
| RN-G08 | Un ingreso o egreso rechazado no cambia la ocupación de la sede. |
| RN-G09 | El alta externa de un empleado no habilita una membresía: el administrador selecciona el plan y confirma el pago. |
| RN-G10 | El alta externa rechaza DNI o email existentes sin sobrescribir datos; una repetición idempotente devuelve el resultado original. |
| RN-G11 | El grupo de origen de un empleado se identifica por su credencial, no por un dato enviado en el cuerpo. |

## Criterios de aceptación de las capacidades generales

| Identificador | Condiciones y acción | Resultado esperado |
|---|---|---|
| CA-G01 | El administrador registra un alta o una renovación de membresía y confirma su pago. | Se registra el pago, se genera un comprobante interno y se habilita la membresía según su vigencia. Mientras el pago no esté confirmado, esa operación no genera una nueva habilitación ni una extensión efectiva de vigencia. |
| CA-G02 | Se intenta procesar nuevamente un pago confirmado. | No se duplica el pago, el comprobante ni su efecto sobre la membresía. |
| CA-G03 | El administrador registra socios, planes y membresías; el socio consulta su membresía y sus reservas. | Los registros conservan sus asociaciones y el socio obtiene la información correspondiente a sus propios registros. |
| CA-G04 | Se publica una clase y el socio busca aplicando filtros, paginación y un criterio de ordenamiento admitido. | Tras la sincronización del índice, la clase aparece si cumple los filtros; los resultados respetan la página y el orden solicitados. |
| CA-G05 | Recepción registra un ingreso. | Se acepta y aumenta la ocupación en una persona solo si la membresía está vigente y habilitada y no existe un ingreso abierto en esa sede. Los intentos rechazados no incrementan la ocupación. |
| CA-G06 | Recepción registra una salida. | Se cierra el ingreso abierto y la ocupación disminuye en una persona; una salida sin ingreso abierto se rechaza y no altera la ocupación. |
| CA-G07 | Se consulta la ocupación de una sede. | El valor corresponde a los socios con ingreso abierto de esa sede y nunca es negativo. |
| CA-G08 | Un grupo autenticado envía los cuatro datos válidos de un empleado nuevo con una clave de idempotencia. | Se crean un socio y una solicitud pendiente; la respuesta no indica una membresía habilitada. |
| CA-G09 | Se repite la misma solicitud con la misma clave y el mismo grupo de origen. | Se devuelve el resultado original, con los mismos identificadores y sin duplicar el alta. |
| CA-G10 | El DNI o email ya existe; la clave de idempotencia se reutiliza con otros datos; o el identificador del empleado se reutiliza con otro DNI. | Se informa el conflicto sin modificar datos ni crear una segunda solicitud. |
| CA-G11 | El socio consulta la tienda y el proveedor responde conforme al contrato que se acuerde. | Se muestran los productos y el stock obtenidos del proveedor. El tratamiento de fallas queda pendiente de acordar para la integración. |

La actualización transaccional del índice y la propuesta de vigencia de caché se documentan en D6/D7; la caché aún requiere validación de negocio y medición. Este alcance no establece valores numéricos que todavía no fueron acordados.

## Datos y persistencia preliminar

### Relacional
Adecuado para:
- socios;
- planes;
- membresías;
- pagos;
- comprobantes internos;
- clases;
- reservas;
- lista de espera.

Motivo: relaciones fuertes, restricciones, integridad y necesidad de operaciones transaccionales.

### No relacional
Adecuado para:
- eventos de acceso;
- historial de asistencia;
- eventos operativos asociados al ingreso/egreso.

Motivo: volumen de eventos y patrón de escritura/consulta basado principalmente en socio, sede y tiempo.

## Caché preliminar

Se propone utilizar caché para el flujo de lectura de **ocupación actual por sede**, debido a que será consultado frecuentemente mientras que su valor puede derivarse de los eventos de ingreso y egreso.

La utilidad de la caché deberá validarse posteriormente mediante métricas comparativas de latencia y carga sobre el almacenamiento principal.

## Operación con consistencia

**Reservar el último cupo de una clase.**

Condiciones:
1. la membresía debe permitir la reserva;
2. el socio no debe tener una reserva duplicada;
3. la clase debe disponer de cupo;
4. ante solicitudes concurrentes nunca se podrá superar la capacidad máxima.

## Caso de uso CU-01: reservar una clase

**Estado:** reglas confirmadas para la primera versión. Reservas, espera y recuperación están implementadas; la cancelación por cambios posteriores de membresía sigue pendiente. Ver D4/D5 en la arquitectura.

### Actor y objetivo

- **Actor principal:** socio.
- **Objetivo:** registrar una reserva para una clase respetando la habilitación de la membresía, la capacidad de la clase y la restricción de reservas duplicadas.

### Flujo principal

1. El socio solicita una reserva para una clase.
2. El sistema verifica que la clase todavía no haya comenzado, que la membresía esté vigente y habilitada al reservar y que su vigencia cubra la fecha de la clase. También verifica que la solicitud no produzca una reserva confirmada duplicada y que exista un cupo disponible para ese socio, respetando la prioridad de la lista de espera cuando se reasigna un cupo liberado.
3. Si se cumplen esas condiciones, el sistema registra la reserva sin superar la capacidad de la clase.
4. El socio obtiene el resultado de la operación.

Las validaciones anteriores describen condiciones de negocio. Su implementación y coordinación entre servicios se definirán en las decisiones de arquitectura.

### Resultados alternativos ya definidos

- **La membresía no permite reservar o su vigencia no cubre la fecha de la clase:** no se confirma una nueva reserva.
- **La solicitud produciría una reserva confirmada duplicada:** no se registra una segunda reserva confirmada para el mismo socio y la misma clase. Una reserva previamente cancelada no impide volver a reservar si se cumplen las condiciones vigentes.
- **La clase no tiene cupos:** no se confirma una reserva que supere la capacidad. Se ofrece al socio ingresar a la lista de espera; el ingreso se realiza únicamente si el socio lo elige.
- **Solicitudes concurrentes:** las condiciones de capacidad y de ausencia de duplicados deben conservarse aunque las solicitudes lleguen al mismo tiempo.
- **La clase ya comenzó:** no se admite una nueva reserva ni el ingreso a su lista de espera.

### Reglas de negocio del caso de uso

| Identificador | Regla |
|---|---|
| RN-R01 | La membresía debe estar vigente y habilitada al reservar y en la fecha de la clase. Al reservar, su vigencia debe cubrir esa fecha. |
| RN-R02 | Un socio no puede mantener dos reservas confirmadas para la misma clase. Una reserva cancelada no impide realizar una nueva solicitud. |
| RN-R03 | Las reservas confirmadas de una clase no pueden superar su capacidad máxima. |
| RN-R04 | La concurrencia no puede provocar reservas duplicadas ni superar la capacidad de la clase. |
| RN-R05 | El ingreso a la lista de espera de una clase llena requiere la elección del socio. |
| RN-R06 | Los cupos liberados se reasignan automáticamente respetando el orden de inscripción de la lista de espera y verificando nuevamente la habilitación actual de la membresía y su vigencia para la fecha de la clase. Una nueva solicitud no puede tomar el cupo destinado a esa reasignación. |
| RN-R07 | El socio puede cancelar una reserva únicamente antes del inicio de la clase. |
| RN-R08 | La suspensión o pérdida de habilitación de una membresía cancela las reservas futuras afectadas y libera sus cupos. |
| RN-R09 | Una persona que ya no cumple las condiciones de membresía al evaluarse un cupo liberado se retira de la lista de espera y se evalúa a la siguiente en orden de inscripción. |
| RN-R10 | Las nuevas reservas y los ingresos a la lista de espera solo se permiten antes del inicio de la clase. |
| RN-R11 | Para la primera versión, cualquier membresía vigente y habilitada permite reservar cualquier clase y sede. No se establecen límites adicionales de cantidad de reservas ni validaciones por superposición de horarios; se mantienen el cupo por clase y la prohibición de duplicados. |
| RN-R12 | Si Socios no responde al reasignar un cupo, la cancelación local se acepta, se conserva al primero de la espera y el cupo no se asigna a nuevas solicitudes. La reasignación se reintenta automáticamente cuando se recupera Socios. Un error de comunicación no equivale a perder la habilitación. |

### Criterios de aceptación

Estos criterios describen resultados observables para verificar las reglas identificadas y las decisiones confirmadas; no establecen códigos HTTP, mecanismos de persistencia ni políticas pendientes.

Los escenarios que esperan una nueva reserva confirmada presuponen que la clase todavía no ha comenzado.

| Identificador | Condiciones y acción | Resultado esperado |
|---|---|---|
| CA-R01 | El socio solicita reservar con membresía habilitada, vigencia que cubre la clase, sin duplicados y con cupo disponible respetando la prioridad de espera. | Se registra una única reserva y se comunica el resultado. |
| CA-R02 | La membresía no habilita la reserva o no cubre la fecha de la clase; o la clase ya comenzó. | No se confirma una reserva. Después del inicio tampoco se admite ingresar a la lista de espera. |
| CA-R03 | El socio repite una solicitud para una clase que ya tiene reservada, incluso mediante solicitudes simultáneas. | Se conserva como máximo una reserva confirmada para ese socio y esa clase, sin ocupar un cupo adicional. |
| CA-R04 | La clase está llena y el socio solicita reservar. | No se supera la capacidad; el socio puede elegir ingresar a la lista de espera y solo se lo incorpora si acepta. |
| CA-R05 | Dos socios habilitados, sin reservas duplicadas, solicitan simultáneamente el último cupo. | Solo uno obtiene la reserva; al otro se le ofrece ingresar a la lista de espera. |
| CA-R06 | El socio solicita cancelar su reserva. | Antes del inicio se cancela y libera el cupo para su reasignación; desde el inicio la cancelación no se admite. |
| CA-R07 | Se libera un cupo con personas en espera, incluso mientras llegan nuevas solicitudes. | Se confirma automáticamente al primero que cumple las condiciones, respetando el orden de inscripción. Se retira a quienes perdieron la habilitación y se evalúa al siguiente; no se excede la capacidad ni se generan duplicados o se desplaza la prioridad de espera. |
| CA-R08 | El socio solicita nuevamente una clase cuya reserva había cancelado y cumple las condiciones vigentes. | La cancelación anterior no impide confirmar la nueva reserva si existe cupo para él. |
| CA-R09 | Una membresía se suspende o pierde la habilitación para una clase futura ya reservada. | Se cancela la reserva afectada, se libera el cupo y se aplica la política de reasignación. |
| CA-R10 | Se cancela antes del inicio y Socios está indisponible al evaluar al primero de la espera. | La reserva queda cancelada; no se elimina al candidato ni se adelanta a otro. Tras recuperarse Socios, se valida y reasigna respetando el orden y la capacidad. |

**Cobertura actual:** se verifican reservas, cancelaciones y promociones; no todas las reglas del sistema objetivo están implementadas. RN-R08/CA-R09 requieren el evento de dominio ante cambios posteriores de membresía; su implementación sigue pendiente en D5 y no queda acreditada por estas pruebas.

## Fuera de alcance inicial

Para evitar ampliar innecesariamente el proyecto, inicialmente quedan fuera:
- pagos efectuados por el socio desde la plataforma e integración con pasarelas de pago;
- emisión de facturas fiscales reales;
- contratación y renovación de membresías mediante autogestión del socio;
- dispositivos físicos para registrar ingresos y egresos;
- restricciones adicionales de reservas por plan o sede, límites de cantidad por socio y controles de superposición de horarios;
- seguimiento de rutinas de entrenamiento;
- nutrición;
- progreso corporal;
- compras, pedidos y reposición de productos de la tienda;
- red social del gimnasio.

Las ampliaciones deberán acordarse explícitamente y reflejarse en el alcance antes de incorporarse al sistema.
