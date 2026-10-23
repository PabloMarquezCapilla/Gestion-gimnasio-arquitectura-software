# D8 - Integración de membresías con Car Cruds

**Estado:** lecturas, vinculación administrativa, auditoría y envío manual de fotografías implementados localmente. Conexión operativa y prueba conjunta pendientes. El POST anterior sigue operativo localmente.
**Fecha:** 23/10/2026.
**Reemplaza en el diseño de la integración:** [ADR-014 - Contrato de recepción de empleados](ADR-014-contrato-empleados.md). Su API, contrato y pruebas se conservan.
**Enunciado:** §3, página 4; §4.1, páginas 5–6; §5, página 7; §6.3, página 8, actualización de D8.

## Contexto

El profesor confirmó el cambio de dirección de la integración: Gimnasio consulta empleados de Car Cruds y les envía información de membresía, uso e importes. Esto sustituye el acuerdo anterior, en el que Car Cruds enviaría un empleado al POST del gimnasio para solicitar su alta.

La referencia externa es el [acuerdo con Gimnasio](https://github.com/Gerpeirone/Car-Cruds/blob/9eec2773ec58357836ec90bad631b1e345805f4e/docs/ACUERDO-GIMNASIO.md) y el [contrato de empleados 0.3.0](https://github.com/Gerpeirone/Car-Cruds/blob/9eec2773ec58357836ec90bad631b1e345805f4e/docs/contracts/employees-openapi.json), revisados en el commit `9eec2773ec58357836ec90bad631b1e345805f4e`, rama `entrega-2/cierre`, [PR #4](https://github.com/Gerpeirone/Car-Cruds/pull/4). La [copia de referencia del contrato](../contracts/car-cruds-employees-0.3.0.openapi.json) pertenece a Car Cruds; no redefine una API del gimnasio.

§4.1 exige el acuerdo formal, la integración desde el servicio responsable y su verificación conjunta. El nuevo sentido de comunicación fue confirmado por el profesor; este registro no acredita todavía una capacidad compartida operativa ni una publicación accesible. §5 exige conservar las decisiones reemplazadas y §6.3 pide actualizar D8 cuando cambie el contrato.

## Decisión

### Responsabilidades y comunicación

**Socios y Membresías**, dentro de su arquitectura en Capas, es responsable de la integración. La lectura utiliza `app.ts` → `CarCrudsService` → `HttpCarCrudsClient`; `server.ts` compone el cliente. La vinculación utiliza `CarCrudsVinculosService`; la preparación/envío, `CarCrudsEvidenciasService` y el puerto `CarCrudsEvidenciasRepository`, implementado en PostgreSQL/memoria. Las llamadas externas parten de Socios:

| Operación de Car Cruds | Uso previsto |
|---|---|
| `GET /v1/employees` | Lectura implementada de empleados activos con paginación. Devuelve `employeeId` y `displayName`, sin DNI ni email. |
| `GET /v1/employees/{id}/status` | Lectura implementada del estado laboral. La ausencia en una página no acredita una baja. |
| `POST /v1/employees/membership-evidence` | Implementado: entregar manualmente una fotografía guardada, completa y versionada de los datos conocidos del empleado para un período. |

Las tres operaciones usan un **Bearer de aplicación con rol `gym`** otorgado por Car Cruds. Es una credencial distinta del JWT de los usuarios y de las claves existentes del gimnasio. URL y token operativos siguen pendientes; los secretos se intercambiarán fuera del repositorio.

Car Cruds es propietario de sus empleados y del reporte receptor. Gimnasio es propietario de socios, membresías y de los hechos de negocio que comunique. La información propia ofrecida se entrega al POST externo; este cambio no crea automáticamente otro endpoint público del gimnasio. Tienda mantiene su responsabilidad separada de productos y stock en [D9](ADR-009-consumo-del-proveedor.md).

### Vínculo y habilitación

- `employeeId` es estable y no se reutiliza para otra persona según el acuerdo del proveedor.
- El administrador vincula al empleado con un socio mediante la pantalla **Empleados Car Cruds**. DNI/email permiten una búsqueda exacta; nunca se asocia por nombre. El alta de una cuenta nueva reutiliza el formulario administrativo y se confirma separadamente del vínculo.
- Consultar empleados no da de alta socios, no asigna contraseñas y no habilita membresías automáticamente. Para una membresía nueva sigue siendo necesaria la elección del plan y confirmación del pago correspondiente.
- Un empleado sin vínculo no se informa como una afiliación negativa comprobada.
- Un estado laboral inactivo no cancela automáticamente la membresía ni elimina el vínculo o su historia.
- El equipo confirmó un vínculo **uno a uno dentro de Car Cruds** y la posibilidad de corregir o quitar asociaciones por ADMIN, con historial de actor, fecha y socio anterior/nuevo. Las membresías conservan su estado.

### Persistencia y concurrencia de la vinculación

Se agregan `car_cruds_vinculos` y `car_cruds_vinculos_historial` en la base de Socios. La referencia anterior `empleados_externos` tiene reglas y respuestas idempotentes propias; se mantiene intacta para conservar la implementación disponible y separar el alcance de la nueva unicidad. No se migran asociaciones ni se inventa auditoría retroactiva.

- Un índice único parcial impide que un socio aparezca en dos vínculos actuales de Car Cruds.
- Una transacción guarda el vínculo y su auditoría; si falla cualquiera, se revierten ambos. El administrador se toma del JWT validado y la fecha del servidor.
- Un bloqueo consultivo por empleado serializa escritores entre instancias. `versionEsperada` detecta una pantalla obsoleta antes de modificar; la revisión sigue aumentando después de quitar y volver a vincular.
- Repetir la asociación vigente es un no-op sin nueva auditoría. Los conflictos de revisión o de socio ya vinculado requieren revisión, sin sobrescribir.
- El ID de empleado se verifica por HTTP antes de abrir la transacción. Un empleado conocido inactivo puede vincularse para información histórica; el estado laboral no modifica la membresía. Quitar un vínculo no requiere disponibilidad remota.
- La lista local de vínculos tiene total y página bajo un mismo snapshot de SQL; el historial permanece incluso cuando la asociación se quita. La asociación no publica fotografías ni eventos.

### Período y significado de los datos

`period` representa un mes calendario `AAAA-MM`, usando la zona horaria `America/Argentina/Buenos_Aires`. Se acepta información parcial del mes en curso hasta el corte informado y correcciones de meses anteriores.

| Campo | Regla del acuerdo y condición para informarlo |
|---|---|
| `member` | Existencia de una membresía vigente y habilitada en algún tramo del mes hasta el corte. No equivale solo al estado actual. Si la historia disponible no permite demostrarlo, se informa `null`. |
| `used` | Al menos un ingreso efectivo durante ese período hasta el corte. Una reserva no prueba asistencia. Mientras falten movimientos fiables o cobertura suficiente, se informa `null`. |
| `costMinor` | Costo neto del plan dividido por los meses contratados, solo cuando los datos y la imputación sean fiables. Los meses parciales quedan en `null` hasta acordar su tratamiento. |
| `spendingMinor` | Pagos efectivamente registrados durante el mes hasta el corte, solo cuando exista información fiable. No se infiere del precio del plan. |
| `currency` | ARS para los importes acordados, expresados como centavos enteros. Es obligatoria cuando se informa un importe conocido, según el contrato. |

`null` significa desconocido; `false` es una respuesta negativa comprobada y `0` es un importe cero comprobado. No disponer de registros de ingreso o de pagos no demuestra ausencia de uso ni importe cero. No se suman costo y pagos como si fueran una misma magnitud.

La fuente actual permite `member:true` cuando comprueba socio activo y membresía habilitada/vigente al observar un instante del mes actual, o cuando ya conserva una observación positiva del mismo empleado, socio y mes hasta el corte. Una suspensión o vencimiento posterior no borra esa prueba de un tramo del período. Sin ella, el estado actual no demuestra un mes negativo ni reconstruye el pasado: se informa `null`. Uso e importes siguen desconocidos mientras falten sus registros; no se completan mediante el formulario.

El reparto de fracciones de centavo, las devoluciones o ajustes negativos y los meses parciales siguen pendientes de acuerdo. No se inventan precios, historia ni una fórmula adicional: el dato afectado permanece desconocido o requiere revisión antes de enviarse. El contrato no admite importes negativos.

### Versionado, fotografías y reintentos

El POST de Car Cruds recibe `employeeId`, `period`, `sourceReference`, `version` y `observedAt`, más los hechos disponibles. El origen se obtiene de la credencial; no se elige en el cuerpo.

- `sourceReference` se mantiene para el empleado y período; una corrección usa una versión superior y una fotografía completa de los hechos conocidos.
- Omitir un hecho o enviarlo como `null` lo deja desconocido en esa fotografía; no conserva automáticamente el valor anterior.
- Ante timeout, el resultado es incierto. El reintento conserva exactamente referencia, versión, `observedAt` y contenido del mensaje original.
- Una repetición idéntica devuelve `applied: false`; no se crea otra versión para forzar su aceptación. Una versión posterior puede reemplazar la vigente y una inferior no la reemplaza.
- Un `409` requiere revisar el conflicto; no se resuelve aumentando automáticamente la versión. `observedAt` describe el instante de observación y no sustituye el orden por versión.
- Este mecanismo no utiliza el header `Idempotency-Key` del POST anterior del gimnasio. `car_cruds_evidencias_series` conserva referencia y última versión; `car_cruds_evidencias` conserva cada cuerpo inmutable, su procedencia, intentos y resultado.

Las lecturas tienen un presupuesto configurable de 3000 ms por defecto (máximo 30000), que incluye conexión, cuerpo y como máximo un reintento de red/502/503/504 con espera de 75–124 ms. Se valida estrictamente el OpenAPI, la coherencia de una página y la identidad del estado; no se siguen redirecciones y el cuerpo se limita a 1 MiB. El POST usa el mismo presupuesto y validación de contrato, con un solo intento HTTP. Estas son políticas locales de protección, no un SLA externo.

### Entrega manual y recuperación

El equipo confirmó el flujo ADMIN → elegir mes → preparar/guardar → revisar → confirmar envío, sin cron. El cliente no acepta hechos del navegador. La preparación lee las fuentes dentro de la transacción del repositorio y ejecuta un generador síncrono de aplicación; crea una versión con control de revisión y conserva actor y corte. El cuerpo y su procedencia tienen protección SQL contra modificaciones accidentales. El alta, la membresía y el pago conservan sus reglas.

Antes de HTTP, una transacción verifica la última fotografía y el vínculo vigente, reserva el intento por 60 s y guarda un UUID. HTTP se ejecuta fuera del bloqueo. El registro pasa de `PREPARADA` a `ENVIANDO` y luego a `RECIBIDA`, `PENDIENTE` o `REQUIERE_REVISION`. El timeout, una respuesta inválida o un 5xx conservan el resultado incierto. Un rechazo definitivo requiere revisión; un 409 no se resuelve aumentando automáticamente la versión.

El reintento manual lee el cuerpo original; no recalcula `observedAt` ni los hechos. Tras una caída o un error al guardar el recibo, otra instancia puede recuperar el mismo mensaje al vencer el lease. La hora proviene de PostgreSQL y el UUID descarta finalizaciones tardías de intentos anteriores. Un recibo válido persistido no se vuelve a enviar. `applied:false` puede significar repetición o versión atrasada; se informa sin afirmar qué versión está vigente en el receptor.

Cambiar o quitar un vínculo conserva fotografías y recibos. Una nueva fotografía de la relación corregida requiere confirmación explícita. Una pendiente antigua puede pasar a revisión mediante esa confirmación cuando ya no haya un intento activo; su incertidumbre y cuerpo permanecen. No se reenvía con el nuevo socio ni se corrige o borra automáticamente información externa. Un lease activo debe terminar o vencer antes de esa corrección.

## Estado y verificación pendientes

El backend actual conserva `POST /api/v1/integraciones/empleados`, contrato propio **1.0.1**, su persistencia PostgreSQL, el mock separado y sus pruebas. Esa disponibilidad no acredita el nuevo flujo acordado con Car Cruds. No se eliminan ni migran datos por esta decisión documental.

Las rutas administrativas de lectura `GET /api/v1/integraciones/car-cruds/empleados` y `GET /api/v1/integraciones/car-cruds/empleados/:employeeId/estado` exigen JWT ADMIN y envían el Bearer de aplicación solo desde Socios. Un 401/403 externo se traduce a 502, sin invalidar la sesión del usuario. URL/token ausentes producen 503 de integración pendiente; valores parciales o inválidos hacen fallar el inicio. No se hace ninguna llamada externa al arrancar ni para la salud general del servicio.

La verificación reproducible es `npm run test:car-cruds`: HTTP efímero controlado, esquemas fijados, permisos, errores, timeout, lecturas, vinculación y envío. Incluye un receptor que almacena y pierde la respuesta: el reenvío conserva el mensaje y no duplica. `npm run test:postgres` comprueba con dos pools independientes unicidad, revisión concurrente, historial durable, cuerpo inmutable, lease/fencing y rollback de vínculo/fotografía. La pantalla utiliza cuentas y empleados ficticios para la verificación local. La URL/token reales y la prueba contra el servicio de Car Cruds siguen pendientes.

La pantalla y las rutas ADMIN permiten búsqueda de socios, consulta de vínculos/historial y confirmación/corrección/desvinculación. La consulta y el PUT de vínculo exigen los permisos actuales de la cuenta; los clientes no pueden elegir el actor. Las rutas y los cuerpos están en [la guía](../contracts/README.md#vinculación-y-membresía).

La pantalla y las rutas ADMIN también permiten preparar, consultar y enviar fotografías mensuales; las rutas, estados y cuerpos están en [la guía](../contracts/README.md#preparar-y-enviar-desde-el-panel). No se agregan motores de almacenamiento ni un microservicio nuevo. Pagos e ingresos siguen pendientes y no se simulan como hechos conocidos.

La prueba conjunta deberá cubrir consulta, vínculo, recepción de evidencia, repetición idéntica, corrección y fallas/recuperación. Car Cruds verificará su reporte con una credencial autorizada; el token `gym` no permite consultar ese reporte administrativo. También siguen pendientes URL accesible y credencial compartida.

## Alternativas y consecuencias

- Se conserva el POST anterior como implementación disponible, pero deja de describirse como el flujo acordado para Car Cruds.
- No se importa automáticamente a todas las personas ni se vincula por similitud de nombres; faltan datos personales que son responsabilidad del administrador.
- La evidencia mensual puede requerir más historia que una consulta del estado actual. El contrato permite desconocidos y no justifica inventar asistencia o pagos.
- La documentación distingue diseño e implementación. Los detalles operativos y las pruebas existentes del contrato anterior quedan en [la guía de la API anterior](../contracts/README.md#api-anterior-recepción-de-empleados).
