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
Administra socios y membresías, registra y confirma los pagos y genera sus comprobantes internos. También gestiona planes, clases y sedes, registra las unidades vendidas en la tienda y consulta información operativa del gimnasio.

Las altas internas requieren un administrador; no hay autorregistro público. El administrador inicial se crea mediante comando local. El alta crea la cuenta sin habilitar membresía; el pago correspondiente es necesario para su habilitación. También vincula manualmente empleados de Car Cruds con socios; consultar un empleado o vincularlo no activa una membresía.

### Personal de recepción
Valida el acceso de los socios y registra sus ingresos y egresos desde la aplicación. Puede consultar el estado de una membresía cuando sea necesario. La primera versión no utiliza dispositivos físicos para registrar esos movimientos.

### Grupo consumidor de membresías para empleados
Car Cruds publica empleados y su estado laboral. El gimnasio consulta esos datos y le envía información mensual de membresía, uso y pagos de los socios vinculados. Su sistema receptor construye el informe; el administrador del gimnasio conserva la gestión de socios, planes y pagos.

### Distribuidora FAV
FAV administra su catálogo y existencias de distribuidora, provee productos a la tienda del gimnasio y consume nuestra API para consultar sus existencias locales y registrar reposiciones. La rama de integración y los datos de conexión de ambos sistemas siguen pendientes de coordinación.

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

**Implementación de etapa 1, 30/10/2026:** recepción en panel ADMIN existente, sin rol nuevo ni operaciones para SOCIO. MongoDB guarda movimientos, presencias e idempotencia. CA-G05–G07 conservan sus reglas; el egreso no vuelve a validar membresía. ADR-019 justifica la restricción de acceso y la vigencia local del JWT. Caché y consumo de uso desde Car Cruds quedan para otra etapa.

No se incluyen lectores, molinetes ni otros dispositivos físicos en esta versión.

### Integración: membresías para empleados

El flujo indicado por el profesor para **Car Cruds** es: **consultar empleados → vincular manualmente con socios → enviar información mensual**. Pertenece a Socios y Membresías y utiliza el contrato externo `0.3.0`. Las lecturas, la vinculación administrativa y el envío manual con vista previa, historial y recuperación están implementados y verificados localmente. La conexión conjunta necesita URL y token. [Guía y contrato](contracts/README.md#integracion-con-car-cruds), [D8 vigente](adr/ADR-018-integracion-car-cruds.md).

- Car Cruds administra `employeeId`, nombre y estado laboral. Garantiza que el identificador no se reutiliza. DNI y email se completan en el gimnasio; no se vinculan personas por coincidencia de nombre ni se crea una cuenta automáticamente al consultar.
- El administrador vincula al empleado con un socio existente o primero completa el alta administrativa y después confirma la asociación por separado. El vínculo es uno a uno dentro de Car Cruds. Puede corregirlo o quitarlo conservando socio anterior/nuevo, administrador, fecha e historial de revisiones, sin modificar la membresía. El plan y el pago siguen siendo necesarios para habilitarla.
- Para este intercambio se prepara un perfil mensual `AAAA-MM` en `America/Argentina/Buenos_Aires`: `member` informa vigencia durante algún tramo hasta el corte, `used` un ingreso efectivo, `costMinor` el costo neto imputado al mes completo y `spendingMinor` los pagos efectivos del mes. Los importes se expresan en centavos ARS y se informan por separado.
- Un hecho desconocido es `null`; `false` y cero requieren información suficiente. El estado actual de una membresía no demuestra toda su historia mensual; una reserva no demuestra asistencia. Sin pagos, accesos o historia fiables se mantiene el hecho desconocido.
- Meses parciales, distribución de fracciones de centavo y devoluciones siguen pendientes de acuerdo. Los valores no calculables o no representables no se inventan ni se convierten en cero.
- El envío es una fotografía completa. Los reintentos conservan referencia, versión, fecha `observedAt` y contenido. Una corrección utiliza una versión mayor; un conflicto requiere revisión.
- El ADMIN elige el mes, guarda/revisa la fotografía y confirma el envío manualmente, sin programación mensual. Los hechos se obtienen del backend; no se inventan importes o asistencia. Una observación positiva guardada del mismo empleado, socio y mes conserva la prueba de afiliación aunque luego se suspenda; la falta de prueba se informa como desconocida.
- Cambiar o quitar un vínculo conserva los envíos anteriores. Antes de preparar para la nueva relación se revisa y confirma explícitamente el cambio, sin borrar ni corregir automáticamente datos externos.
- Una ausencia en el listado no prueba una baja. La consulta de estado laboral permite comprobarla explícitamente y no cancela ni desvincula automáticamente la membresía.

El diseño anterior de recepción por `POST /api/v1/integraciones/empleados`, contrato propio `1.0.1`, sigue implementado localmente con su mock, validaciones y alta atómica de socio/solicitud pendiente. Se conserva como antecedente en [ADR-014](adr/ADR-014-contrato-empleados.md); no es la API que llamará Car Cruds en el nuevo flujo. RF-10, RN-G09–G11 y CA-G08–G10 se actualizan al diseño vigente, conservando esa historia.

### Integración: tienda y reposiciones de FAV

El equipo confirmó el 06/11/2026 que FAV maneja una tienda dentro del gimnasio: **Tienda registra las existencias recibidas en una única tienda**, FAV las consulta y registra reposiciones, y ADMIN del gimnasio registra las unidades vendidas. No se separa stock por sede. Se mantiene el consumo del catálogo y la disponibilidad de la distribuidora, distinguiendo esas existencias del stock físico del gimnasio.

El servicio Tienda conserva su separación y arquitectura en Capas. FAV sigue siendo propietario de su catálogo y stock de distribuidora; Tienda administra el stock local, reposiciones, ventas y resultados idempotentes en una base y usuario PostgreSQL 17 propios, dentro de la instancia local existente. [D1 y capacidad FAV, ADR-022](adr/ADR-022-tienda-y-consignaciones-fav.md) reemplaza la decisión anterior de consulta sin almacenamiento; no cambia la integración con Car Cruds.

La capacidad ofrecida se define en [OpenAPI FAV 1.0.0](contracts/openapi-fav-v1.yaml) y [su guía](contracts/fav-tienda.md): consulta de stock y recepción de una variante por reposición, con credencial de FAV y protección contra entregas duplicadas. Las ventas administrativas no son una operación externa de FAV.

**Estado:** stock, reposiciones y ventas administrativas implementados localmente. Las rutas compartidas de FAV usan su credencial técnica; el panel ADMIN consulta stock y registra ventas con JWT e idempotencia. Las transacciones conservan entrega, existencias y respuesta frente a repetición, concurrencia y reinicio. La evidencia y sus límites se mantienen en [EVIDENCIA-TIENDA](EVIDENCIA-TIENDA.md).

El cliente externo y la prueba conjunta siguen pendientes. `GET /api/v1/tienda/productos` continúa devolviendo `503 INTEGRACION_PENDIENTE`, sin productos ficticios ni stock cero de respaldo; esto no impide consultar las existencias locales ya recibidas. La rama anterior `feature-inventario` ya no existe. En el código de `development` de FAV se encontró una consulta pública de disponibilidad; falta fijar la rama y el contrato externo que la incluya, además de URL y credenciales. [D9](adr/ADR-009-consumo-del-proveedor.md).

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
| RF-10 | El administrador consulta empleados de Car Cruds y los vincula manualmente con socios; Socios y Membresías envía fotografías mensuales conforme al contrato externo, con hechos desconocidos explícitos y reintentos sin duplicación. |
| RF-11 | El socio puede consultar productos y disponibilidad de FAV desde Tienda conforme al contrato externo acordado, distinguiendo esa disponibilidad del stock físico de la tienda del gimnasio. |
| RF-12 | FAV puede consultar el stock local de la tienda y registrar reposiciones mediante la capacidad compartida de Tienda, sin duplicar entregas. |
| RF-13 | ADMIN del gimnasio puede registrar unidades vendidas y consultar las existencias de la tienda sin permitir stock negativo. |

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
| RN-G09 | Consultar o vincular un empleado no habilita una membresía: el administrador gestiona el plan y confirma el pago. |
| RN-G10 | La vinculación es manual mediante identificadores estables y uno a uno dentro de Car Cruds; no se deduce por nombre ni sobrescribe socios o membresías. ADMIN puede corregirla o quitarla con historial de actor, fecha y asociación anterior/nueva. El alta administrativa mantiene la unicidad de DNI/email. |
| RN-G11 | Car Cruds obtiene el origen del emisor de la credencial de aplicación. Una repetición conserva referencia, versión y fotografía completa, incluida su fecha; no duplica importes. |

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
| CA-G08 | El administrador consulta empleados y vincula uno con un socio mediante sus identificadores; después puede corregirlo o quitarlo. | Se conserva la relación uno a uno y su historial de cambios, sin vincular por nombre ni modificar la membresía. |
| CA-G09 | Se reenvía una fotografía mensual con la misma referencia, versión y contenido, incluido observedAt. | Car Cruds reconoce la repetición sin duplicar importes; una corrección completa de versión mayor reemplaza la anterior y una versión atrasada no la pisa. |
| CA-G10 | El receptor informa conflicto de versión, referencia u origen. | El envío queda para revisión; no se sobrescriben datos ni se cambia la versión para eludir el conflicto. |
| CA-G11 | El socio consulta la tienda y el proveedor responde conforme al contrato que se acuerde. | Se muestran los productos y la disponibilidad de FAV, identificándola como disponibilidad de la distribuidora y diferenciándola de las existencias locales; una falla no se muestra como stock cero. |
| CA-G12 | Faltan registros fiables de pagos, accesos, vigencia histórica o imputación del costo. | Los hechos correspondientes se envían como desconocidos; no se deducen false ni cero de un módulo pendiente o una consulta fallida. |
| CA-G13 | Un empleado deja de aparecer en la lista o se consulta su estado laboral. | La ausencia y los errores no prueban una baja; active:false no cancela ni desvincula automáticamente al socio o su membresía. |
| CA-G14 | Dos administradores modifican un vínculo desde la misma revisión o intentan asociar el mismo socio con empleados distintos. | No se sobrescribe un cambio diferente ni se duplica la asociación; un conflicto requiere actualizar y revisar. Repetir el estado vigente no duplica el historial. |
| CA-G15 | ADMIN elige un mes y prepara la fotografía; luego confirma el envío. | La vista previa queda guardada antes de enviar y sus hechos no se editan desde el cliente. Cada reintento usa el mismo cuerpo, referencia, versión y corte; no se declara recepción ante una respuesta incierta. |
| CA-G16 | Se reinicia el servicio durante el envío o se corrige un vínculo que tenía fotografías. | El mensaje se conserva para recuperación; un intento tardío no pisa al actual. Las fotografías y recibos anteriores permanecen; la nueva relación requiere revisión explícita antes de preparar otra. |

La actualización transaccional del índice y la vigencia de caché se documentan en D6/D7. Redis ya está implementado y medido en ocupación; su frescura todavía requiere validación de negocio. Este alcance no establece compromisos numéricos que no hayan sido acordados.

## Reglas y aceptación de la tienda FAV

Estas reglas fueron confirmadas por el equipo el 06/11/2026 y están implementadas localmente en el flujo de stock, reposiciones y ventas. La prueba conjunta con FAV y el consumo de su catálogo siguen pendientes; las verificaciones y sus límites están en [EVIDENCIA-TIENDA](EVIDENCIA-TIENDA.md).

| Regla | Definición |
|---|---|
| RN-T01 | Existe una única tienda del gimnasio. FAV conserva su catálogo y stock de distribuidora; Tienda registra las existencias locales por variante de FAV. |
| RN-T02 | Una reposición aceptada suma unidades disponibles una sola vez. Una venta registrada por ADMIN descuenta disponibles y aumenta las unidades vendidas acumuladas desde el inicio. |
| RN-T03 | No se admiten ventas que produzcan stock negativo. Devoluciones y ajustes quedan fuera de esta versión. |
| RN-T04 | Repetir clave y datos de reposición devuelve la entrega original. Otra clave con la misma referencia y datos también reutiliza esa entrega, sin sumar unidades. |
| RN-T05 | Reutilizar clave o referencia con datos diferentes produce conflicto y no modifica existencias. FAV se identifica mediante su credencial; no obtiene permisos administrativos del gimnasio. |

| Criterio | Condiciones y acción | Resultado esperado |
|---|---|---|
| CA-T01 | FAV registra una reposición válida. | Se conserva una entrega y se incrementan sus unidades disponibles una sola vez. |
| CA-T02 | FAV repite una entrega con igual clave o con otra clave y la misma referencia y datos. | Se devuelve la entrega original; las existencias no vuelven a incrementarse, incluso tras reinicios o solicitudes concurrentes. |
| CA-T03 | FAV reutiliza clave o referencia con otro producto o cantidad. | Se informa conflicto sin modificar la entrega ni el stock. |
| CA-T04 | ADMIN registra una venta con unidades disponibles suficientes. | Disminuyen disponibles y aumentan vendidas acumuladas de forma consistente. Una venta que excede las existencias se rechaza sin cambios. |
| CA-T05 | FAV consulta existencias con su credencial. | Obtiene unidades disponibles y vendidas acumuladas del gimnasio; no las existencias de su distribuidora. |
| CA-T06 | Falla la dependencia de datos o llega una credencial inválida. | No se informa stock cero ni se acepta una reposición como exitosa sin resultado confirmado. Los errores y reintentos respetan el contrato. |

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

Tienda utiliza PostgreSQL 17 con base y usuario `tienda` separados para stock local, reposiciones, ventas e idempotencia según ADR-022 y D3. Las cuatro tablas de negocio y el resultado de cada movimiento se mantienen en transacciones locales; no se accede a bases ajenas ni se replica el stock de la distribuidora.

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
- compras o pedidos del socio desde la plataforma, cobros en línea de la tienda, devoluciones y ajustes de stock; la reposición por FAV y el registro administrativo de unidades vendidas sí forman parte del alcance actualizado;
- red social del gimnasio.

Las ampliaciones deberán acordarse explícitamente y reflejarse en el alcance antes de incorporarse al sistema.

## Estado de implementación de etapa 3 (30/10/2026)

RF-01–03, RN-G01–04 y CA-G01–03 se concretan para planes administrados, solicitudes y confirmación manual de pago completo con comprobante interno y habilitación transaccional. El alta de cuenta sigue sin membresía. El socio consulta sus solicitudes/estado; Clases valida cobertura mediante el contrato vigente. Esta anotación informa implementación, no sustituye ni reduce los requisitos anteriores.

No se agregan precios o duraciones comerciales al alcance: ADMIN configura tarifas y fechas explícitas. Como protección ante reglas no definidas, las superposiciones se bloquean para revisión; renovación sin superposición requiere otra solicitud y pago. Acumulación, sustitución, reactivación de suspensiones, prorrateos, cuotas, devoluciones y política de vencimiento administrativo de solicitudes siguen sin definición/implementación. CA-R09 continúa pendiente de RabbitMQ. La imputación mensual Car Cruds no se deduce de los nuevos cobros. [Matriz y evidencia de límites](EVIDENCIA-MEMBRESIAS.md).
