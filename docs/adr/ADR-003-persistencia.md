# D3 - Persistencia

**Estado:** decisión de motores conservada; PostgreSQL integrado y verificado. MongoDB integrado en recepción (actualización 30/10/2026, [ADR-019](ADR-019-accesos-mongodb-recepcion.md)).
**Fecha inicial:** 07/10/2026. **Validación:** 23/10/2026.
**Enunciado:** §5 D3, página 6; §2.8, página 3; §6.2–6.3, página 8.

## Contexto

Membresías, pagos y reservas requieren asociaciones, unicidad y operaciones atómicas. Accesos necesita historial por socio, sede y tiempo. Cada servicio administra sus datos; la consulta de stock externo no requiere una copia propia.

## Decisión y patrones de acceso

| Servicio | Almacenamiento y patrones | Estado |
|---|---|---|
| Socios y Membresías | PostgreSQL, base `socios`: identidad por DNI/email, membresías por socio/fecha, vinculación y fotografías Car Cruds por empleado/mes/versión; pagos y habilitación previstos en una transacción local. | `socios`, `membresias`, `solicitudes_membresia`, `empleados_externos`, `altas_empleados_idempotencia`, `car_cruds_vinculos`, `car_cruds_vinculos_historial`, `car_cruds_evidencias_series` y `car_cruds_evidencias` operativas; planes/pagos/comprobantes pendientes. |
| Clases y Reservas | PostgreSQL, base `clases`: catálogo por sede/inicio, reservas por clase/socio y espera por orden. | `clases`, `reservas`, `lista_espera` operativas. |
| Accesos y Ocupación | MongoDB, base `accesos`: sedes, movimientos e historial por identificador/tiempo, presencias abiertas y ocupación derivada. | Recepción transaccional, presencias, movimientos, sedes e idempotencia durable implementados; caché pendiente. |
| Tienda | Sin almacenamiento local; productos y stock pertenecen a la distribuidora. | Estructura preparada; integración externa pendiente. |

Las bases relacionales comparten una instancia local, con usuarios/credenciales separados y permisos por base. Esto separa propiedad, no recursos físicos ni disponibilidad. El servicio consumidor usa APIs y referencias por ID, sin claves foráneas entre bases. Límites vigentes en [D1](ADR-015-limites-con-tienda.md).

### Consistencia implementada

- **Identidad:** índices únicos sobre `LOWER(BTRIM(email))` y `BTRIM(dni)`, además del identificador primario. Los duplicados históricos incompatibles hacen fallar la inicialización; no se fusionan ni eliminan cuentas automáticamente.
- **Membresía:** se consulta el historial y se selecciona el período aplicable a la fecha. Una renovación futura no oculta la vigente.
- **Reservas:** transacciones con bloqueo primero sobre la clase e índices únicos parciales de reserva confirmada/espera pendiente. Los cupos se calculan con reservas confirmadas, sin contador redundante. La cancelación y la promoción son operaciones locales separadas; no se llama a Socios mientras se mantiene el bloqueo. [D4](ADR-017-consistencia-y-recuperacion-de-espera.md).
- **Alta externa:** una transacción guarda socio, solicitud `PENDIENTE`, referencia externa y respuesta original JSONB. Bloqueos consultivos por origen/clave y origen/empleado serializan reintentos; índices únicos protegen DNI/email. Un fallo revierte todos los registros. El POST no crea membresía ni contraseña.
- **Idempotencia durable:** el resultado se conserva entre reinicios e instancias, sin purga automática. Cambiar el origen cambia su ámbito; el replay devuelve el alta original, no el estado actual de una membresía.
- **Vinculación Car Cruds:** relación actual uno a uno dentro de esta integración, con revisión y auditoría transaccionales. Desvincular conserva la fila sin socio y su versión; no borra historial. El índice único parcial protege el socio y el bloqueo por empleado/versionado evita cambios perdidos. Las tablas anteriores conservan sus datos y restricciones; no se migra automáticamente su contenido. [ADR-018](ADR-018-integracion-car-cruds.md).

- **Fotografías Car Cruds:** cabecera por empleado/mes con referencia estable y versión creciente, más mensajes inmutables con actor/corte y estado de entrega. La preparación y el reclamo comparten bloqueo con el vínculo; el reclamo usa lease de 60 s basado en hora DB y UUID para descartar respuestas tardías. El POST ocurre fuera de la transacción. El reintento manual recupera el cuerpo original y las correcciones conservan recibos/historial; las observaciones positivas del mismo socio/mes se reutilizan como prueba, sin inventar negativos.

Las definiciones físicas se mantienen en [repositorio de Socios](../../services/socios-membresias/src/repository.ts), [almacenamiento de fotografías](../../services/socios-membresias/src/car-cruds-evidencias.storage.ts) y [repositorio de Clases](../../services/clases-reservas/src/repository.ts). La inicialización usa DDL idempotente y bloqueo para arranques concurrentes; no equivale a una estrategia completa de migraciones versionadas.

## Alternativas y consecuencias

Se mantiene el modelo relacional para integridad y transacciones dentro de Socios/Clases. Usar documentos para esos registros trasladaría parte de las asociaciones y restricciones a la aplicación. MongoDB se conserva para el historial de Accesos; la prueba real de ADR-019 verifica alternancia, concurrencia y ocupación sin duplicados.

El bloqueo por clase serializa escrituras sobre esa clase; su costo depende de la carga, sin latencia máxima garantizada. Las verificaciones por API son puntuales: no hay una transacción distribuida entre membresía y reserva. Una instancia PostgreSQL compartida y MongoDB de un nodo son límites del entorno local.

## Verificación

`npm run test:postgres` usa PostgreSQL 17 efímero, HTTP real e instancias con pools independientes: unicidad concurrente, alta externa/replay tras recrear app, rollback, último cupo, cancelación y recuperación FIFO. Para Car Cruds verifica carreras de vínculo/preparación/reclamo, historial, versiones/referencia, prueba positiva del mismo socio/mes, cuerpo inmutable, recuperación por lease/UUID y rollback de cabecera/fotografía. Los adaptadores en memoria no acreditan durabilidad. Pagos siguen pendientes. Accesos utiliza MongoDB real; pruebas y límites en [EVIDENCIA-ACCESOS](../EVIDENCIA-ACCESOS.md).
