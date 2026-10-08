# Alcance inicial - Entrega 1

Este documento es la primera versión del alcance solicitada para la Entrega 1: funcionalidades, reglas de negocio y criterios de aceptación. Las políticas de negocio fueron confirmadas durante la revisión con el grupo. Se documenta el sistema previsto; la implementación de sus funcionalidades corresponde a los siguientes hitos.

El dominio del gimnasio está aprobado por la cátedra. La elección de tecnologías y la coordinación entre servicios se documentarán en la arquitectura y sus ADR.

## Problema

Un gimnasio necesita centralizar la administración de sus socios y, al mismo tiempo, controlar operaciones que tienen impacto directo en el negocio: vigencia de membresías, pagos, reservas de clases con capacidad limitada e ingresos a las sedes.

Una solución limitada únicamente a un CRUD de membresías no alcanza para representar estos flujos. Por eso, el dominio se amplía a un sistema integral de gestión del gimnasio.

## Actores preliminares

### Socio
Puede consultar su membresía, buscar clases, reservar o cancelar actividades, elegir ingresar a una lista de espera y consultar el estado de sus operaciones.

### Administrador
Administra socios y membresías, registra y confirma los pagos y genera sus comprobantes internos. También gestiona planes, clases y sedes y consulta información operativa del gimnasio.

### Personal de recepción
Valida el acceso de los socios y registra sus ingresos y egresos desde la aplicación. Puede consultar el estado de una membresía cuando sea necesario. La primera versión no utiliza dispositivos físicos para registrar esos movimientos.

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

Los tiempos de actualización del índice de búsqueda y la vigencia de la caché se definirán en sus ADR. Este alcance no establece valores numéricos que todavía no fueron acordados.

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

**Estado:** reglas de negocio confirmadas por el grupo para la primera versión. Su implementación y coordinación técnica se definirán en las tareas de arquitectura.

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
- tienda de productos;
- red social del gimnasio.

Las ampliaciones deberán acordarse explícitamente y reflejarse en el alcance antes de incorporarse al sistema.
