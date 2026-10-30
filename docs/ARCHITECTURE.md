# Arquitectura del sistema

**Estado documental:** 23/10/2026. Flujo propio y POST anterior de empleados operativos localmente. Car Cruds dispone de lecturas, vinculación y envío mensual manual con persistencia e historial, verificados localmente; conexión operativa y prueba conjunta pendientes.

**Enunciado:** §3, página 4; §4.1, páginas 5–6; §5, páginas 6–7; §6.2–6.3, página 8. Los patrones internos y el balanceo corresponden a §2.1 y §2.3, página 2.

## Servicios, responsabilidades y datos

| Servicio | Responsabilidad y propiedad | Implementación actual |
|---|---|---|
| **Socios y Membresías** | Socios, planes, membresías, pagos, comprobantes, referencias externas, solicitudes, vínculos Car Cruds, auditoría y registro de fotografías/envíos. | Capas; JWT, altas, habilitación, lecturas/vinculación/envío manual Car Cruds para ADMIN y POST anterior. PostgreSQL: `socios`, `membresias`, `solicitudes_membresia`, `empleados_externos`, `altas_empleados_idempotencia`, `car_cruds_vinculos`, `car_cruds_vinculos_historial`, `car_cruds_evidencias_series` y `car_cruds_evidencias`. Conexión conjunta, pagos y planes pendientes. |
| **Clases y Reservas** | Clases, capacidad, reservas, espera e índice de búsqueda derivado. | Hexagonal; catálogo, reservas/cancelación y recuperación FIFO. PostgreSQL: `clases`, `reservas`, `lista_espera`. Publicación administrativa y consulta textual pendientes. |
| **Accesos y Ocupación** | Sedes, intentos y movimientos de acceso, presencias y ocupación/caché derivadas. | Capas; recepción ADMIN, ingresos/egresos, historial y ocupación con transacciones MongoDB. Cache-aside Redis sobre ocupación, invalidación y TTL; ver ADR-019 y ADR-020. |
| **Tienda** | Integrar la consulta de productos y stock. El catálogo y las existencias pertenecen a la distribuidora. | Estructura en Capas, JWT y pantalla. Sin base propia ni cliente externo; devuelve `503 INTEGRACION_PENDIENTE`. |

Socios y Clases usan bases y usuarios PostgreSQL separados en una instancia local compartida; no hay acceso de un servicio a tablas ajenas. MongoDB tiene un replica set de un solo nodo, sin redundancia. El diseño de motores y restricciones se justifica en [D3](adr/ADR-003-persistencia.md); los límites vigentes, en [D1](adr/ADR-015-limites-con-tienda.md).

NGINX sirve el portal React y enruta las solicitudes por un único puerto local (`8080` o `GATEWAY_PORT`). La autenticación y los permisos se validan en los servicios. Las llamadas internas y las salidas al proveedor no pasan por nuestro gateway.

## Arquitectura interna e identidad

- **Clases, Hexagonal:** `app.ts` adapta HTTP; `application/reservas.service.ts` contiene casos de uso; `ports.ts` declara las interfaces; PostgreSQL, memoria y cliente HTTP de Socios son adaptadores. `server.ts` compone y arranca el trabajador de promociones.
- **Socios, Capas:** HTTP (`app.ts`, `empleados.http.ts`) → servicios de aplicación (`services.ts`, `empleados.service.ts`, `car-cruds.service.ts`, `car-cruds-vinculos.service.ts`, `car-cruds-evidencias.service.ts`) → repositorio o cliente externo `clients/car-cruds.client.ts`. Los puertos de vínculos/evidencias tienen adaptadores PostgreSQL y memoria; `car-cruds-evidencias.storage.ts` aplica las transacciones y el almacenamiento del mensaje. `server.ts` compone el cliente con configuración opcional. Criptografía y JWT están en `security.ts`.
- **Tienda, Capas:** HTTP/autenticación → servicio de consulta pendiente; todavía no tiene adaptador externo. Accesos concreta Capas con lectura derivada de presencias abiertas; ADR-019 revisa su propuesta previa por eventos, sin introducir broker.
- **Identidad:** JWT HS256 firmado con vencimiento configurable (una hora por defecto), rol y controles de propietario. Alta interna solo ADMIN; bootstrap local sin contraseña administrativa predeterminada nueva. El portal mantiene la sesión en memoria. [D2](adr/ADR-002-arquitectura-interna-de-servicios.md), [autenticación](adr/ADR-016-autenticacion-y-altas.md).

## Comunicaciones y operaciones consistentes

### Recepción y ocupación (30/10/2026)

ADMIN → panel React → NGINX `/api/v1/accesos/*` → Accesos. El ingreso consulta Socios con clave técnica antes de la transacción; el egreso usa estado local. MongoDB rs0 guarda presencia, movimiento y resultado idempotente juntos. Ocupación deriva de presencias abiertas; historial filtra sede/socio y pagina. La UI conserva operaciones inciertas en sessionStorage por actor, sin JWT, para repetir el mismo cuerpo/clave incluso tras recarga. Etapa 2 agrega caché Redis exclusivamente al agregado; no hay acceso directo a colecciones ajenas.

[ADR-019](adr/ADR-019-accesos-mongodb-recepcion.md), [contrato interno](contracts/openapi-accesos-v1.yaml) y [evidencia](EVIDENCIA-ACCESOS.md). La autorización JWT es local hasta su vencimiento, como Clases/Tienda, sin revocación inmediata. MongoDB sigue siendo un nodo sin redundancia.

### Flujo principal: reservar una clase

1. El portal obtiene catálogo, reservas y espera propias con `GET /api/v1/reservas/clases` y Bearer JWT. Las consultas históricas `/api/v1/clases` conservan `X-API-Key` y el contrato anterior.
2. Antes del inicio, `POST /api/v1/reservas` recibe `claseId` y, si se eligió, `ingresarEsperaSiLlena`. La identidad se toma del token; solo ADMIN puede indicar otro socio.
3. Clases consulta en paralelo a Socios para ahora y para la fecha de clase, con `X-Service-Key`. Cada verificación tiene presupuesto de 3000 ms, incluido cuerpo y como máximo un reintento. Una respuesta desconocida produce indisponibilidad, no habilitación.
4. La escritura bloquea primero la fila de la clase, vuelve a verificar inicio, duplicados, cupo y prioridad de espera y confirma la reserva o la espera voluntaria. Los índices únicos parciales respaldan las restricciones.
5. Una cancelación anterior al inicio se guarda sin depender de Socios. Si hay espera, el cupo conserva esa prioridad. El trabajador valida al primero fuera del bloqueo y confirma la promoción atómicamente; si hay falla de red, conserva al candidato y reintenta. Una inhabilitación comprobada lo retira y permite evaluar al siguiente.

El trabajador recupera el trabajo de las tablas persistidas al iniciar y cada 5 s por defecto, sin superponer pasadas en una instancia. Varias instancias pueden competir; la transacción comprueba nuevamente el estado. No hay una transacción distribuida entre las bases: las validaciones remotas son puntuales. Detalle en [D4 vigente](adr/ADR-017-consistencia-y-recuperacion-de-espera.md) y [D5](adr/ADR-005-comunicacion-entre-servicios.md).

### Capacidad ofrecida: información de membresías para Car Cruds

Por el cambio de flujo indicado por el profesor, **Socios** cuenta con un cliente para las lecturas de empleados/estado y el POST de evidencia de Car Cruds. Las rutas internas bajo `/api/v1/integraciones/car-cruds/` exigen JWT ADMIN y llaman a los servicios de aplicación. El panel **Empleados Car Cruds** permite elegir empleado y socio mediante búsqueda exacta de DNI/email, confirmar, corregir y quitar asociaciones con historial. El vínculo es uno a uno y se guarda con su auditoría en una transacción. Antes de asociar/corregir se verifica el ID remoto fuera del bloqueo SQL; la desvinculación y las consultas locales no dependen del proveedor. La revisión esperada impide sobrescribir cambios concurrentes.

En ese panel, ADMIN elige el mes y prepara una fotografía durable antes de revisar/confirmar el envío. Una referencia por empleado/mes y versiones crecientes identifican cada mensaje inmutable. El reclamo transaccional usa un lease de 60 s y UUID para impedir envíos simultáneos y descartar respuestas tardías. HTTP ocurre fuera de la transacción; la respuesta se registra después. Tras una caída o un resultado incierto se reintenta manualmente el mismo cuerpo, sin cron. Corregir el vínculo exige revisión explícita para preparar de nuevo y conserva recibos anteriores. Un 409 no genera automáticamente otra versión; `applied:false` no demuestra cuál está vigente en Car Cruds.

Las llamadas parten directamente del backend con Bearer de aplicación `gym`. El cliente valida el contrato fijado y aplica un presupuesto total configurable de 3000 ms por defecto, incluido cuerpo. Las lecturas permiten un reintento máximo ante red/502/503/504; cada envío hace un solo POST. Rechaza redirecciones, cuerpos mayores a 1 MiB, números inseguros y respuestas incompatibles. Una credencial externa rechazada conserva la sesión JWT: las lecturas responden 502 y el envío queda en revisión. Sin URL/token, consultar al proveedor o enviar responde `503 CAR_CRUDS_NO_CONFIGURADO`; las vistas previas, historial y resto del portal continúan.

Car Cruds es propietario de empleados, estado laboral e informe receptor. El gimnasio conserva socios/membresías, vínculos, auditoría y fotografías/envíos. Accesos registra ingresos efectivos; su consumo por Car Cruds queda para otra etapa y no se leen sus tablas desde Socios. Pagos, ingresos e historia insuficientes se informan como desconocidos. La fuente actual comprueba afiliación positiva al observar el mes actual y conserva pruebas positivas anteriores del mismo socio/mes; no inventa negativos. Consultar/vincular no habilita una membresía, y una baja laboral no la cancela automáticamente.

El [contrato externo 0.3.0 y el perfil mensual](contracts/README.md#integracion-con-car-cruds) y [D8 vigente](adr/ADR-018-integracion-car-cruds.md) documentan el diseño y las rutas propias. Se verificaron lecturas/envíos con HTTP controlado, persistencia/recuperación con PostgreSQL real y pantalla con datos ficticios; faltan URL/token y prueba conjunta. El POST receptor pertenece a Car Cruds: las verificaciones locales todavía no acreditan la conexión operativa entre grupos de §4.1.

**Implementación anterior conservada:** `POST /api/v1/integraciones/empleados`, contrato propio **1.0.1**, sigue disponible localmente con su mock. Usa `X-API-Key`, `Idempotency-Key` y una transacción para socio, solicitud pendiente, referencia y respuesta original. No realiza el nuevo flujo. [ADR-014 reemplazado en diseño](adr/ADR-014-contrato-empleados.md).

### Capacidad consumida: Tienda

El portal llama por nuestro gateway a `GET /api/v1/tienda/productos` con JWT. Actualmente recibe `503 INTEGRACION_PENDIENTE`. La ruta es interna del gimnasio; no define la API de la distribuidora. La salud `/health/tienda` confirma solo la estructura HTTP.

Tienda será quien llame a **FAV** y adapte su contrato, sin stock ni base local. Se revisó `feature-inventario`: su catálogo público aún no incluye stock y la lectura de inventario exige permisos administrativos. Faltan acuerdo de consulta externa de stock, URL y credencial para fijar el cliente y verificarlo. Compras, consignación y reposición quedan fuera del alcance. [D9](adr/ADR-009-consumo-del-proveedor.md).

### Mensajería prevista

RabbitMQ está configurado. Se conserva el diseño `MembresiaActualizada` con Outbox en Socios, consumidor idempotente/Inbox en Clases y cola de mensajes fallidos. Publicador, consumidor y recuperación aún no están implementados; la suspensión posterior no cancela automáticamente reservas futuras todavía. [D5](adr/ADR-005-comunicacion-entre-servicios.md).

## Balanceo y observabilidad

NGINX distribuye con `least_conn` entre dos instancias de Clases; usa DNS dinámico y detección pasiva de fallos. Compose comprueba salud y coordina el inicio, pero su marca `healthy` no configura una sonda activa de NGINX. `X-Instance-ID` identifica la réplica; los logs del proxy muestran upstreams, estados y tiempos. El ensayo comprobó continuidad y reemplazo sin reiniciar el gateway, con cuatro 504 transitorios durante detección. [D12](adr/ADR-012-balanceo-de-carga.md), [postmortem](POSTMORTEM.md).

Socios y Clases emiten logs de negocio JSON con `trace_id`, `span_id` y padre. Clases propaga su contexto a las dos verificaciones HTTP de Socios; los servicios devuelven identificadores de traza. `npm run test:postgres` exige correlación, relación padre/hijo y reserva persistida entre instancias HTTP con puertos distintos. La demostración con `inject` es complementaria. Los campos de correlación entrantes de NGINX pueden estar vacíos si el cliente no los envía; no se afirma cobertura de todos los logs de infraestructura.

Las métricas actuales son contadores HTTP/errores, uptime y conexiones ocupadas del pool. No hay tableros, alertas, histogramas ni backend de trazas todavía. La estrategia y objetivos propuestos están en [D11](adr/ADR-011-observabilidad.md); carga local y costos ilustrativos, en [D13](adr/ADR-013-capacidad-y-costos.md).

## Diagrama de contexto (C4 - Nivel 1)

El contexto representa el alcance del sistema. Las funciones administrativas y de recepción no implementadas se identifican en la tabla de servicios y en las limitaciones.

```mermaid
flowchart LR
    socio["👤 Socio del Gimnasio<br/>Consulta membresía, busca clases,<br/>reserva cupos o ingresa a espera"]
    admin["👤 Administrador<br/>Gestiona socios, membresías,<br/>pagos, comprobantes y clases"]
    recepcion["👤 Personal de Recepción<br/>Valida ingresos, registra<br/>egresos y consulta ocupación"]
    consumidor["Car Cruds<br/>Publica empleados y estado laboral<br/>Recibe información de membresías"]
    proveedor["FAV: productos y stock<br/>Acuerdo de stock y conexión pendientes"]

    sistema["🏋️ Sistema Integral de Gestión de Gimnasio<br/>(Plataforma de Microservicios)"]

    socio -->|Web UI| sistema
    admin -->|Web UI| sistema
    recepcion -->|Web UI| sistema
    sistema -->|Socios: GET empleados/estado · cliente implementado<br/>Conexión conjunta pendiente · Bearer gym| consumidor
    sistema -->|POST de fotografía mensual · Bearer gym<br/>Envío manual implementado; conexión pendiente| consumidor
    sistema -.->|Tienda: consulta de productos y stock<br/>Integración pendiente| proveedor
```

## Diagrama de contenedores (C4 - Nivel 2)

```mermaid
flowchart TB
    actores["Socio · Administrador · Recepción<br/>(Navegador Web / SPA React)"] --> gateway
    
    subgraph backend["Backend Distribuido del Gimnasio"]
        gateway["API Gateway & Frontend (NGINX 1.28)<br/>Balanceo least_conn · Propaga traceparent · SPA estática"]
        
        gateway -->|Clases y reservas<br/>JWT; clave para GET histórico| clases["Clases y Reservas (2 réplicas)<br/>Fastify + TypeScript · Hexagonal"]
        gateway -->|GET /api/v1/socios/:id<br/>POST /api/v1/auth/*| socios["Socios y Membresías<br/>Fastify + TypeScript · Capas"]
        gateway -->|API anterior: POST /api/v1/integraciones/empleados<br/>X-API-Key e Idempotency-Key| socios
        gateway -->|/api/v1/integraciones/car-cruds/* · JWT ADMIN<br/>Lecturas, búsqueda y vínculos con historial| socios
        gateway -->|Recepción ADMIN · JWT| accesos["Accesos y Ocupación<br/>Ingresos, egresos, historial y ocupación"]
        gateway -->|GET /api/v1/tienda/productos · JWT<br/>503: integración pendiente| tienda["Tienda · estructura ejecutable<br/>Sin base de datos<br/>Cliente externo pendiente"]
        
        clases -->|HTTP: consulta de habilitación<br/>Ahora y fecha de clase · X-Service-Key| socios
        clases --> dbClases[("Base de Datos Clases<br/>PostgreSQL 17<br/>clases, reservas, lista_espera")]
        socios --> dbSocios[("Base de Datos Socios<br/>PostgreSQL 17<br/>socios, membresias, solicitudes y alta externa<br/>vínculos, historial y fotografías Car Cruds")]
        accesos -->|Transacciones · propiedad exclusiva| dbAccesos[("Base de Datos Accesos<br/>MongoDB 8.0 · presencias y movimientos")]
        
        socios -.->|Diseño pendiente: Outbox y publicación| rabbitmq["RabbitMQ 4.1 configurado"]
        rabbitmq -.->|Diseño pendiente: consumo e Inbox| clases
    end
    carcruds["Car Cruds · Empleados<br/>OpenAPI 0.3.0<br/>Empleados, estado e informe receptor"]
    socios -->|GET empleados/estado · Bearer gym<br/>Cliente implementado; conexión por coordinar| carcruds
    socios -->|POST evidencia mensual · Bearer gym<br/>Envío manual implementado; conexión pendiente| carcruds
    distribuidora["FAV · productos y stock<br/>Consulta externa de stock por acordar"]
    tienda -.->|Consulta externa prevista<br/>Acuerdo y conexión pendientes| distribuidora
```

Las líneas discontinuas indican partes previstas. El cliente de lectura de Car Cruds se verificó contra HTTP controlado, sin prueba conjunta aún. El entorno local utiliza HTTP; HTTPS y publicación accesible se resolverán en el despliegue.

## Diagrama de secuencia del flujo principal

```mermaid
sequenceDiagram
    autonumber
    actor Socio
    participant GW as API Gateway (NGINX)
    participant CR as Clases y Reservas
    participant SM as Socios y Membresías
    participant DB_SM as PostgreSQL (socios)
    participant DB_CR as PostgreSQL (clases)

    Socio->>GW: POST /api/v1/reservas { claseId }, Bearer JWT
    GW->>CR: Proxy + traceparent (00-traceId-spanId-01)
    CR->>CR: Verificar JWT y propietario
    CR->>DB_CR: SELECT clase (verificar existencia y que no haya iniciado)
    par Habilitación actual
        CR->>SM: GET habilitacion?fecha=ahora, X-Service-Key
    and Habilitación al inicio
        CR->>SM: GET habilitacion?fecha=inicio, X-Service-Key
    end
    SM->>DB_SM: SELECT socio + historial de membresías para cada fecha
    DB_SM-->>SM: Estado y períodos aplicables
    SM-->>CR: Ambas respuestas habilitadas (o error sin confirmar reserva)
    CR->>DB_CR: BEGIN; SELECT ... FROM clases FOR UPDATE
    CR->>DB_CR: Reverificar inicio, duplicados, aforo y prioridad de espera
    alt Hay cupo y no hay espera pendiente
        CR->>DB_CR: INSERT INTO reservas (CONFIRMADA); COMMIT
        CR-->>GW: 201 Created (Reserva confirmada + traceparent)
        GW-->>Socio: 201 Created
    else Sin cupo asignable respetando espera
        CR->>DB_CR: ROLLBACK
        CR-->>GW: 409 Conflict { codigo: CLASE_SIN_CUPOS, puedeIngresarEspera: true }
        GW-->>Socio: 409 Conflict (Ofrece lista de espera)
    end
```

## Limitaciones conocidas y deuda técnica aceptada

- **Dominio pendiente:** pagos/comprobantes, planes, renovación/reactivación, resolución de solicitudes, credenciales de empleados, publicación de clases. Accesos ya implementa movimientos y ocupación; su caché está implementada; el consumo desde Car Cruds queda pendiente. El frontend no simula éxito de esas funciones.
- **Integración externa:** Car Cruds tiene contrato fijado, lecturas, vínculo y envío durable probados localmente; faltan datos fiables de pagos/ingresos y prueba conjunta con conexión operativa. Tienda no consume productos/stock de FAV y aún carece de su test de contrato. La conexión accesible y las pruebas entre grupos siguen pendientes (§4.1).
- **Búsqueda y caché:** FTS/GIN creado pero sin consulta textual; Redis sobre ocupación implementado y medido localmente; demanda de producción y despliegue Compose completo pendientes.
- **Mensajería:** broker configurado sin evento publicado/consumido, Inbox/Outbox ni DLQ; reservas futuras no se cancelan automáticamente por una suspensión posterior.
- **Disponibilidad:** un gateway, una instancia PostgreSQL y MongoDB de un nodo. Dos réplicas HTTP no eliminan esos puntos de falla ni los errores durante detección. No hay despliegue multizona ni protección completa por circuit breaker/límite de concurrencia.
- **Identidad:** Clases y Tienda validan el JWT hasta su vencimiento; no hay revocación inmediata ni refresh tokens. La configuración actual del POST admite un origen externo por entorno.
- **Operación:** faltan tableros/alertas, prueba de carga sostenida y presupuesto definitivo. Las mediciones locales no acreditan SLO ni capacidad máxima. El postmortem registra un ensayo local, no la jornada completa con proveedor.
- **Datos de demostración:** clases con fechas fijas y cuentas ficticias; los datos persistidos pueden diferir de los iniciales. No hay gestión versionada completa de migraciones ni política de purga de idempotencia.

Estas limitaciones mantienen visibles los requisitos generales y de la presentación final pendientes (§6, páginas 8–9); no amplían el alcance funcional acordado.

## Decisiones arquitectónicas


| Decisión | Título | Estado | Documento |
|---|---|---|---|
| **D1 anterior** | Límites de los tres servicios originales | Reemplazado por ADR-015; conservado como antecedente | [ADR-001](adr/ADR-001-limites-de-servicios.md) |
| **D1 vigente** | Límites con Tienda como cuarto microservicio | Estructura propia preparada; consulta externa pendiente | [ADR-015](adr/ADR-015-limites-con-tienda.md) |
| **D2** | Arquitectura interna de los servicios | Hexagonal y Capas concretadas en Clases/Socios | [ADR-002](adr/ADR-002-arquitectura-interna-de-servicios.md) |
| **D3** | Persistencia relacional y documental | PostgreSQL propio y alta externa atómica verificados | [ADR-003](adr/ADR-003-persistencia.md) |
| **D4 anterior** | Consistencia y concurrencia | Reemplazada por ADR-017; antecedente | [ADR-004](adr/ADR-004-consistencia-y-concurrencia.md) |
| **D4 vigente** | Consistencia y recuperación FIFO | Cancelación local y promoción recuperable verificadas | [ADR-017](adr/ADR-017-consistencia-y-recuperacion-de-espera.md) |
| **D5** | Comunicación entre servicios (Síncrona y Asíncrona) | HTTP y POST externo operativos; mensajería pendiente | [ADR-005](adr/ADR-005-comunicacion-entre-servicios.md) |
| **D6** | Búsqueda | Catálogo filtrado; FTS preparado, consulta textual pendiente | [ADR-006](adr/ADR-006-busqueda.md) |
| **D7** | Caché | Redis implementado y medido; ADR-020 concreta ADR-007 | [ADR-007](adr/ADR-007-cache.md) |
| **D8 inicial** | Consulta de clases | Reemplazado; contrato y pruebas conservados | [ADR-008](adr/ADR-008-contrato-propio.md) |
| **D8 anterior** | Recepción de empleados y solicitud pendiente | Reemplazado en diseño; contrato 1.0.1 y POST local conservados | [ADR-014](adr/ADR-014-contrato-empleados.md) |
| **D8 vigente** | Información mensual para Car Cruds | Lecturas, vínculo y envío manual verificados localmente; conexión conjunta pendiente | [ADR-018](adr/ADR-018-integracion-car-cruds.md) |
| **D9** | Consulta de productos y stock de FAV | Tienda responde integración pendiente; stock público y conexión por acordar | [ADR-009](adr/ADR-009-consumo-del-proveedor.md) |
| **D10** | Resiliencia | Implementación parcial y pendientes identificados | [ADR-010](adr/ADR-010-resiliencia.md) |
| **D11** | Observabilidad (Logs, Trazas y Métricas) | 1ª versión en E2 | [ADR-011](adr/ADR-011-observabilidad.md) |
| **D12** | Balanceo de carga | Distribución, detección y reemplazo verificados con límites explícitos | [ADR-012](adr/ADR-012-balanceo-de-carga.md) |
| **D13** | Capacidad y estimación de costos | Línea base local y estimación ilustrativa | [ADR-013](adr/ADR-013-capacidad-y-costos.md) |
| Adicional | Autenticación y altas administradas | JWT, permisos y bootstrap local implementados | [ADR-016](adr/ADR-016-autenticacion-y-altas.md) |

### Caché de ocupación (etapa 2)

Accesos consulta Redis antes de cargar existencia de sede y conteo de presencias abiertas desde MongoDB. Sólo el entero agregado se almacena; JWT y permisos se validan antes. Cada movimiento aceptado invalida después del commit. Dos claves por sede y scripts Lua con token de generación impiden que una lectura antigua repueble la caché después de invalidar. TTL máximo 30 s contado desde el inicio de la carga, sin renovación por hits. Redis caído provoca fallback a MongoDB; no decide admisión ni altera transacciones.

La coherencia es eventual: una invalidación fallida o un proceso que cae después del commit puede dejar el valor anterior hasta su expiración. Una respuesta ya en vuelo puede contener el estado anterior. Redis no persiste y no publica puerto en Compose. No es un requisito de salud de Accesos. Configuración, garantías y deudas: [ADR-020](adr/ADR-020-cache-ocupacion-redis.md). Métricas y resultados reproducibles: [evidencia](EVIDENCIA-CACHE.md).
