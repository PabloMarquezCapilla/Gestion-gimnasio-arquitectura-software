# D8 - Contrato de recepción de empleados

**Estado:** diseño confirmado e implementado con PostgreSQL y gateway localmente. Mock separado conservado; publicación accesible y prueba conjunta con el consumidor pendientes.
**Fecha:** 19/10/2026.
**Reemplaza:** [ADR-008 - Contrato de la capacidad propia](ADR-008-contrato-propio.md).

## Contexto y requisitos

La asignación del profesor, transmitida por el equipo, sustituye la consulta de clases y cupos como capacidad ofrecida por la recepción de empleados de otro grupo para gestionar sus membresías. Clases y reservas continúan como funciones del gimnasio.

- La sección 4.1 del enunciado, páginas 5-6, requiere una capacidad publicada con contrato formal y versionado, ejemplos, errores, autenticación e idempotencia.
- La sección 6.2, páginas 7-8, exige el diseño, D8 y un contrato con mock; la sección 6.3, página 8, pide actualizar D8 cuando cambie el contrato y presentar la capacidad operativa.
- La sección 5, página 7, exige conservar el ADR anterior como reemplazado y registrar la decisión que lo sucede.

El equipo confirmó los datos mínimos del empleado, la solicitud pendiente de pago, el propietario del POST y las reglas de conflictos y reintentos. Todavía no se dispone del repositorio, identificación ni datos de conexión de los otros grupos.

## Decisión

### Capacidad y propietario

**Socios y Membresías** es responsable de `POST /api/v1/integraciones/empleados`. El consumidor envía `empleadoExternoId`, `dni`, `nombre` y `email`.

- Una credencial del grupo enviada en `X-API-Key` determina el origen. El cuerpo no puede elegir ni suplantar ese origen.
- El alta aceptada crea al socio y una **solicitud de membresía `PENDIENTE`**. La respuesta contiene los identificadores de ambos y `membresiaHabilitada: false`.
- La solicitud es un recurso distinto de la membresía: no se agrega `PENDIENTE` al enum actual de membresías por este cambio de diseño.
- El administrador selecciona el plan y confirma el pago para habilitar la membresía. El POST no define plan, fechas de vigencia, contraseñas, sesiones ni privilegios administrativos.
- DNI o email existentes se rechazan sin sobrescribir datos. El identificador externo se interpreta dentro del grupo autenticado; reutilizarlo con otro DNI también produce conflicto.

### Idempotencia

Se requiere `Idempotency-Key`. El grupo, la clave y los datos normalizados identifican una repetición:

- Misma clave, mismo grupo y mismos datos: se devuelven el resultado y los identificadores del alta original, sin crear registros adicionales.
- Misma clave y otros datos: conflicto.
- Otra clave: se aplican nuevamente las restricciones de empleado, DNI y email existentes, sin convertir el alta en una actualización.

La implementación persistente conserva origen, clave, datos normalizados y resultado junto al alta en una única transacción. Los bloqueos consultivos por origen/clave y origen/empleado serializan reintentos entre instancias; índices únicos protegen DNI/email, y un fallo revierte todos los registros. El mock solo conserva estado durante su ejecución.

### Contrato y compatibilidad

Se publica [openapi-empleados-v1.yaml](../contracts/openapi-empleados-v1.yaml), versión `1.0.1`, como contrato independiente para esta capacidad. `1.0.0` fue la versión inicial del mock; `1.0.1` actualiza descripciones y servidores al estado operativo, sin cambiar campos, respuestas ni reglas. Su guía está en [docs/contracts/README.md](../contracts/README.md).

El [contrato anterior de clases](../contracts/openapi-v1.yaml) se conserva como antecedente y para las pruebas existentes. Las APIs tienen rutas y versiones independientes: empleados `1.0.1` y clases `1.0.0`. Los GET de clases se conservan como funciones del gimnasio.

Los cambios incompatibles futuros en la API de empleados requerirán una nueva versión mayor y coordinación con el consumidor. Los cambios compatibles incrementarán la versión menor y las correcciones documentales compatibles, la de parche.

### Estado de implementación

El mock separado utiliza datos ficticios y memoria. Permite comprobar el contrato sin iniciar el backend operativo ni conectarse a PostgreSQL.

El servidor operativo y el gateway exponen el POST. `empleados.http.ts` valida el contrato y la credencial; `EmpleadosService` prepara el alta; `PostgresSociosRepository` guarda socio, solicitud, referencia externa e idempotencia atómicamente. Es parte de la arquitectura en Capas de D2, sin un microservicio nuevo.

La credencial se configura con `EMPLEADOS_API_KEY` y el origen con `EMPLEADOS_ORIGEN_ID`, distintos del JWT, la clave técnica y la API anterior de clases. El inicio local agrega una clave aleatoria ausente y el origen `grupo-ficticio-local` si no existe configuración. Este nombre es solo un marcador de prueba; no representa una identidad asignada al consumidor. La credencial no permite administrar socios ni consultar sus datos personales.

La coordinación con pagos, el acceso personal de estos socios y una URL accesible al otro grupo siguen pendientes. Se crea la cuenta SOCIO sin contraseña ni membresía; la solicitud queda PENDIENTE. El replay devuelve el resultado original del alta, no una consulta del estado actual de una membresía futura.

**Verificación:** `npm test` conserva las 11 pruebas del mock y agrega 7 del servidor operativo. `npm run test:postgres` verifica 20 reintentos simultáneos entre dos instancias, unicidad concurrente, recuperación del replay tras recrear el servidor y rollback ante un fallo provocado al final de la transacción. La prueba de Docker/gateway se reproduce con `npm run test:balanceo`; sus resultados están en D12 y el postmortem.

## Alternativas consideradas

- **Mantener la consulta de clases como capacidad ofrecida:** descartado por la asignación confirmada del profesor.
- **Crear un servicio adicional solo para recibir empleados:** no se incorpora en este diseño; el equipo confirmó que la responsabilidad pertenece a Socios y Membresías.
- **Habilitar una membresía al recibir el POST:** descartado; requiere selección del plan y confirmación del pago por el administrador.
- **Actualizar un socio existente o tratar cada reintento como un alta nueva:** descartado por las reglas confirmadas de conflictos e idempotencia.
- **Reescribir el contrato anterior como si siempre hubiera descrito empleados:** descartado para preservar su historia y las pruebas del contrato anterior.

## Consecuencias

- El consumidor puede conocer el alta y su estado pendiente sin recibir una habilitación inexistente.
- Los reintentos no deben duplicar socios ni solicitudes; los conflictos requieren corregir la solicitud o resolver el registro por los mecanismos administrativos correspondientes.
- Contrato, mock y backend operativo tienen estados explícitos y comprobaciones diferentes.
- Sigue pendiente acordar con los otros grupos la publicación accesible, sus credenciales y la validación conjunta usando datos ficticios.
