# D3 - Persistencia

**Estado:** PostgreSQL y MongoDB integrados; Redis implementado en ocupación. Tienda utiliza PostgreSQL 17, con base y usuario propios, para stock local y movimientos durables según [ADR-022](ADR-022-tienda-y-consignaciones-fav.md).
**Fecha inicial:** 07/10/2026. **Revisión:** 11/11/2026.
**Enunciado:** §5 D3, página 6; §2.8, página 3; §6.2–6.3, página 8.

## Contexto

Membresías, pagos y reservas requieren asociaciones, unicidad y operaciones atómicas. Accesos necesita historial por socio, sede y tiempo. Cada servicio administra sus datos; consultar stock externo no requiere copiarlo. El nuevo stock físico del gimnasio es un inventario distinto y sí exige persistencia durable propia de Tienda.

## Decisión y patrones de acceso

El esquema y los datos de demostración se inicializan por separado. Socios y Clases crean sus esquemas sin cuentas, membresías, clases ni reservas de prueba por defecto. `CARGAR_DATOS_DEMO=true` habilita esa carga explícitamente para demostraciones. Los repositorios PostgreSQL reciben la opción de inicialización y conservan los bloqueos transaccionales del arranque concurrente. Los cuatro planes comerciales acordados son configuración inicial del negocio. Los registros preexistentes tienen su propio historial y la limpieza se evalúa por sus relaciones.

`npm run test:postgres` verifica cuatro tablas vacías con el inicio predeterminado y la carga explícita de cinco socios, cinco membresías, cuatro clases y 44 reservas sintéticas sin duplicación entre dos instancias. Los ensayos utilizan bases efímeras propias. El equipo confirmó conservar el historial usado en las pruebas compartidas con FAV y Car Cruds durante la limpieza del entorno existente.

**Verificación del 11/11/2026.** Aprobaron la compilación de los cuatro servicios, PostgreSQL con dos instancias, 286 pruebas de regresión secuenciales con cobertura, 15 de Accesos, 21 de membresías, 13 de búsqueda, 17 de administración de clases y 12 de eventos. El Compose temporal verificó el inicio vacío, las tres sedes acordadas, la activación explícita de demostración, el balanceo y la recuperación. La cobertura global fue 73,47 % de líneas, 88,14 % de ramas y 86,82 % de funciones.

| Servicio | Almacenamiento y patrones | Estado |
|---|---|---|
| Socios y Membresías | PostgreSQL, base `socios`: identidad por DNI/email, membresías por socio/fecha, vinculación y fotografías Car Cruds por empleado/mes/versión; pagos y habilitación concretados en una transacción local (ADR-021). | `socios`, `membresias`, `solicitudes_membresia`, `empleados_externos`, `altas_empleados_idempotencia`, `car_cruds_vinculos`, `car_cruds_vinculos_historial`, `car_cruds_evidencias_series` y `car_cruds_evidencias` operativas; planes/pagos/comprobantes operativos en tablas aditivas; ADR-021 detalla esquema y garantías. |
| Clases y Reservas | PostgreSQL, base `clases`: catálogo por sede/inicio, reservas por clase/socio, espera por orden y resultados administrativos por actor/clave. | `clases`, `reservas`, `lista_espera` y `clases_operaciones` operativas. Versión aditiva en clases y FTS/GIN generado. |
| Accesos y Ocupación | MongoDB, base `accesos`: sedes, movimientos e historial por identificador/tiempo, presencias abiertas y ocupación derivada. Redis para la lectura de ocupación. | Recepción transaccional e idempotencia durable implementadas; caché implementada y medida según ADR-020. |
| Tienda | PostgreSQL 17, base y usuario `tienda`: stock por variante, entregas por referencia, ventas por actor y resultados por operación/origen/clave. El catálogo y stock de distribuidora siguen en FAV. | `tienda_stock`, `tienda_reposiciones`, `tienda_ventas` y `tienda_operaciones` implementadas; stock, movimiento y respuesta se guardan en una transacción. ADR-022 revisa la decisión previa de no guardar existencias. |

Las bases relacionales comparten una instancia local, con usuarios/credenciales separados y permisos por base. Esto separa propiedad, no recursos físicos ni disponibilidad. El servicio consumidor usa APIs y referencias por ID, sin claves foráneas entre bases. Límites vigentes en [D1](ADR-022-tienda-y-consignaciones-fav.md).

La elección de PostgreSQL para Tienda fue confirmada por el equipo: las existencias, referencias únicas y respuestas idempotentes necesitan operaciones atómicas y se reutiliza el motor existente sin agregar otro servidor. El inicializador crea base/rol faltantes sin borrar registros ni rotar claves existentes; el inicio completa `TIENDA_DB_PASSWORD` y `FAV_API_KEY` solo cuando faltan. Las credenciales permanecen fuera de Git.

### Consistencia implementada

- **Identidad:** índices únicos sobre `LOWER(BTRIM(email))` y `BTRIM(dni)`, además del identificador primario. Los duplicados históricos incompatibles hacen fallar la inicialización; no se fusionan ni eliminan cuentas automáticamente.
- **Membresía:** se consulta el historial y se selecciona el período aplicable a la fecha. Una renovación futura no oculta la vigente.
- **Reservas:** transacciones con bloqueo primero sobre la clase e índices únicos parciales de reserva confirmada/espera pendiente. Los cupos se calculan con reservas confirmadas, sin contador redundante. La cancelación y la promoción son operaciones locales separadas; no se llama a Socios mientras se mantiene el bloqueo. [D4](ADR-017-consistencia-y-recuperacion-de-espera.md).
- **Administración de clases.** Desde el bloque 5.4, clase, vector FTS y respuesta idempotente se confirman en una transacción. `clases_operaciones` conserva entrada/respuesta JSONB por administrador/clave, sin TTL. `clases.version` recibe 1 en datos previos. La edición comparte bloqueo con reservas/espera y exige versión esperada e inexistencia de inscriptos activos. Las llamadas a Accesos ocurren antes del bloqueo. [D6](ADR-006-busqueda.md).
- **Alta externa:** una transacción guarda socio, solicitud `PENDIENTE`, referencia externa y respuesta original JSONB. Bloqueos consultivos por origen/clave y origen/empleado serializan reintentos; índices únicos protegen DNI/email. Un fallo revierte todos los registros. El POST no crea membresía ni contraseña.
- **Idempotencia durable:** el resultado se conserva entre reinicios e instancias, sin purga automática. Cambiar el origen cambia su ámbito; el replay devuelve el alta original, no el estado actual de una membresía.
- **Vinculación Car Cruds:** relación actual uno a uno dentro de esta integración, con revisión y auditoría transaccionales. Desvincular conserva la fila sin socio y su versión; no borra historial. El índice único parcial protege el socio y el bloqueo por empleado/versionado evita cambios perdidos. Las tablas anteriores conservan sus datos y restricciones; no se migra automáticamente su contenido. [ADR-018](ADR-018-integracion-car-cruds.md).

- **Fotografías Car Cruds:** cabecera por empleado/mes con referencia estable y versión creciente, más mensajes inmutables con actor/corte y estado de entrega. La preparación y el reclamo comparten bloqueo con el vínculo; el reclamo usa lease de 60 s basado en hora DB y UUID para descartar respuestas tardías. El POST ocurre fuera de la transacción. El reintento manual recupera el cuerpo original y las correcciones conservan recibos/historial; las observaciones positivas del mismo socio/mes se reutilizan como prueba, sin inventar negativos.

- **Stock de Tienda:** bloqueos por operación/origen/clave, referencia de entrega y fila de producto serializan reintentos y movimientos. Reposición, incremento y resultado se confirman juntos; una referencia repetida con otra clave devuelve la entrega original y vincula la nueva clave sin sumar unidades. Las ventas se deduplican por administrador/clave, conservan actor y respuesta, y no pueden dejar saldo negativo. Las cantidades se validan como enteros seguros; un desborde revierte la operación. No hay llamada a FAV dentro de estas transacciones.

- **Identificadores de Tienda:** se conserva la cadena opaca completa en JSON y se usan digests para índices y bloqueos de tamaño fijo. Se compara también el valor completo; el hash no reemplaza la identidad. No se agrega un límite comercial de veinte unidades ni se truncan variantes o referencias.

Las definiciones físicas se mantienen en [repositorio de Socios](../../services/socios-membresias/src/repository.ts), [almacenamiento de fotografías](../../services/socios-membresias/src/car-cruds-evidencias.storage.ts), [repositorio de Clases](../../services/clases-reservas/src/repository.ts) y [repositorio de Tienda](../../services/tienda/src/stock.postgres.ts). La inicialización usa DDL idempotente y bloqueo para arranques concurrentes; no equivale a una estrategia completa de migraciones versionadas.

## Alternativas y consecuencias

Se mantiene el modelo relacional para integridad y transacciones dentro de Socios/Clases/Tienda. Usar documentos para esos registros trasladaría parte de las asociaciones y restricciones a la aplicación. MongoDB se conserva para el historial de Accesos; la prueba real de ADR-019 verifica alternancia, concurrencia y ocupación sin duplicados.

El bloqueo por clase serializa escrituras sobre esa clase; su costo depende de la carga, sin latencia máxima garantizada. Las verificaciones por API son puntuales: no hay una transacción distribuida entre membresía y reserva. Una instancia PostgreSQL compartida y MongoDB de un nodo son límites del entorno local.

## Verificación

**Suspensiones, 07/11/2026.** `membresias_outbox` pertenece a Socios. Clases posee `membresias_inbox` y `membresias_suspendidas`. Migraciones aditivas, estado/evento/resultado atómicos en origen y cancelación/Inbox/proyección atómicos en destino. Las escrituras de reserva/espera/promoción y el consumidor bloquean socio antes de clase. Se mantiene propiedad exclusiva y entrega al menos una vez. [D5](ADR-005-comunicacion-entre-servicios.md) y [verificación específica](../EVIDENCIA-EVENTOS-MEMBRESIA.md).

`npm run test:postgres` usa PostgreSQL 17 efímero, HTTP real e instancias con pools independientes: unicidad concurrente, alta externa/replay tras recrear app, rollback, último cupo, cancelación y recuperación FIFO. Para Car Cruds verifica carreras de vínculo/preparación/reclamo, historial, versiones/referencia, prueba positiva del mismo socio/mes, cuerpo inmutable, recuperación por lease/UUID y rollback de cabecera/fotografía. Los adaptadores en memoria no acreditan durabilidad. Pagos manuales se verifican separadamente con PostgreSQL real mediante `npm run test:membresias`, incluyendo rollback de comprobante, concurrencia y actualización de esquema; ver ADR-021. Accesos utiliza MongoDB real; pruebas y límites en [EVIDENCIA-ACCESOS](../EVIDENCIA-ACCESOS.md).

La etapa 3 agrega cinco tablas sin modificar las solicitudes externas históricas: [ADR-021](ADR-021-planes-pagos-membresias.md). No se eliminan ni reparan datos del usuario al migrar.

El 10/11/2026 se agrega `solicitudes_planes.duracion_meses`, nullable y limitada a 1–36 cuando está informada. Las solicitudes nuevas copian la duración del plan en su transacción de creación. Las filas anteriores conservan `NULL`, sin reconstruir meses a partir de sus fechas. La fuente de fotografías de Car Cruds lee esa copia junto con los pagos confirmados. [Reglas y migración](ADR-021-planes-pagos-membresias.md).

`npm run test:tienda` verifica la capacidad con PostgreSQL 17 efímero y dos instancias HTTP: contrato, permisos, replay por clave/referencia, concurrencia, reinicio, rollback del resultado, ventas sin negativos, enteros/identificadores y caída de la base. No llama a FAV ni utiliza el inventario local del equipo. Evidencia y alcance de las verificaciones en [EVIDENCIA-TIENDA](../EVIDENCIA-TIENDA.md).
