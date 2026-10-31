# Contratos e integraciones entre grupos

**API interna de recepción, 30/10/2026:** [OpenAPI Accesos 1.0.0](openapi-accesos-v1.yaml), [ADR-019](../adr/ADR-019-accesos-mongodb-recepcion.md) y [evidencia](../EVIDENCIA-ACCESOS.md). Requiere JWT ADMIN, pasa por el gateway y no reemplaza ningún contrato externo. POST con Idempotency-Key; consultar/registrar ocupación e historial no concede permisos a SOCIO.

**Estado:** 23/10/2026. Lecturas, vinculación administrativa y envío manual de fotografías implementados y verificados localmente. URL/token operativos y prueba conjunta pendientes. El POST anterior del gimnasio continúa disponible durante la transición.

El inicio, los usuarios de prueba y la consulta de bases se mantienen en el [README principal](../../README.md). Esta guía reúne contratos, reglas de intercambio y estados verificables; no registra una conexión externa que todavía no se probó.

**Enunciado:** §3, página 4 (documentación); §4.1, páginas 5–6 (contrato, integración y pruebas); §5 D8/D9 e historia de decisiones, página 7; §6.3, página 8 (actualizar D8 si cambia el contrato).

## Integracion con Car Cruds

**Responsable en el gimnasio:** Socios y Membresías, con su arquitectura en Capas. Car Cruds conserva empleados y el informe receptor; el gimnasio conserva socios, membresías, vínculos, auditoría y registro durable de fotografías e intentos.

**Flujo:** Socios consulta empleados y estado laboral → el administrador vincula con un socio → elige el mes, guarda/revisa la fotografía y confirma su envío a Car Cruds. El equipo confirmó el envío manual, sin programación mensual. El profesor confirmó este cambio de dirección según lo comunicado por el equipo. [D8 vigente, ADR-018](../adr/ADR-018-integracion-car-cruds.md).

### Contrato de referencia y procedencia

- [Copia local del OpenAPI 0.3.0](car-cruds-employees-0.3.0.openapi.json), importada sin cambios del proveedor. Es un contrato de **Car Cruds**, no una API nueva del gimnasio.
- [Fuente fijada al commit 9eec2773ec58357836ec90bad631b1e345805f4e](https://github.com/Gerpeirone/Car-Cruds/blob/9eec2773ec58357836ec90bad631b1e345805f4e/docs/contracts/employees-openapi.json), rama `entrega-2/cierre`.
- [Acuerdo de integración del mismo commit](https://github.com/Gerpeirone/Car-Cruds/blob/9eec2773ec58357836ec90bad631b1e345805f4e/docs/ACUERDO-GIMNASIO.md). Las reglas económicas abiertas permanecen como pendientes.
- La versión 0.3.0 agrega la consulta de estado; las estructuras de la lista y el POST 0.2.0 se mantienen compatibles. La copia local permite fijar la versión y preparar el test de contrato sin depender de cambios en la rama remota.

| Operación externa | Resultado y condiciones |
|---|---|
| `GET /v1/employees?page=1&pageSize=100` | Lista de empleados activos: `items[{employeeId,displayName}]`, `page`, `pageSize`, `total`. Máximo 100 por página. Orden estable por ID; cada página tiene su propia instantánea, no todo el recorrido. |
| `GET /v1/employees/{id}/status` | Solo `{employeeId,active}`; también responde por empleados inactivos conocidos. Un 404 o fallo técnico no prueba una baja. |
| `POST /v1/employees/membership-evidence` | Recibe una fotografía completa. Devuelve HTTP 200 con `{applied:true}` si actualiza la evidencia vigente o `{applied:false}` ante repetición o versión atrasada. |

Las tres llamadas parten del backend de Socios hacia la URL de Car Cruds. Se usa `Authorization: Bearer <token-de-aplicacion>`, con rol `gym`; en Car Cruds se configura como `AUTH_GYM_TOKEN`. Es independiente de nuestro JWT de usuarios, de `X-Service-Key` y de la credencial del POST anterior. El origen se obtiene de ese token en el receptor; no se envía como campo del cuerpo.

### Lecturas disponibles en nuestra API

Ambas rutas requieren **Bearer JWT de un ADMIN vigente del gimnasio**, incluso para informar configuración pendiente. La consulta no crea socios, vínculos, pagos ni membresías y responde `Cache-Control: no-store`.

| Ruta del gimnasio | Uso |
|---|---|
| `GET /api/v1/integraciones/car-cruds/empleados?page=1&pageSize=20` | Devuelve la página externa validada con los mismos campos. Una sola página por consulta; no presupone un padrón global estable. `page` es un entero positivo seguro de JavaScript y `pageSize` está entre 1 y 100. Se rechazan parámetros repetidos o desconocidos. |
| `GET /api/v1/integraciones/car-cruds/empleados/{employeeId}/estado` | Devuelve únicamente `employeeId` y `active`. No admite query parameters y exige que el ID recibido sea el solicitado. |

Configurar estas variables opcionales en el entorno de **Socios**; Compose las toma del entorno/`.env` y `.env.example` incluye los nombres:

| Variable | Configuración |
|---|---|
| `CAR_CRUDS_BASE_URL` | URL HTTP/HTTPS entregada por Car Cruds; se admite un prefijo de ruta. Sin usuario/contraseña, query ni fragmento. |
| `CAR_CRUDS_TOKEN` | Token de aplicación otorgado por ellos para el rol gym; no incluir el prefijo Bearer ni espacios. El inicio no lo genera. |
| `CAR_CRUDS_TIMEOUT_MS` | Presupuesto total por consulta, 3000 ms por defecto; entero entre 1 y 30000 ms. Es una política de nuestro cliente, no un SLA bilateral. |

URL/token vacíos mantienen `503 CAR_CRUDS_NO_CONFIGURADO` sin impedir el portal. Configurar solo uno o proporcionar un valor inválido hace fallar el inicio de Socios antes de inicializar la base. No se completan credenciales ni URL ficticias. Con la URL/token reales se recreará Socios mediante el inicio habitual; no se modifica el origen del POST anterior.

Las lecturas permiten **un reintento máximo**, solo ante red o HTTP 502/503/504, con espera aleatoria de 75–124 ms dentro del presupuesto total. Este cubre conexión, cuerpo y espera; un primer intento que consume todo el tiempo no deja margen para repetir. Se rechazan redirecciones, JSON/Content-Type inválidos, cuerpos mayores a 1 MiB, esquemas incompatibles, IDs duplicados/diferentes, páginas incoherentes y enteros inseguros. Los nombres de hasta 150 caracteres y los IDs opacos de la lectura se conservan, sin recortarlos a las restricciones del alta antigua.

Una credencial externa rechazada produce `502 CAR_CRUDS_CREDENCIAL_RECHAZADA`, no 401 del gimnasio. Otros códigos propios son `CAR_CRUDS_EMPLEADO_NO_ENCONTRADO` (404), `CAR_CRUDS_SOLICITUD_RECHAZADA` y `CAR_CRUDS_RESPUESTA_INVALIDA` (502), `CAR_CRUDS_NO_DISPONIBLE` (503) y `CAR_CRUDS_TIEMPO_AGOTADO` (504). No se devuelve el texto privado del proveedor ni se cambia una membresía por esos resultados.

Para verificar: `npm run test:car-cruds` comprueba lecturas, permisos, vinculación, envío y respuesta perdida con dependencias controladas; `npm run test:postgres` verifica persistencia, concurrencia, recuperación y rollback con una base efímera. No requieren URL/token reales ni llaman al otro grupo. La conexión al servicio ejecutándose en Car Cruds continúa pendiente de prueba conjunta.

### Vinculación y membresía

El administrador elige explícitamente el vínculo `employeeId` ↔ `socioId` desde **Empleados Car Cruds**. Consulta empleados, selecciona uno y busca al socio por DNI o email completo; revisa ambos identificadores antes de confirmar. La búsqueda exacta puede devolver dos personas si un identificador coincide con el DNI de una y el correo de otra: la elección sigue siendo explícita.

El vínculo es **uno a uno dentro de Car Cruds**. Se permite corregir o quitar la asociación, conservando anterior/nuevo socio, administrador, fecha y versión. Consultar o vincular no habilita una membresía ni registra pagos.

Si hace falta un socio nuevo, se reutiliza **Alta de Socio**, con DNI, nombre, email y contraseña ingresados por el administrador. El alta y la asociación son acciones separadas: después se busca al socio y se confirma el vínculo. Si la asociación falla, la cuenta creada permanece sin una nueva membresía; no se presenta como un alta y vínculo atómicos.

| Ruta administrativa propia | Resultado |
|---|---|
| `GET /api/v1/integraciones/car-cruds/vinculos?page=1&pageSize=20` | Asociaciones actuales paginadas; disponibles aunque el proveedor esté caído. |
| `GET /api/v1/integraciones/car-cruds/empleados/{employeeId}/vinculo` | `{employeeId,socioId,version,actualizadoEn}`. Sin asociación previa devuelve socio/fecha null y versión 0. |
| `PUT /api/v1/integraciones/car-cruds/empleados/{employeeId}/vinculo` | Cuerpo `{socioId,versionEsperada}`; null quita la asociación. Responde el vínculo vigente. No admite actor, origen ni otros campos en el cuerpo. |
| `GET /api/v1/integraciones/car-cruds/empleados/{employeeId}/vinculo/historial` | `{items:[{historialId,employeeId,version,socioAnteriorId,socioNuevoId,administradorId,createdAt}]}`. |
| `POST /api/v1/integraciones/car-cruds/socios/buscar` | Cuerpo `{identificador}`, respuesta `{items:[SocioPublico]}`, sin hashes ni contraseñas. El dato de búsqueda no se coloca en la URL. |

Todas exigen el ADMIN actual del gimnasio y `Cache-Control:no-store`. Las consultas de vínculo/historial no admiten parámetros. La página local usa las mismas restricciones numéricas que la lectura externa.

Cada cambio comprueba `versionEsperada`: si otro administrador lo modificó, devuelve `409 VINCULO_DESACTUALIZADO` y requiere actualizar/revisar. `409 SOCIO_YA_VINCULADO` impide duplicar el socio; `404 SOCIO_NO_ENCONTRADO` impide apuntar a una cuenta inexistente. Repetir el estado ya vigente no escribe otra entrada de historial. La revisión se conserva incluso al quitar y volver a asociar, evitando que una pantalla antigua sobrescriba cambios posteriores.

Antes de asociar/corregir se comprueba el ID conocido en Car Cruds, **fuera de la transacción local**. Un error remoto impide esa escritura. `active:false` es informativo y no bloquea la asociación histórica ni cancela una membresía. La desvinculación manual y las consultas locales funcionan sin depender de la disponibilidad externa.

PostgreSQL guarda asociación y auditoría en una sola transacción en `car_cruds_vinculos` y `car_cruds_vinculos_historial`. Estas tablas separan la regla uno a uno de Car Cruds de las referencias y respuestas idempotentes de la API anterior. No se migran automáticamente aquellos vínculos ni se inventa un historial previo. La ausencia en una página externa nunca elimina una asociación.

### Fotografía mensual

El POST exige `employeeId`, `period`, `sourceReference`, `version` y `observedAt`. Los hechos `member`, `used`, `costMinor` y `spendingMinor` pueden ser `null` u omitirse. `currency` es obligatoria si se conoce algún importe. El contrato formal define tipos, longitudes y errores de validación; no admite propiedades adicionales.

| Campo | Perfil preparado para el intercambio |
|---|---|
| `period` | Mes `AAAA-MM` en `America/Argentina/Buenos_Aires`, desde el primer día incluido hasta el siguiente mes excluido. El mes actual es provisional hasta el corte. |
| `member` | Hubo membresía vigente en algún tramo del período hasta el corte. Se respetan las reglas de habilitación del gimnasio. El estado actual no permite reconstruir por sí solo toda la historia. |
| `used` | Existe al menos un ingreso efectivo registrado en ese período hasta el corte; una reserva no es asistencia. |
| `costMinor` | Costo neto del plan dividido por los meses contratados, imputable a un mes completo. No es el pago cobrado en ese mes. |
| `spendingMinor` | Pagos efectivamente registrados para la persona durante el mes hasta el corte. Un pago anual no se vuelve a repartir aquí. |
| `currency` | ARS, importes en centavos enteros no negativos; costo y pagos se presentan separados. |
| `observedAt` | Instante real de elaboración/comprobación de la fotografía con zona RFC3339. Es el corte informado; la precedencia la determina `version`. |

`null` significa desconocido; `false` y cero requieren información suficiente. Pagos y movimientos de Accesos no están implementados; tampoco se presume un historial completo de estados de membresía. El generador actual informa `member:true` si comprueba la habilitación al observar un instante del mes actual, o conserva una observación positiva anterior guardada del mismo empleado, socio y mes hasta el corte. En los demás casos informa `member:null`; no deduce un mes negativo de la situación actual. `used`, `costMinor` y `spendingMinor` permanecen en `null` y se omite moneda mientras no haya importes. Una fotografía de un mes anterior puede corregirse después, incluso si el empleado ahora está inactivo.

**Pendientes económicos:** meses parciales, distribución de fracciones de centavo y devoluciones/ajustes negativos. No se aplica una regla de redondeo ni una devolución sin acordarla. Los meses parciales mantienen `costMinor:null`; otros valores no demostrables o no representables también permanecen desconocidos o requieren revisión, sin convertirlos en cero.

### Preparar y enviar desde el panel

Con una sesión ADMIN, abrir **Empleados Car Cruds**, seleccionar el vínculo y usar **Información mensual para Car Cruds**. Elegir un mes no futuro, preparar la vista previa y revisar empleado, socio, referencia, versión, corte y hechos. **Confirmar envío** realiza el POST desde Socios. Se puede actualizar una vista previa aún no enviada; se conserva la anterior como historial y solo la última versión puede enviarse. La pantalla no permite editar los hechos ni elegir el actor o la referencia.

| Ruta propia, JWT ADMIN | Uso |
|---|---|
| `GET /api/v1/integraciones/car-cruds/empleados/{employeeId}/fotografias?period=AAAA-MM` | `{items:[RegistroFotografia]}` con todas las versiones locales del mes, incluso sin proveedor o vínculo actual. |
| `POST /api/v1/integraciones/car-cruds/empleados/{employeeId}/fotografias` | `{period,versionVinculoEsperada,versionAnteriorEsperada,confirmarCambioVinculo?}`. Guarda y devuelve HTTP 201 con la vista previa; no envía. Versión anterior 0 si es la primera. |
| `POST /api/v1/integraciones/car-cruds/fotografias/{fotografiaId}/enviar` | `{versionVinculoEsperada,confirmarRevision?}`. Usa el cuerpo guardado y devuelve su estado persistido. No admite hechos en el cuerpo. |

El registro incluye payload, socio y revisión del vínculo al preparar, administrador, fecha, estado, intentos y recibo/error seguro. `Cache-Control:no-store` y permisos actuales se aplican a las tres rutas. El POST externo limita `employeeId` a 100 caracteres; no se recortan IDs más largos admitidos por las lecturas. Mes/año y revisiones deben ser válidos, sin campos desconocidos ni parámetros repetidos.

`car_cruds_evidencias_series` conserva una referencia UUID por empleado/mes y la versión máxima; `car_cruds_evidencias` conserva las fotografías inmutables y su estado de entrega. La preparación usa una transacción con el bloqueo del vínculo y control de versión. Un trigger protege el cuerpo y su procedencia frente a cambios accidentales por SQL. No se habilitan membresías ni se escriben pagos.

### Reintentos y errores

El primer envío y cada reintento son manuales. Se guarda el cuerpo completo antes de llamar al proveedor. Cada intento hace un solo POST, con el presupuesto `CAR_CRUDS_TIMEOUT_MS` también aplicado al cuerpo de respuesta; no se mantienen bloqueos SQL durante HTTP. No hay cron ni reintento automático en cliente o gateway para estas escrituras.

| Estado guardado | Significado y recuperación |
|---|---|
| `PREPARADA` | Vista previa guardada, pendiente de confirmación de envío. |
| `ENVIANDO` | Una instancia reservó el intento durante 60 s. Tras una caída o fallo al guardar el recibo, vencido ese plazo puede reintentarse el mismo mensaje. |
| `PENDIENTE` | Red, timeout, 5xx, 408/429 o respuesta incierta. Consultar y reintentar la misma fotografía; no preparar otra para eludir el resultado incierto. |
| `RECIBIDA` | Respuesta válida HTTP 200 guardada. `applied:true` indica que el proveedor aplicó esa versión al responder; `false` reconoce repetición o atraso y no acredita la versión vigente allí. Reconfirmar localmente no hace otro POST. |
| `REQUIERE_REVISION` | Rechazo definitivo o fotografía pendiente de un vínculo corregido. Revisar antes de reintentar; un 409 no incrementa automáticamente la versión. |

Un UUID de intento impide que una respuesta tardía sobrescriba el resultado de un intento posterior. El lease usa la hora de PostgreSQL entre réplicas. El contador y el resultado se conservan entre reinicios. HTTP 200 de nuestra ruta informa el **estado local**; únicamente `RECIBIDA` acredita el recibo externo. Sin URL/token, el envío devuelve 503 sin consumir un intento; la preparación y consulta locales siguen disponibles.

- Un reintento conserva **todos los valores, incluido observedAt**. No crea una fecha, referencia o versión nueva por perderse la respuesta.
- Una corrección envía una fotografía completa con versión mayor; omitir un hecho lo convierte en desconocido, no conserva el valor anterior.
- Una versión atrasada no pisa la actual. Un 409 requiere revisión; no se aumenta la versión para eludir un conflicto.
- Este POST no utiliza el header `Idempotency-Key` del diseño anterior.

| Resultado externo | Tratamiento en el gimnasio |
|---|---|
| 400 / 415 | Revisar formato, campos o tipo de contenido. |
| 401 / 403 | Revisar credencial/permisos externos; no confundir con una sesión JWT vencida del usuario. |
| 404 | Revisar identificador; no inferir baja ni enviar una cancelación. |
| 409 | Conservar el conflicto para revisión. |
| 503 / timeout / respuesta perdida | Mantener el envío pendiente y reintentar manualmente el mismo contenido; no declarar éxito ni duplicar importes. |
| Respuesta inválida | Conservar incertidumbre y diagnosticar el incumplimiento del contrato. |

Corregir o quitar un vínculo conserva las fotografías anteriores y sus recibos. Para una nueva fotografía del socio actual se exige confirmar explícitamente el cambio. Una pendiente de la relación anterior pasa a revisión conservando su contenido y su incertidumbre; no se reenvía bajo el nuevo vínculo ni se borra lo recibido por Car Cruds. Un envío con lease vigente debe terminar o vencer antes de preparar esa corrección. Una desvinculación por sí sola no envía cancelaciones. No hay cuota por minuto ni SLA bilateral acordado.

### Implementación y aceptación pendientes

Lecturas, vinculación, vista previa guardada y envío tienen cliente, pantalla ADMIN, persistencia y pruebas controladas. URL alcanzable, token por canal privado y disponibilidad del entorno compartido se coordinarán con Car Cruds. No se crean valores de conexión ficticios ni se presenta localhost del proveedor como acceso remoto.

Los tests usan el OpenAPI fijado y comprueban rechazo de respuestas incompatibles, pérdida de respuesta después de recibir, repetición exacta y recuperación. PostgreSQL verifica concurrencia entre pools, rollback, cuerpo inmutable y descarte de respuestas tardías. La prueba conjunta pendiente cubrirá listado/estado, vínculo manual, desconocidos, replay exacto, corrección, versión atrasada, conflicto y caída/recuperación. El informe receptor lo verificará su administrador; el rol `gym` no tiene acceso a ese reporte. Las pruebas locales no sustituyen esa validación entre sistemas.

## Integracion de Tienda con FAV

Tienda mantiene una integración independiente de solo lectura. Se revisó [`feature-inventario`](https://github.com/JuanHernandez-99/Fav-del-universo/tree/feature-inventario): el catálogo público no informa stock y la lectura de inventario requiere permisos administrativos. Falta acordar una consulta de stock para consumidores y los datos de conexión. [D9](../adr/ADR-009-consumo-del-proveedor.md). Compras, consignación y reposiciones quedan fuera del alcance del gimnasio.

## API anterior: recepción de empleados

**Servicio propietario:** Socios y Membresías.

Para iniciar y usar el portal, consultar las [instrucciones y usuarios de prueba del README principal](../../README.md#usuarios-de-prueba). Para inspeccionar las altas persistidas, seguir [Consultar PostgreSQL desde Docker](../../README.md#consultar-las-bases-de-datos). Esta guía se concentra en el contrato y sus pruebas.

**Contrato:** [openapi-empleados-v1.yaml](openapi-empleados-v1.yaml), versión 1.0.1, OpenAPI 3.1.1.

**Estado:** POST persistente y mock conservados durante la transición. Esta API 1.0.1 del gimnasio sigue disponible localmente, pero no es el contrato 0.3.0 de Car Cruds ni implementa el nuevo flujo.

Este diseño reemplazó inicialmente la consulta de clases. [ADR-014](../adr/ADR-014-contrato-empleados.md) conserva esa decisión; [ADR-018](../adr/ADR-018-integracion-car-cruds.md) la reemplaza ahora para la integración con Car Cruds. El [contrato anterior de clases](openapi-v1.yaml) y sus pruebas se conservan como antecedentes; clases y reservas continúan como funciones del gimnasio.

**Origen:** sección 4.1 del enunciado, páginas 5-6 (integración y contrato); sección 6.2, páginas 7-8 (diseño y mock); sección 5, página 7 (historia de decisiones). Datos y reglas confirmados por el equipo el 19/10/2026.

### Operación y resultado

**POST /api/v1/integraciones/empleados**

El grupo consumidor envía un empleado para crear al socio y una solicitud de membresía pendiente. El administrador del gimnasio seleccionará el plan y confirmará el pago. Este POST no habilita una membresía ni genera una contraseña, sesión o permiso de administrador.

| Campo obligatorio | Significado |
|---|---|
| empleadoExternoId | Identificador del empleado en el sistema del grupo consumidor. |
| dni | DNI del empleado, expresado como texto. |
| nombre | Nombre del empleado. |
| email | Correo del empleado. |

Se eliminan espacios al principio y al final de los cuatro campos y se normaliza el email a minúsculas. El contrato declara sus tipos y longitudes; no admite campos adicionales como plan, contraseña, rol o grupo de origen.

La respuesta 201 contiene socioId, solicitudId, estadoSolicitud = PENDIENTE y membresiaHabilitada = false. La solicitud pendiente es distinta del estado de una membresía; no establece plan ni fechas de vigencia.

### Autenticación e idempotencia

- **X-API-Key:** identifica al grupo consumidor. El servidor obtiene el origen de la configuración de esa credencial; el cuerpo no puede elegirlo. En el entorno operativo se utilizará HTTPS y las credenciales se comunicarán fuera del repositorio.
- **Idempotency-Key:** es obligatoria y se interpreta dentro del grupo autenticado.
- Repetir la misma clave y los mismos datos normalizados devuelve el mismo resultado 201 y los mismos identificadores del alta original.
- Reutilizar la clave con datos distintos devuelve 409.
- Con otra clave se vuelven a comprobar los conflictos: DNI o email ya registrados, o un identificador externo reutilizado para otro DNI. Esos casos devuelven 409 sin sobrescribir ni crear registros.
- Las respuestas llevan Cache-Control: no-store. El mock agrega X-Mock: true, que identifica datos y persistencia simulados.

En el servicio operativo, socio, solicitud, referencia externa y respuesta de idempotencia se guardan en una única transacción PostgreSQL. Los reintentos simultáneos entre instancias y después de reiniciar conservan los mismos identificadores. Los errores no consumen la clave como un alta exitosa. Se conserva el resultado original sin caducidad automática en esta etapa; el replay no consulta si la membresía cambió posteriormente.

**Límite del mock:** las claves, altas y solicitudes solo se recuerdan mientras vive el proceso. Reiniciarlo borra ese estado. Estas garantías persistentes se comprueban por separado contra el backend real, no mediante el mock.

### Ejecutar y probar el servicio operativo

Desde la raíz del proyecto:

~~~sh
node scripts/iniciar.mjs
~~~

Este comando construye el servicio con el contrato incluido en su imagen y publica `POST http://localhost:8080/api/v1/integraciones/empleados` (o el puerto `GATEWAY_PORT`). La configuración de integración es:

| Variable | Uso |
|---|---|
| `EMPLEADOS_API_KEY` | Credencial propia de esta integración, generada aleatoriamente si falta; distinta de CAPACIDAD_API_KEY, SERVICIOS_API_KEY y JWT. No se versiona. |
| `EMPLEADOS_ORIGEN_ID` | Identificador estable de origen asociado a la clave. El inicio completa `grupo-ficticio-local` si no se configuró; es solo un marcador de prueba, no la identidad real del grupo. |

El script conserva las credenciales existentes. Mantener origen y clave al reiniciar; cambiar el origen cambia el ámbito de idempotencia. La configuración por entorno del servidor actual corresponde a un consumidor; las pruebas utilizan dos orígenes configurados explícitamente para comprobar su separación.

#### Ejemplo operativo en PowerShell

Abrir PowerShell en la carpeta del repositorio, donde está `.env`, después del inicio:

~~~powershell
$claveEmpleados = (Select-String -LiteralPath .env -Pattern '^EMPLEADOS_API_KEY=').Line.Split('=', 2)[1]
$bodyEmpleado = @{
    empleadoExternoId = 'empleado-demo-001'
    dni = '40111222'
    nombre = 'Empleado Ficticio'
    email = 'empleado.demo@example.com'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/api/v1/integraciones/empleados' -ContentType 'application/json' -Headers @{
    'X-API-Key' = $claveEmpleados
    'Idempotency-Key' = 'alta-demo-001'
} -Body $bodyEmpleado
~~~

Usar el puerto configurado si difiere de 8080. Se obtiene HTTP 201 con los IDs, `estadoSolicitud: PENDIENTE` y `membresiaHabilitada: false`, sin `X-Mock`. Repetir el mismo comando devuelve los mismos IDs incluso después de reiniciar. Cambiar datos conservando esa clave devuelve 409. El POST no devuelve contraseña ni JWT; no permite iniciar sesión por el empleado ni asignar plan, pago o rol ADMIN.

### Errores

| HTTP | Código | Acción del consumidor |
|---|---|---|
| 400 | PARAMETROS_INVALIDOS | Corregir campos, JSON o clave de idempotencia según el contrato. |
| 401 | NO_AUTENTICADO | Revisar X-API-Key; la respuesta incluye el desafío de autenticación. |
| 409 | IDEMPOTENCIA_EN_CONFLICTO | No reutilizar una clave para otra solicitud. |
| 409 | EMPLEADO_EXTERNO_EN_CONFLICTO | Revisar la identificación del empleado; no se actualiza el alta existente. |
| 409 | DNI_EXISTENTE | Resolver el DNI ya registrado mediante la administración del gimnasio. |
| 409 | EMAIL_EXISTENTE | Corregir o resolver el email ya registrado. |
| 415 | TIPO_CONTENIDO_NO_ADMITIDO | Enviar el cuerpo como application/json. |
| 500 | ERROR_INTERNO | El resultado no debe suponerse exitoso; resolver o reintentar la misma solicitud con su misma clave. |

Los mensajes son explicativos; el consumidor interpreta los códigos estables. El mock no simula disponibilidad del proveedor ni errores de PostgreSQL.

### Ejecutar el mock

Desde la raíz del proyecto, con Node.js 22 y las dependencias instaladas:

~~~sh
npm ci --ignore-scripts
npm run mock:empleados
~~~

El mock escucha solo en http://127.0.0.1:3005. Sus valores predeterminados son ficticios:

- X-API-Key: clave-ficticia-solo-pruebas.
- Grupo asociado: grupo-ficticio.
- Puerto configurable con MOCK_EMPLEADOS_PORT; credencial y grupo configurables con MOCK_EMPLEADOS_API_KEY y MOCK_EMPLEADOS_GRUPO_ID.

Este comando compila Socios y Membresías y arranca únicamente el mock separado. No inicia el servidor operativo, Docker ni bases de datos. Se detiene con Ctrl+C.

#### Ejemplo en PowerShell

En otra terminal:

~~~powershell
$bodyEmpleado = @{
    empleadoExternoId = 'empleado-demo-001'
    dni = '40111222'
    nombre = 'Empleado Ficticio'
    email = 'empleado.demo@example.com'
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3005/api/v1/integraciones/empleados' -ContentType 'application/json' -Headers @{
    'X-API-Key' = 'clave-ficticia-solo-pruebas'
    'Idempotency-Key' = 'alta-demo-001'
} -Body $bodyEmpleado
~~~

Se obtienen los identificadores ficticios generados y la solicitud PENDIENTE, con membresiaHabilitada en false. Repetir el comando durante la misma ejecución devuelve esos mismos identificadores.

Todos los datos del ejemplo son ficticios. Las claves mostradas son exclusivas de demostración y no representan credenciales operativas.

### Comprobar el contrato

~~~sh
npm run test:contrato-empleados
~~~

Ese comando conserva las 11 pruebas del mock y los esquemas del contrato. Para comprobar también el servidor operativo y PostgreSQL:

~~~sh
npm test
npm run test:postgres
~~~

La suite incluye 7 casos adicionales del endpoint operativo con el adaptador en memoria. La prueba PostgreSQL usa un contenedor efímero propio y HTTP real con dos instancias de Socios; comprueba 20 reintentos, unicidad concurrente, replay tras recrear el servicio y rollback total ante un fallo provocado. Ninguna de estas comprobaciones acredita una integración con el otro grupo ni una habilitación por pago.

### Versionado y pendientes

- La versión 1.0.0 fue el diseño inicial de la API de empleados. La versión 1.0.1 actualiza descripciones y servidores al estado operativo; conserva los mismos campos, códigos y comportamiento. El contrato anterior de clases mantiene su versión y rutas.
- Cambios incompatibles requieren una nueva versión mayor y coordinación con el consumidor. Cambios compatibles incrementan la menor; correcciones documentales compatibles, el parche.
- Car Cruds ya está identificado y el intercambio vigente es el descrito arriba. Este POST se conserva como implementación anterior; su mock y sus pruebas no acreditan la nueva integración.
- Tienda mantiene su integración separada con FAV, descrita arriba y en [D9](../adr/ADR-009-consumo-del-proveedor.md).

## Planes y pagos manuales (contrato propio adicional)

[openapi-membresias-v1.yaml](openapi-membresias-v1.yaml) define gestión ADMIN de planes/solicitudes/pagos y consultas del socio propietario. PostgreSQL, JWT e Idempotency-Key obligatorios para comandos. No es una pasarela ni modifica las APIs de Car Cruds/empleados. [Garantías](../adr/ADR-021-planes-pagos-membresias.md).
