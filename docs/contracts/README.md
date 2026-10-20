# Capacidad compartida: recepción de empleados

**Servicio propietario:** Socios y Membresías.

Para iniciar y usar el portal, consultar las [instrucciones y usuarios de prueba del README principal](../../README.md#usuarios-de-prueba). Para inspeccionar las altas persistidas, seguir [Consultar PostgreSQL desde Docker](../../README.md#consultar-las-bases-de-datos). Esta guía se concentra en el contrato y sus pruebas.

**Contrato:** [openapi-empleados-v1.yaml](openapi-empleados-v1.yaml), versión 1.0.1, OpenAPI 3.1.1.

**Estado:** POST persistente disponible por el gateway local y mock separado conservado. La URL accesible al otro grupo, su identidad operativa, credenciales compartidas y prueba conjunta siguen pendientes.

Esta capacidad reemplaza la consulta de clases como integración ofrecida por asignación del profesor confirmada por el equipo. Su justificación está en [D8, ADR-014](../adr/ADR-014-contrato-empleados.md), que reemplaza [ADR-008](../adr/ADR-008-contrato-propio.md). El [contrato anterior de clases](openapi-v1.yaml) y sus pruebas se conservan como antecedentes; clases y reservas continúan como funciones del gimnasio.

**Origen:** sección 4.1 del enunciado, páginas 5-6 (integración y contrato); sección 6.2, páginas 7-8 (diseño y mock); sección 5, página 7 (historia de decisiones). Datos y reglas confirmados por el equipo el 19/10/2026.

## Operación y resultado

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

## Autenticación e idempotencia

- **X-API-Key:** identifica al grupo consumidor. El servidor obtiene el origen de la configuración de esa credencial; el cuerpo no puede elegirlo. En el entorno operativo se utilizará HTTPS y las credenciales se comunicarán fuera del repositorio.
- **Idempotency-Key:** es obligatoria y se interpreta dentro del grupo autenticado.
- Repetir la misma clave y los mismos datos normalizados devuelve el mismo resultado 201 y los mismos identificadores del alta original.
- Reutilizar la clave con datos distintos devuelve 409.
- Con otra clave se vuelven a comprobar los conflictos: DNI o email ya registrados, o un identificador externo reutilizado para otro DNI. Esos casos devuelven 409 sin sobrescribir ni crear registros.
- Las respuestas llevan Cache-Control: no-store. El mock agrega X-Mock: true, que identifica datos y persistencia simulados.

En el servicio operativo, socio, solicitud, referencia externa y respuesta de idempotencia se guardan en una única transacción PostgreSQL. Los reintentos simultáneos entre instancias y después de reiniciar conservan los mismos identificadores. Los errores no consumen la clave como un alta exitosa. Se conserva el resultado original sin caducidad automática en esta etapa; el replay no consulta si la membresía cambió posteriormente.

**Límite del mock:** las claves, altas y solicitudes solo se recuerdan mientras vive el proceso. Reiniciarlo borra ese estado. Estas garantías persistentes se comprueban por separado contra el backend real, no mediante el mock.

## Ejecutar y probar el servicio operativo

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

### Ejemplo operativo en PowerShell

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

## Errores

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

## Ejecutar el mock

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

### Ejemplo en PowerShell

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

## Comprobar el contrato

~~~sh
npm run test:contrato-empleados
~~~

Ese comando conserva las 11 pruebas del mock y los esquemas del contrato. Para comprobar también el servidor operativo y PostgreSQL:

~~~sh
npm test
npm run test:postgres
~~~

La suite incluye 7 casos adicionales del endpoint operativo con el adaptador en memoria. La prueba PostgreSQL usa un contenedor efímero propio y HTTP real con dos instancias de Socios; comprueba 20 reintentos, unicidad concurrente, replay tras recrear el servicio y rollback total ante un fallo provocado. Ninguna de estas comprobaciones acredita una integración con el otro grupo ni una habilitación por pago.

## Versionado y pendientes

- La versión 1.0.0 fue el diseño inicial de la API de empleados. La versión 1.0.1 actualiza descripciones y servidores al estado operativo; conserva los mismos campos, códigos y comportamiento. El contrato anterior de clases mantiene su versión y rutas.
- Cambios incompatibles requieren una nueva versión mayor y coordinación con el consumidor. Cambios compatibles incrementan la menor; correcciones documentales compatibles, el parche.
- Todavía faltan identificación y datos de conexión del otro grupo, credenciales operativas y URL de publicación. El mock local no es la URL compartida requerida para la capacidad operativa.
- El servicio Tienda, separado y sin una base de datos nueva, consumirá productos y stock de la distribuidora según [D1, ADR-015](../adr/ADR-015-limites-con-tienda.md). Su estructura propia está preparada, pero el cliente y el contrato externo siguen pendientes; esta guía no inventa esa API.
