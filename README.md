# Sistema integral de gestión de gimnasio

Trabajo Práctico Integrador — Arquitectura de Software 2026

**Guías:** [Inicio](#ejecutar-localmente) · [Despliegue](docs/DEPLOY.md) · [Tablero](#observabilidad) · [Usuarios de prueba](#usuarios-de-prueba) · [Consultar las bases](#consultar-las-bases-de-datos) · [Documentación](#documentación).

## Integrantes

- Lorenzo Rossi
- Jose Baudino
- Pablo Marquez

## Dominio

Sistema integral de gestión de gimnasios orientado a membresías, pagos y comprobantes internos, reserva de clases, control de acceso y ocupación de sedes. Incluye la vinculación de empleados de Car Cruds con socios y el envío de información de membresías, además de una tienda abastecida por FAV con consulta de catálogo, stock local, reposiciones y ventas administrativas.

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
- Consulta de empleados de Car Cruds, vinculación manual con socios y envío de información mensual de membresía, uso y pagos conforme al contrato acordado.
- Tienda única abastecida por FAV: catálogo de FAV en el portal, compra de socios (se paga y retira en el mostrador), stock físico del gimnasio, reposiciones del proveedor y ventas de mostrador; sin pasarela de pago, devoluciones ni ajustes (ADR-023).

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
| Socios y Membresías | Login JWT, permisos, altas administrativas, planes, pagos/comprobantes, suspensión inmediata con Outbox, lecturas/vínculos y fotografías Car Cruds con uso, costo y pagos del mes, y POST anterior de empleados. | Conexión conjunta Car Cruds, políticas de reactivación y superposición/prorrateos. |
| Clases y Reservas | Publicación/edición ADMIN, búsqueda FTS, reservas/FIFO, retiro voluntario de espera y suspensión mediante Inbox/RabbitMQ. Sedes de Accesos, versiones y reintentos durables. API/portal, PostgreSQL, dos réplicas y reconstrucción GIN verificados. | Verificación integrada en el despliegue final. |
| Accesos y Ocupación | Recepción ADMIN: ingresos/egresos, historial y ocupación real; MongoDB transaccional, Redis medido e idempotencia durable. Uso mensual interno para el informe a Car Cruds. | Verificación integrada en el despliegue final. |
| Tienda | Stock local en PostgreSQL, reposiciones de FAV con clave técnica, ventas ADMIN y panel. Catálogo de FAV 1.1.0 consumido con circuit breaker y caché degradada. Compra de socios desde el portal, idempotente y atómica (ADR-023/024). | URL y clave reales de FAV, aceptación del contrato, URL pública y prueba conjunta. |
| Gateway y portal | NGINX: rutas, **validación JWT y rate limiting** (ADR-025), balanceo y logs de destinos. Portal React con todas las secciones de administración operativas: Panel principal, Socios, Planes y tarifas (4 planes predeterminados con precio), Cobros y caja (membresías y compras de la tienda), Reportes y Configuración. | URL pública: crear la VM y ejecutar el despliegue ([DEPLOY](docs/DEPLOY.md)). |
| Observabilidad | Prometheus (todas las instancias y RabbitMQ), Grafana con tablero **Gimnasio · Estado general** y 5 alertas (D11). | Canal de notificación externo y exportador de spans. |

La integración con **Car Cruds** cambia la dirección del intercambio por indicación del profesor: Socios consulta empleados/estado y el ADMIN los vincula manualmente con socios. Desde el panel elige el mes, guarda/revisa una fotografía y confirma su envío; los reintentos conservan contenido, referencia, versión y fecha. Corregir o quitar el vínculo conserva el historial y no modifica membresías. El recorrido se verificó localmente; faltan URL/token operativos y prueba conjunta. Contrato externo **0.3.0**, configuración y uso en [la guía](docs/contracts/README.md#integracion-con-car-cruds) y [ADR-018](docs/adr/ADR-018-integracion-car-cruds.md).

El **POST anterior `/api/v1/integraciones/empleados`**, contrato propio **1.0.1**, sigue disponible localmente con su mock y pruebas. Su funcionamiento no acredita la nueva integración; se conserva durante la transición.

**Acceso desplegado:** el despliegue está preparado para una VM con Docker y HTTPS automático. Un integrante crea la VM con su cuenta y ejecuta `bash scripts/desplegar-vm.sh`, que publica `https://gimnasio.<ip>.sslip.io` y el tablero en `https://grafana.gimnasio.<ip>.sslip.io` (ver [DEPLOY](docs/DEPLOY.md)). Una vez creada, la URL se agrega aquí. Faltan también los datos reales de FAV y Car Cruds y las pruebas conjuntas.

## Arquitectura y estructura

Se utiliza Node.js 22, TypeScript y Fastify, React/Vite para el portal y NGINX como entrada. Clases aplica Hexagonal y Socios, Capas. PostgreSQL 17, MongoDB 8.0 en Accesos y Redis 8.2.11 para ocupación están integrados. RabbitMQ 4.1 propaga suspensiones mediante Outbox/Inbox, reintentos y DLQ. [Uso, contrato y diagnóstico de suspensiones](docs/contracts/membresias-eventos.md), [evidencia](docs/EVIDENCIA-EVENTOS-MEMBRESIA.md).

```text
services/
  socios-membresias/     # Cuentas, habilitación e integración de empleados
  clases-reservas/       # Catálogo, reservas y espera
  accesos-ocupacion/     # Movimientos, ocupación MongoDB y caché Redis
  tienda/               # Stock local, reposiciones y ventas; catálogo externo pendiente
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
| `/health/accesos`, `/health/tienda` | Verifican MongoDB y PostgreSQL de Tienda respectivamente; no acreditan conexión externa. |
| `/metrics/socios`, `/metrics/clases`, `/metrics/accesos`, `/metrics/tienda` | Métricas compatibles con Prometheus; falta el tablero global. |

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
| Elegir «Salir de espera» desde clases o «Mis Reservas» antes del inicio | Entrada cancelada con historial. Si la promoción ya ocurrió, se avisa y se muestra la reserva para una cancelación explícita. Repetir el retiro anterior conserva otra inscripción posterior. [Contrato y uso](docs/contracts/README.md#retirarse-de-la-lista-de-espera). |
| Reservar como Pedro o Ana | Rechazo por membresía vencida/suspendida. |
| Crear socio como ADMIN | Cuenta SOCIO sin membresía; se conserva la sesión del administrador. DNI/email repetidos se rechazan. |
| Abrir «Empleados Car Cruds» como ADMIN | Con URL/token configurados, elegir empleado, buscar socio por DNI/email exacto y revisar antes de confirmar. Vínculo uno a uno, corrección/desvinculación con historial; membresía sin cambios. Sin proveedor se mantienen las consultas locales y la desvinculación. |
| Preparar y enviar información mensual de un vínculo | Elegir mes, guardar/revisar vista previa y confirmar envío aparte. Sin datos fiables se muestra null; una respuesta incierta queda pendiente y el reintento usa la misma fotografía. [Guía](docs/contracts/README.md#preparar-y-enviar-desde-el-panel). |
| Abrir gestión de membresías como ADMIN | Definir plan, elegir socio y fechas, crear solicitud, registrar cobro y confirmar después de verificarlo. Comprobante interno y habilitación atómicos. |
| Suspender una membresía como ADMIN | Elegir socio, revisar historial y confirmar la suspensión. Ante respuesta incierta se conserva la operación y se ofrece reintentar con la misma clave. Las consultas siguen disponibles y cada solicitud de gestión tiene un plazo máximo de 15 segundos. [Uso y recuperación](docs/contracts/membresias-eventos.md#uso-desde-el-portal). |
| Abrir «Tienda y stock» como ADMIN | Consultar disponibles/vendidos y registrar unidades de una venta con confirmación. Ante respuesta incierta se conserva y reintenta la misma operación. |
| Abrir «Clases & Turnos» como ADMIN | Publicar con nombre, actividad, profesor, sede existente, inicio/fin y capacidad. Buscar la clase y editar antes del inicio únicamente sin reservas confirmadas ni espera pendiente. Ante respuesta perdida, volver a ingresar y reintentar la operación recuperada. [Contrato y uso](docs/contracts/README.md#administración-de-clases). |
| Abrir catálogo de Tienda como socio o reactivar períodos superpuestos | Integración externa y política pendientes respectivamente; no se simulan sus resultados. |

El JWT se guarda en memoria: recargar la página o recibir un 401 requiere nuevo login. En una base nueva, Yoga del 12/11/2026 tiene tres cupos y Pilates del mismo día está llena; los movimientos cambian esos valores. Las fechas de demostración son fijas: las clases iniciadas rechazan nuevas reservas, espera y cancelaciones.

Para probar el **POST del diseño anterior** de empleados, usar el [ejemplo operativo PowerShell](docs/contracts/README.md#ejemplo-operativo-en-powershell): alta nueva 201, misma clave/cuerpo mismos IDs, clave reutilizada con otros datos 409 y credencial inválida 401. Ese POST no habilita membresías ni permite iniciar sesión por el empleado; tampoco consulta ni envía datos a Car Cruds.

### Estado, logs y detención

```powershell
docker compose ps
docker compose logs --tail 50
docker compose stop
```

Los datos se conservan al detener el entorno. `npm run iniciar` vuelve a iniciarlo. Si falla el arranque: comprobar Docker en modo Linux, Node 22, puerto libre y correspondencia de `.env` con los volúmenes. Para revisar inicializadores: `docker compose logs --no-color postgres-init mongo-init mongodb rabbitmq`.

### Observabilidad

El inicio también levanta Prometheus y Grafana:

| Qué | Dónde |
|---|---|
| Tablero **Gimnasio · Estado general**: instancias, errores, reparto del balanceo, circuito de FAV, caché, colas y DLQ | http://localhost:3001 (lectura sin login; el admin usa `GRAFANA_ADMIN_PASSWORD` de `.env`) |
| Alertas y targets | http://localhost:9090/alerts y http://localhost:9090/targets |
| Métricas de cada servicio | http://localhost:8080/metrics/{socios,clases,accesos,tienda} |

Reglas, objetivo de servicio y detección medida en [D11](docs/adr/ADR-011-observabilidad.md).

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
SELECT employee_id, socio_id, version, actualizado_en FROM car_cruds_vinculos;
SELECT employee_id, version, socio_anterior, socio_nuevo, administrador_id, created_at
FROM car_cruds_vinculos_historial ORDER BY employee_id, version;
SELECT employee_id, period, source_reference, ultima_version FROM car_cruds_evidencias_series;
SELECT fotografia_id, employee_id, period, version, socio_id, estado, intentos,
       ultimo_intento_en, recibida_en, applied, codigo_error
FROM car_cruds_evidencias ORDER BY employee_id, period, version;
```

Cambiar a la base propia de Clases:

```text
\c clases
\pset pager off
\dt
```

```sql
SELECT clase_id, nombre, actividad, profesor, sede_id, inicio, fin, capacidad, version FROM clases;
SELECT actor_id, clave, entrada, respuesta, created_at FROM clases_operaciones ORDER BY created_at DESC;
SELECT reserva_id, clase_id, socio_id, estado FROM reservas;
SELECT espera_id, clase_id, socio_id, orden, estado FROM lista_espera;
```

Al reservar y luego cancelar desde la web, el registro pasa de `CONFIRMADA` a `CANCELADA`; no se borra. Para salir de psql, escribir `\q`. Accesos persiste movimientos, presencias, sedes y resultados idempotentes en MongoDB; guía en [ADR-019](docs/adr/ADR-019-accesos-mongodb-recepcion.md).

Tienda tiene base y usuario propios. Para inspeccionar los movimientos desde el contenedor:

```powershell
docker compose exec postgres psql -U postgres -d tienda
```

```sql
SELECT producto_codigo_json, unidades_disponibles, unidades_vendidas FROM tienda_stock;
SELECT reposicion_id, proveedor_id, referencia_json, unidades, created_at FROM tienda_reposiciones;
SELECT venta_id, actor_json, unidades, created_at FROM tienda_ventas;
SELECT tipo, created_at, reposicion_id, venta_id FROM tienda_operaciones;
```

Los identificadores opacos se conservan serializados como JSON; no se consultan claves ni contraseñas. No modificar estas tablas para corregir stock desde fuera del servicio.

## Recepción y ocupación — etapa 1

Con el inicio habitual, ingresar como ADMIN y abrir **Recepción y Ocupación**. Elegir sede, ingresar el ID del socio y seleccionar Ingreso o Egreso. Se consultan ocupación e historial reales; los rechazos quedan visibles y no cambian la ocupación. Las sedes iniciales de Compose son ficticias (`sede-demo-01`/`sede-demo-02`), alineadas con las clases existentes. El catálogo se inserta sin sobrescribir registros; no hay CRUD nuevo de sedes.

El ingreso consulta habilitación en Socios; el egreso cierra una presencia sin depender de esa consulta. Una respuesta incierta conserva clave/cuerpo en sessionStorage por actor para reintentar sin duplicar; recargar exige login nuevamente, pero conserva la operación. No borrar el almacenamiento del navegador mientras haya una operación incierta. La autorización usa JWT ADMIN hasta su vencimiento, sin nuevo rol ni revocación inmediata.

Contrato interno y errores: [OpenAPI Accesos](docs/contracts/openapi-accesos-v1.yaml). Colecciones, índices, transacciones y límites: [ADR-019](docs/adr/ADR-019-accesos-mongodb-recepcion.md). Comandos y resultados ejecutados: [EVIDENCIA-ACCESOS](docs/EVIDENCIA-ACCESOS.md).

```sh
# Docker: MongoDB exclusivo, sin .env ni volúmenes del grupo.
npm run test:accesos
# Alternativa con mongod instalado: crea un replica set exclusivo en un directorio temporal.
ACCESOS_TEST_MODE=native MONGOD_BIN=/ruta/al/mongod npm run test:accesos
```

El ensayo verifica pertenencia antes de limpiar sus recursos temporales. No usar bases existentes como destino. El ensayo original de etapa 1 no incorpora caché; etapa 2 agrega Redis sin modificar el cálculo/envío de Car Cruds.

## Tienda y stock

Iniciar con `npm run iniciar` y acceder como ADMIN a **Tienda y stock**. El inicio incorpora las credenciales nuevas ausentes y la base propia sin borrar datos. El stock empieza vacío: FAV registra las recepciones mediante el contrato compartido, con `X-API-Key` de `FAV_API_KEY` e `Idempotency-Key`. La clave se comparte por privado, nunca desde el portal.

ADMIN selecciona la variante, indica las unidades vendidas y confirma. No se permite saldo negativo; si la respuesta es incierta, recargar y volver a ingresar permite reintentar la misma venta. No borrar la operación pendiente para crear otra. El catálogo externo del socio todavía informa integración pendiente; nombres y precios no se inventan.

Rutas, ejemplos de Postman y errores: [guía FAV/Tienda](docs/contracts/fav-tienda.md). Reproducción de pruebas y límites: [EVIDENCIA-TIENDA](docs/EVIDENCIA-TIENDA.md).

## Pruebas y evidencia

Instalar las dependencias locales antes de compilar o ejecutar las pruebas:

```powershell
npm ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
```

| Comando | Qué comprueba |
|---|---|
| `npm test` | Compilación de los cuatro servicios y reglas/contratos, incluyendo HTTP externo controlado y API del frontend. Verificación del 07/11/2026 con 216/216, sin fallos ni omitidas. Las evidencias de motores reales se conservan por capacidad. |
| `npm run frontend:build` | TypeScript y bundle de producción del portal. |
| `npm run test:contrato-empleados` | Contrato y mock separado de empleados (11 pruebas). |
| `npm run test:car-cruds` | Contrato externo 0.3.0, lecturas, permisos, vinculación, vista previa/envío, resultado incierto y reenvío exacto sin duplicar con proveedor controlado. |
| `npm run test:postgres` | HTTP real, PostgreSQL efímero, dos instancias, permisos, reintentos/rollback de empleados, vínculos/fotografías Car Cruds, cuerpo inmutable, recuperación y concurrencia; último cupo, FIFO con fallas, traza y línea base de carga. |
| `npm run test:balanceo` | Compose completo aislado, dos réplicas, distribución, escrituras concurrentes y caída/reemplazo sin reiniciar el gateway. |
| `npm run test:tienda` | 18 pruebas HTTP/PostgreSQL reales: contrato FAV, permisos, idempotencia, concurrencia, reinicio, rollback, límites y caída de base; [evidencia](docs/EVIDENCIA-TIENDA.md). |
| `npm run test:eventos` | 12 pruebas PostgreSQL/RabbitMQ reales de suspensión, atomicidad, duplicados, carreras, períodos, FIFO, reintentos, DLQ y recuperación del broker. [Evidencia](docs/EVIDENCIA-EVENTOS-MEMBRESIA.md). |
| `npm run test:busqueda` | 13 pruebas HTTP/PostgreSQL reales de búsqueda, filtros, páginas, orden, FIFO, detalle propio, actualización/reconstrucción de GIN y caída de base. [Evidencia](docs/EVIDENCIA-BUSQUEDA.md). |
| `npm run test:cobertura` | Tests unitarios con cobertura y umbrales (líneas ≥ 70 %, ramas y funciones ≥ 80 %). Reglas de negocio ≥ 94 % de líneas. [Evidencia](docs/EVIDENCIA-COBERTURA.md). |
| `npm run test:carga` | k6 contra el gateway del sistema en marcha: uso normal, `-- tasa 400` y `-- estres`. Capacidad ~480 solicitudes/s y límite principal identificado. [Evidencia](docs/EVIDENCIA-CARGA.md). |
| `npm run simulacro:fav` | Caída y lentitud provocadas de FAV con el mock: caché degradada, circuit breaker, compra idempotente y alertas. [Postmortem](docs/POSTMORTEM.md). |
| `npm run test:gestion-clases` | 17 pruebas con dos instancias, PostgreSQL, Accesos/MongoDB y Socios HTTP reales. Publicación/edición, reconstrucción GIN, retiro, permisos, reintentos, rollback, carreras y caída de dependencias. [Búsqueda](docs/EVIDENCIA-BUSQUEDA.md), [retiro y FIFO](docs/adr/ADR-017-consistencia-y-recuperacion-de-espera.md). |

Las pruebas de PostgreSQL, balanceo y Tienda requieren Docker, usan recursos temporales propios, no cargan `.env` y los retiran al terminar. Los tests en memoria no acreditan durabilidad. Para desarrollar solo el portal: `npm run frontend:dev`, manteniendo el backend iniciado.

Los resultados de carga y sus límites están en [D13](docs/adr/ADR-013-capacidad-y-costos.md); la primera traza, en [D11](docs/adr/ADR-011-observabilidad.md); la caída controlada y sus cuatro 504 transitorios durante detección, en [POSTMORTEM](docs/POSTMORTEM.md). La operación estable posterior y la recuperación se verificaron; no se promete una transición sin errores ni capacidad máxima.

## Ramas, revisión e integración

El trabajo de cierre parte de `main` actualizado y se prepara en ramas de funcionalidad; la coordinación y contrato FAV están en `feat/integracion-tienda-proveedor`. Cada cambio se revisa mediante PR hacia `main`, comprobando diferencias, pruebas y coherencia documental. La versión evaluable debe quedar en `main` (§2.12). Las credenciales locales permanecen fuera de Git.

## Documentación

| Documento | Contenido y referencia del enunciado |
|---|---|
| [Alcance](docs/ALCANCE_PRELIMINAR.md) | Funcionalidades, reglas y criterios de aceptación; equivalente a SPEC (§3). |
| [Arquitectura](docs/ARCHITECTURE.md) | Servicios, datos, comunicaciones, diagramas, decisiones y limitaciones (§3, §6.2–6.3). |
| [ADR](docs/ARCHITECTURE.md#decisiones-arquitectónicas) | D1–D13 y decisiones adicionales; los reemplazados conservan su historia (§5). |
| [Contrato e integración](docs/contracts/README.md) | Capacidad ofrecida, versión, ejemplos, errores, autenticación e idempotencia (§4.1). |
| [FAV: contrato y guía](docs/contracts/fav-tienda.md) | Stock y reposiciones implementados y verificados localmente; aceptación, publicación y conexión conjunta pendientes (§4.1). |
| [Plan de cierre](docs/PLAN-ENTREGA-3.md) | Etapas, verificaciones y decisiones pendientes para la presentación y defensa; se completa una etapa por vez. |
| [Postmortem](docs/POSTMORTEM.md) | Caída de una réplica y caída/lentitud del proveedor FAV: impacto, línea temporal, detección, respuesta, causa y mejoras (§2.8 y §3). |
| [Despliegue](docs/DEPLOY.md) | VM con Docker Compose, Caddy y HTTPS; URLs a publicar e integraciones (§4.1, §6.4). |
| [Contrato de eventos](docs/contracts/asyncapi-membresias-v1.yaml) | AsyncAPI 3.0 del evento `MembresiaActualizada`, con cola y DLQ (§2.4). |
| Evidencias | [Carga](docs/EVIDENCIA-CARGA.md), [cobertura](docs/EVIDENCIA-COBERTURA.md), [caché](docs/EVIDENCIA-CACHE.md), [búsqueda](docs/EVIDENCIA-BUSQUEDA.md), [eventos](docs/EVIDENCIA-EVENTOS-MEMBRESIA.md), [Tienda](docs/EVIDENCIA-TIENDA.md). |

E1 (§6.2) conserva alcance, arquitectura/diagramas, límites, estructura y contratos/mocks. E2 (§6.3) conserva flujo propio, PostgreSQL, logs/traza y ADR. Para la presentación final (§6, páginas 8–9), suspensión/mensajería, búsqueda en API/portal, publicación/edición, reconstrucción del índice y retiro de espera están verificados localmente. Desde el 09/11/2026 también están implementados las fuentes mensuales de Car Cruds, el consumo de FAV con compra de socios, la autenticación y el rate limiting en el gateway, el tablero y las alertas, el test de carga, la cobertura y el AsyncAPI. Siguen pendientes la creación de la VM (el despliegue está listo), las pruebas conjuntas con FAV y Car Cruds y las políticas de reactivación. El [plan de entrega 3](docs/PLAN-ENTREGA-3.md) detalla el orden y sus dependencias.

## Caché Redis de ocupación (etapa 2)

Compose incorpora Redis 8.2.11 sin puerto público ni persistencia, con límite de memoria 64 MiB y evicción LRU. Accesos recibe `REDIS_URL`; fuera de Compose, omitirla desactiva la caché. Variables opcionales: `OCUPACION_CACHE_TTL_MS=30000` (50–30000), `REDIS_TIMEOUT_MS=100` (1–1000) y `OCUPACION_CACHE_NAMESPACE=pulse:ocupacion:v1`. Usar namespace distinto por entorno/fuente MongoDB y configuración idéntica en todas las réplicas. Cambiar TTL/namespace de forma coordinada, con reinicio de caché, para no dejar réplicas invalidando claves diferentes. No se modificó `.env`.

Redis no autoriza ingresos: sólo acelera el agregado por sede. Si falla, se consulta MongoDB; puede existir información anterior hasta 30 s si una invalidación falla. La interfaz y las rutas del gateway conservan sus contratos. `npm run test:cache` usa MongoDB y Redis reales aislados (Docker por defecto); modo nativo y medición antes/después en [EVIDENCIA-CACHE](docs/EVIDENCIA-CACHE.md). Diseño: [ADR-020](docs/adr/ADR-020-cache-ocupacion-redis.md).

## Etapa 3: planes, pagos manuales y membresías

Socios requiere PostgreSQL para esta capacidad. Iniciar con las instrucciones Compose anteriores; el esquema aditivo se aplica en el arranque, sin recrear volúmenes ni borrar registros. No hay planes ni tarifas predeterminadas: ADMIN crea el plan con nombre, importe entero en la unidad mínima de la moneda y código reconocido, y registra las fechas exactas al solicitar. No se calculan mensualidades ni se convierten monedas.

Desde «Socios & Membresías» o «Planes y Tarifas»: dar de alta o elegir socio → configurar/elegir plan → crear solicitud → registrar pago pendiente con referencia única → verificar el cobro por el procedimiento administrativo → confirmar pago. Sólo entonces se registra comprobante interno no fiscal y membresía habilitada según sus fechas. El socio consulta estado/solicitudes/comprobantes en «Membresía y Pagos» y reserva si la cobertura incluye ahora y la clase. Para nuevo período, ADMIN registra fechas no superpuestas y confirma un nuevo pago; acumulación, reactivación y prorrateo quedan bloqueados para revisión. No se cobra al socio mediante el portal ni se integra una pasarela.

Las respuestas inciertas conservan una única operación por administrador en sessionStorage, sin JWT, para repetir con la misma clave. No borres ese registro para volver a enviar como otro pago. La referencia identifica el cobro manual y no se puede reutilizar. El modo `USE_MEMORY_DB` conserva las capacidades anteriores, pero esta gestión responde 503: no existe una simulación financiera en memoria.

`npm run test:membresias` usa PostgreSQL 17 efímero exclusivo en Docker, con contraseñas sintéticas y limpieza por identidad. `npm test`, `npm run frontend:build`, `npm run test:postgres`, `npm run test:cache`, `npm run test:accesos` y `npm run test:balanceo` conservan sus comandos. El frontend limita tipos ambientales a React/Vite para no incorporar carpetas ajenas como `node 2` del entorno local.

Ver [contrato propio](docs/contracts/openapi-membresias-v1.yaml), [ADR-021](docs/adr/ADR-021-planes-pagos-membresias.md) y [evidencia, reproducción y matriz](docs/EVIDENCIA-MEMBRESIAS.md). La validación de esta etapa incluye PostgreSQL real, navegador y Compose/balanceo aislados; no sustituye pruebas de producción ni la integración conjunta con proveedores.
