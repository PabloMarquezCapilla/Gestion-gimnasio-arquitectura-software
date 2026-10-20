# Sistema integral de gestión de gimnasio

Trabajo Práctico Integrador — Arquitectura de Software 2026

**Guías:** [Inicio](#ejecutar-localmente) · [Usuarios de prueba](#usuarios-de-prueba) · [Consultar las bases](#consultar-las-bases-de-datos) · [Documentación](#documentación).

## Integrantes

- Lorenzo Rossi
- Jose Baudino
- Pablo Marquez

## Dominio

Sistema integral de gestión de gimnasios orientado a membresías, pagos y comprobantes internos, reserva de clases, control de acceso y ocupación de sedes. Incluye la recepción de empleados de otro grupo y la consulta de productos y stock de una distribuidora.

## Objetivo

Construir una plataforma que permita gestionar el ciclo completo de un socio dentro de un gimnasio: alta, renovación y vigencia de membresías, registro de pagos y comprobantes internos, búsqueda y reserva de actividades con cupos limitados, control de ingreso y consulta de ocupación de las sedes.

## Alcance

El sistema contemplará inicialmente:

- Gestión de socios y membresías por el administrador.
- Planes con distintos beneficios y vigencias. En la primera versión, una membresía habilitada permite reservar cualquier clase y sede.
- Registro de pagos por el administrador, con comprobantes internos y habilitación de las altas y renovaciones al confirmar el pago correspondiente.
- Búsqueda de clases por actividad, sede, profesor, día y horario.
- Reserva de clases con capacidad limitada.
- Lista de espera cuando una clase no tenga cupos disponibles.
- Cancelación de reservas y reasignación de cupos.
- Control de acceso al gimnasio según el estado de la membresía.
- Registro de ingresos y egresos por recepción desde la aplicación, sin dispositivos físicos y con validación de alternancia por socio y sede.
- Consulta de ocupación actual de cada sede.
- Recepción de empleados de otro grupo para crear socios con solicitud de membresía pendiente de pago.
- Consulta de productos y stock de una distribuidora desde Tienda, sin compras ni reposición.

## Flujo principal

1. El socio consulta su membresía y busca una clase.
2. Solicita reservar antes del inicio de la clase.
3. El sistema valida la habilitación actual de la membresía y su vigencia para la fecha de la clase, evita reservas confirmadas duplicadas y comprueba la disponibilidad respetando la prioridad de la lista de espera.
4. Si se cumplen las condiciones y existe cupo para ese socio, se confirma la reserva. Si la clase está llena, el socio puede elegir ingresar a la lista de espera.
5. Una cancelación anterior al inicio libera el cupo y activa la promoción automática por orden de inscripción, validando nuevamente la membresía de las personas en espera. Si Socios no responde, la cancelación se conserva y la promoción queda pendiente de reintento sin perder la prioridad.

Las reglas de negocio, exclusiones y criterios de aceptación están en [ALCANCE_PRELIMINAR.md](docs/ALCANCE_PRELIMINAR.md). El dominio fue aprobado por la cátedra. Las funcionalidades del alcance que aún no tienen backend se identifican a continuación.

## Estado de implementación

| Componente | Disponible | Pendiente |
|---|---|---|
| Socios y Membresías | Login JWT, permisos, altas administrativas, consulta de membresías y POST persistente de empleados. | Planes/pagos/comprobantes, renovación/reactivación y resolución administrativa de solicitudes; acceso personal de empleados recibidos. |
| Clases y Reservas | Catálogo por sede/fechas, reservas, cancelación, espera FIFO y recuperación de promociones; PostgreSQL y dos réplicas. | Publicación administrativa de clases, consulta textual FTS y cancelación de reservas por cambios posteriores de membresía. |
| Accesos y Ocupación | Estructura HTTP y MongoDB configurado. | Movimientos, ocupación, persistencia de negocio y caché. |
| Tienda | Servicio y sección web con JWT; informa `503 INTEGRACION_PENDIENTE`. | Contrato, URL, autenticación y consumo real de la distribuidora. |
| Gateway y portal | NGINX, rutas, portal React, balanceo y logs de destinos. | Despliegue público y frontend completo de los flujos pendientes. |

La capacidad ofrecida es **POST `/api/v1/integraciones/empleados`**, de Socios y Membresías. El consumidor envía ID externo, DNI, nombre y email; se crea un socio y una solicitud `PENDIENTE`, sin membresía ni contraseña. `X-API-Key` identifica el origen e `Idempotency-Key` evita duplicar el alta. Contrato **1.0.1**, ejemplos y mock en [docs/contracts/README.md](docs/contracts/README.md). Reemplaza a clases como capacidad compartida; sus consultas siguen disponibles para el gimnasio.

**Acceso desplegado:** todavía no hay URL pública acordada ni prueba conjunta con los otros grupos. La implementación está verificada localmente. La publicación accesible requerida en §4.1 y el despliegue de la presentación final siguen pendientes; no se considera completa la integración entre grupos.

## Arquitectura y estructura

Se utiliza Node.js 22, TypeScript y Fastify; React/Vite para el portal y NGINX como entrada. Clases aplica Hexagonal y Socios, Capas. PostgreSQL 17 está integrado; MongoDB 8.0 y RabbitMQ 4.1 están configurados, sin flujo de Accesos ni eventos de dominio operativos. Redis es una propuesta pendiente.

```text
services/
  socios-membresias/     # Cuentas, habilitación y recepción de empleados
  clases-reservas/       # Catálogo, reservas y espera
  accesos-ocupacion/     # Estructura; dominio pendiente
  tienda/               # Estructura; proveedor pendiente
frontend/               # Portal React
infra/                  # Imágenes, gateway e inicializadores de dependencias
scripts/                # Inicio, bootstrap administrativo y verificaciones
```

Responsabilidades, propiedad de datos, diagramas y limitaciones: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Las tecnologías son decisiones del grupo; el enunciado no exige un framework concreto.

## Ejecutar localmente

### Requisitos e inicio

- Node.js **22**, Docker Desktop iniciado con contenedores Linux y Docker Compose v2 o posterior.
- Ejecutar desde `Gestion-gimnasio-arquitectura-software`, donde están `package.json` y `compose.yaml`.

```powershell
node --version
docker compose version
npm run iniciar
```

El inicio automatizado valida el entorno, genera las credenciales locales ausentes, construye el portal y los cuatro servicios e inicia las dependencias. La primera ejecución necesita Internet. Para iniciar el entorno completo no hace falta instalar las bases ni paquetes npm en Windows: las imágenes realizan su instalación. Las pruebas locales sí requieren las dependencias indicadas más abajo.

El script conserva `.env`. Si ya existen volúmenes pero falta ese archivo, recuperar el original; cambiar las claves no actualiza las credenciales persistidas. `.env` no se publica; `.env.example` contiene la configuración de referencia. La única entrada publicada es `localhost:8080`, configurable mediante `GATEWAY_PORT`.

| Acceso local | Uso |
|---|---|
| [http://localhost:8080](http://localhost:8080) | Portal del socio y administración. |
| [http://localhost:8080/consola.html](http://localhost:8080/consola.html) | Consola técnica de clases, reservas y trazas. |
| `/health/socios`, `/health/clases` | Salud del proceso y conectividad con PostgreSQL. |
| `/health/accesos`, `/health/tienda` | Salud de las estructuras HTTP; no acredita negocio ni proveedor conectado. |
| `/metrics/socios`, `/metrics/clases` | Métricas básicas compatibles con Prometheus. |

Las rutas de salud son decisiones operativas para comprobar disponibilidad, no reglas de negocio. La configuración local usa HTTP; HTTPS y la URL compartida deben resolverse al publicar.

### Usuarios de prueba


Las siguientes cuentas están definidas en `services/socios-membresias/src/repository.ts`. Todas tienen rol **SOCIO** y contraseña inicial ficticia **`socio123`**:

| DNI | Nombre | Email | Membresía inicial |
|---|---|---|---|
| `11111111` | Juan Pérez | `juan.perez@example.com` | Habilitada, del 01/01/2026 al 31/12/2027. |
| `22222222` | María Gómez | `maria.gomez@example.com` | Habilitada, del 01/01/2026 al 31/12/2027. |
| `33333333` | Lucas Silva | `lucas.silva@example.com` | Habilitada, del 01/01/2026 al 31/12/2027. |
| `44444444` | Pedro Vencido | `pedro.vencido@example.com` | Vencida desde 2025. |
| `55555555` | Ana Suspendida | `ana.suspendida@example.com` | Suspendida. |

La inicialización incorpora las cuentas de demostración faltantes; no restablece una contraseña ya guardada ni reemplaza una membresía existente del mismo identificador. Si se modificaron esos datos, su estado puede diferir de esta tabla. La habilitación también depende de la fecha de la clase.

**Administrador:** no se genera una nueva cuenta ADMIN con contraseña predeterminada. Si todavía no hay una cuenta administrativa elegida por el equipo, ejecutar con el entorno iniciado:

```powershell
npm run crear-admin
```

Ingresar DNI, nombre, email, contraseña y confirmación. Para acceder después, usar esos datos. El comando rechaza un DNI/email existente sin sobrescribirlo. Las cuentas administrativas anteriores se conservan; las contraseñas reales no se documentan en el repositorio.

### Comprobar el uso del portal

| Prueba | Resultado esperado |
|---|---|
| Contraseña incorrecta | Error; no se inicia sesión. |
| Ingresar como Juan y reservar una clase futura con cupo | Perfil propio y reserva confirmada; un cupo menos. No se permite duplicarla. |
| Cancelar antes del inicio | Reserva cancelada; si hay espera, promoción automática recuperable. |
| Elegir entrar a la espera de una clase llena | Espera registrada solo por elección del socio; no se confirma sin cupo. |
| Reservar como Pedro o Ana | Rechazo por membresía vencida/suspendida. |
| Crear socio como ADMIN | Cuenta SOCIO sin membresía; se conserva la sesión del administrador. DNI/email repetidos se rechazan. |
| Abrir Tienda o consultar pagos/reactivación | Se muestran los pendientes; no se simulan productos, pagos ni habilitaciones. |

El JWT se guarda en memoria: recargar la página o recibir un 401 requiere nuevo login. En una base nueva, Yoga del 12/11/2026 tiene tres cupos y Pilates del mismo día está llena; los movimientos cambian esos valores. Las fechas de demostración son fijas: las clases iniciadas rechazan nuevas reservas, espera y cancelaciones.

Para probar el POST de empleados, usar el [ejemplo operativo PowerShell](docs/contracts/README.md#ejemplo-operativo-en-powershell): alta nueva 201, misma clave/cuerpo mismos IDs, clave reutilizada con otros datos 409 y credencial inválida 401. Ese POST no habilita membresías ni permite iniciar sesión por el empleado.

### Estado, logs y detención

```powershell
docker compose ps
docker compose logs --tail 50
docker compose stop
```

Los datos se conservan al detener el entorno. `npm run iniciar` vuelve a iniciarlo. Si falla el arranque: comprobar Docker en modo Linux, Node 22, puerto libre y correspondencia de `.env` con los volúmenes. Para revisar inicializadores: `docker compose logs --no-color postgres-init mongo-init mongodb rabbitmq`.

## Consultar las bases de datos

Con el entorno iniciado, abrir PowerShell en la raíz. Entrar al cliente de PostgreSQL del contenedor:

```powershell
docker compose exec postgres psql -U postgres -d socios
```

El rol `postgres` es administrativo local; cada servicio utiliza su propio usuario. Cuando aparezca `socios=#`, los comandos siguientes se ejecutan **dentro de psql**, no en PowerShell:

```text
\pset pager off
\dt
```

Listar tablas y consultar socios, membresías y altas externas sin mostrar hashes:

```sql
SELECT socio_id, dni, nombre, email, rol, estado FROM socios;
SELECT membresia_id, socio_id, tipo_plan, estado, fecha_inicio, fecha_fin FROM membresias;
SELECT solicitud_id, socio_id, estado FROM solicitudes_membresia;
SELECT origen, empleado_externo_id, socio_id FROM empleados_externos;
```

Cambiar a la base propia de Clases:

```text
\c clases
\pset pager off
\dt
```

```sql
SELECT clase_id, nombre, sede_id, inicio, capacidad FROM clases;
SELECT reserva_id, clase_id, socio_id, estado FROM reservas;
SELECT espera_id, clase_id, socio_id, orden, estado FROM lista_espera;
```

Al reservar y luego cancelar desde la web, el registro pasa de `CONFIRMADA` a `CANCELADA`; no se borra. Para salir de psql, escribir `\q`. MongoDB está preparado, pero Accesos aún no persiste movimientos. Tienda no tiene base propia.

## Pruebas y evidencia

Instalar las dependencias locales antes de compilar o ejecutar las pruebas:

```powershell
npm ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
```

| Comando | Qué comprueba |
|---|---|
| `npm test` | Compilación de los cuatro servicios y reglas/contratos con adaptadores en memoria; incluye API del frontend. Última verificación: 68/68, sin omitidas, 19/10/2026. |
| `npm run frontend:build` | TypeScript y bundle de producción del portal. |
| `npm run test:contrato-empleados` | Contrato y mock separado de empleados (11 pruebas). |
| `npm run test:postgres` | HTTP real, PostgreSQL efímero, dos instancias por servicio, permisos, reintentos/rollback de empleados, último cupo, FIFO con fallas, traza y línea base de carga. |
| `npm run test:balanceo` | Compose completo aislado, dos réplicas, distribución, escrituras concurrentes y caída/reemplazo sin reiniciar el gateway. |

Los dos últimos requieren Docker, usan recursos temporales propios, no cargan `.env` y los retiran al terminar. Los tests en memoria no acreditan durabilidad. Para desarrollar solo el portal: `npm run frontend:dev`, manteniendo el backend iniciado.

Los resultados de carga y sus límites están en [D13](docs/adr/ADR-013-capacidad-y-costos.md); la primera traza, en [D11](docs/adr/ADR-011-observabilidad.md); la caída controlada y sus cuatro 504 transitorios durante detección, en [POSTMORTEM](docs/POSTMORTEM.md). La operación estable posterior y la recuperación se verificaron; no se promete una transición sin errores ni capacidad máxima.

## Ramas, revisión e integración

Los cambios de esta entrega se preparan en `entrega-2` y se revisan mediante PR hacia `main`. Antes de integrar, revisar diferencias, pruebas y coherencia documental. La versión evaluable debe quedar en `main` (§2.12). Las credenciales locales permanecen fuera de Git.

## Documentación

| Documento | Contenido y referencia del enunciado |
|---|---|
| [Alcance](docs/ALCANCE_PRELIMINAR.md) | Funcionalidades, reglas y criterios de aceptación; equivalente a SPEC (§3). |
| [Arquitectura](docs/ARCHITECTURE.md) | Servicios, datos, comunicaciones, diagramas, decisiones y limitaciones (§3, §6.2–6.3). |
| [ADR](docs/ARCHITECTURE.md#decisiones-arquitectónicas) | D1–D13 y decisiones adicionales; los reemplazados conservan su historia (§5). |
| [Contrato e integración](docs/contracts/README.md) | Capacidad ofrecida, versión, ejemplos, errores, autenticación e idempotencia (§4.1). |
| [Postmortem](docs/POSTMORTEM.md) | Ensayo local de caída: impacto, secuencia, detección, respuesta, causa y mejoras (§2.9 y §3). |

E1 (§6.2) queda representada por alcance, arquitectura/diagramas, límites, estructura y contrato/mock; E2 (§6.3), por el flujo operativo, capacidad ofrecida local, PostgreSQL, logs/traza y ADR actualizados. D9 conserva pendientes de contrato externo y la publicación compartida aún debe coordinarse. La implementación completa de búsqueda, caché, mensajería, Accesos y frontend, además del despliegue y la integración real, sigue pendiente para los requisitos generales y la presentación final (§6, páginas 8–9).
