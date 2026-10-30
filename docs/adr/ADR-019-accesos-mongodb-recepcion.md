# Accesos y Ocupación: recepción, transacciones e idempotencia

**Estado:** implementado en rama de trabajo; verificaciones en [evidencia de etapa 1](../EVIDENCIA-ACCESOS.md).
**Fecha:** 30/10/2026. Complementa D1/D3/D4/D5/D10/D11; revisa únicamente la propuesta interna de Accesos de D2. No reemplaza las decisiones de Socios, Clases ni Car Cruds.

## Fuentes y alcance

- Enunciado: §2.1 y §2.5, p.2; §2.8–2.11, p.3; §2.12 y documentación, p.4; presentación, pp.8–9. El PDF temporal de la auditoría anterior ya no está disponible para abrirlo en esta etapa; se conserva esa lectura previa y no se afirma una nueva comprobación del original.
- Alcance vigente: RF-08/RF-09, RN-G05–G08 y CA-G05–G07: habilitación al ingresar, alternancia por socio/sede, ocupación no negativa e intentos rechazados sin efecto sobre ocupación.
- D1/ADR-015 mantiene a Accesos como propietario de sedes, movimientos y presencias. No se agregan compras, pagos, caché, broker ni hechos de Car Cruds.

## Decisión

### Aplicación y permisos

HTTP `app.ts` → `AccesosService`/reglas en `domain.ts` → puerto `AccesosRepository` → `MongoAccesosRepository`; `HttpSociosClient` consulta habilitación. No se importa código privado de otros servicios.

Se concreta una arquitectura en capas con lectura derivada de presencias, en lugar de implementar ahora la propuesta de eventos/CQRS-lite de D2. No es Event Sourcing ni mensajería. Los dos estilos existentes Socios/Clases se conservan.

Recepción se ofrece dentro del panel ADMIN existente. Esta restricción conservadora de implementación no agrega un rol RECEPCION ni permite al SOCIO operar por cambiar IDs. Todas las rutas de negocio requieren JWT firmado HS256, emisor/audiencia, identidad ADMIN y vencimiento; la clave técnica no permite usar recepción. Igual que Clases/Tienda, la autorización es local hasta el vencimiento del JWT: no acredita revocación inmediata ni consulta el rol actual en cada operación. Esto permite registrar egresos aunque Socios no responda. Un JWT vencido no se acepta como excepción de emergencia.

### Persistencia e invariantes

MongoDB usa la base privada `accesos` y replica set `rs0` ya previsto en Compose. Se exige replica set al iniciar; nunca se reemplaza por memoria si falla.

| Colección | Propósito / índices |
|---|---|
| `sedes` | Catálogo propio; `_id=sedeId`. Configuración inicial `ACCESOS_SEDES_JSON`, inserción `$setOnInsert`; nunca sobrescribe ni elimina registros existentes. Compose declara dos sedes ficticias alineadas con los IDs del catálogo de clases. No se implementa CRUD de sedes en esta etapa. |
| `presencias` | Un documento estable por socio/sede, abierta o cerrada, y revisión de serialización. `_id` canónico y único compuesto `(sedeId,socioId)`; índice `(sedeId,abierta)` para ocupación. |
| `movimientos` | Intentos de negocio aceptados/rechazados, actor, instante, tipo y código. Índices sede/fecha/ID y sede/socio/fecha/ID para historial. No se borran al cerrar un ingreso. |
| `operaciones` | Resultado original y contenido canónico por actor/clave. `_id` único; sin TTL que permita reaplicar silenciosamente un reintento antiguo. |

Se crea el documento estable de presencia cerrada si no existe. Es preparatorio: por sí solo no cuenta como ingreso ni aumenta ocupación. La transacción incrementa su revisión para serializar todas las operaciones del mismo par y guarda cambio de apertura, movimiento y respuesta idempotente juntos, o ninguno. Usa `snapshot`, escritura `majority`, preferencia primaria y tiempo acotado. El driver reintenta conflictos transitorios; una colisión de clave se resuelve leyendo replay/conflicto, con límite adicional acotado.

La ocupación es `countDocuments({sedeId,abierta:true})`: no existe contador duplicado que pueda volverse negativo. Cada consulta refleja un estado confirmado de su fuente; historial y ocupación son peticiones separadas, no una instantánea conjunta de toda la pantalla. La paginación offset tiene orden estable fecha/ID para un conjunto fijo, sin prometer snapshot entre páginas concurrentes.

### Idempotencia

POST requiere `Idempotency-Key` de 8–128 caracteres alfanuméricos/guion/guion bajo. El ámbito es el actor autenticado; el contenido canónico es sede/socio/tipo.

- Misma clave y contenido: mismo resultado/ID, incluso tras un egreso posterior o reinicio; no reabre ni cierra nuevamente.
- Misma clave y otro contenido: 409 sin nuevo efecto.
- Claves distintas: operaciones distintas, sujetas a alternancia. No se interpreta una nueva clave como reintento de una anterior.
- Los rechazos de negocio también se conservan. Tras corregir una membresía, un nuevo intento debe usar una clave nueva.
- Ante error de almacenamiento o respuesta perdida, el resultado puede ser incierto: se conserva la misma clave. El frontend la guarda antes del HTTP en `sessionStorage`, separada por actor, sin JWT ni credenciales, y bloquea cambios del cuerpo hasta resolverla. Borrar ese almacenamiento pierde esta ayuda al operador.

### Dependencias y fallas

El ingreso consulta `GET /api/v1/socios/:id/habilitacion?fecha=...` con `X-Service-Key`, presupuesto total 3000 ms incluyendo cuerpo y hasta un reintento GET de red/502/503/504 con pausa. Valida identidad, booleano y, para permitir ingreso, membresía habilitada con fechas aplicables. Rechaza redirecciones y cuerpos mayores a 64 KiB. Un 404 válido representa socio inexistente. Red/respuesta inválida produce 503, sin inventar una inhabilitación ni un ingreso.

La consulta ocurre antes de la transacción, nunca bajo bloqueo MongoDB. Es una evaluación puntual: no hay atomicidad distribuida ante una suspensión inmediatamente posterior. El egreso y un replay durable no consultan membresía; cierran o devuelven hechos locales. El egreso sin presencia se registra rechazado. Una membresía no habilitada o ingreso ya abierto se conserva como intento rechazado; una dependencia desconocida no se registra como rechazo de negocio, sino como error observable reintentable.

MongoDB inaccesible produce salud 503 y fallas controladas, sin detalle de URI/credenciales. El proceso de producción usa pool máximo 20, selección/conexión/cola 3 s, operación acotada y cierre ordenado. NGINX incorpora rutas, elimina clave técnica entrante y no reintenta automáticamente el POST; el cliente conserva su clave. No se agregan llamadas externas reales en pruebas.

### Observabilidad

Logs JSON con `service`, `trace_id`, `span_id`, padre e ID de movimiento; propaga contexto a Socios. No registra JWT, clave idempotente, URI, cuerpo personal ni excepciones que puedan contener secretos. `/metrics` expone solicitudes, 5xx, fallas de dependencia y respuestas de movimientos por código (incluye replays, no es cantidad de movimientos únicos), más uptime. `/metrics/accesos` permite incorporarlo después al recolector. No se implementan tablero, alertas o backend de spans.

## Alternativas y consecuencias

- Arreglo en memoria: descartado como persistencia, no conserva datos ni coordina procesos.
- Solo documento de presencia: no basta para guardar atómicamente historial e idempotencia independientes; historial embebido sin límite arriesga crecimiento del documento.
- Contador por sede: descartado para no duplicar autoridad ni serializar todas las personas de una sede.
- Solo índice de ingreso abierto: no resuelve replay tardío tras salida ni atomicidad de historial/respuesta; se usa serialización estable y transacción.
- Consultar Socios dentro de transacción: descartado por disponibilidad y duración de bloqueo.
- Nueva identidad RECEPCION: no se crea. Revocación inmediata, accesos de emergencia y permisos más finos necesitan decisión posterior.
- Un nodo MongoDB soporta transacciones pero no redundancia. Reintentos no equivalen a disponibilidad garantizada ni eliminan incertidumbre de respuesta.

Referencias técnicas: [transacciones del driver oficial](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/), [índices únicos MongoDB](https://www.mongodb.com/docs/manual/core/index-unique/).

## Extensión posterior — etapa 2

[ADR-020](ADR-020-cache-ocupacion-redis.md) agrega Redis sobre el agregado de ocupación, conservando transacciones, autorización, contratos y propiedad de datos de esta decisión. La exclusión de caché del alcance original sigue documentada arriba como historia de etapa 1.
