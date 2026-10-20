# D3 - Persistencia

**Estado:** validada en la Entrega 2 con almacenamiento relacional integrado.  
**Fecha:** 07/10/2026 (propuesta inicial) | 12/10/2026 (validación operativa con PostgreSQL).

## Diseño de integración del paso 2 - antecedente del 19/10/2026

Los pendientes de empleados descritos en este apartado se resolvieron en el paso 5, detallado debajo; la integración de Tienda continúa pendiente.

Se mantienen los motores y el almacenamiento propietario de la decisión inicial. La [recepción de empleados](ADR-014-contrato-empleados.md) agrega datos de diseño a Socios y Membresías:

- Una aceptación deberá conservar conjuntamente el nuevo socio, su solicitud de membresía pendiente, la referencia al origen/empleado externo y el resultado de idempotencia. La implementación futura se coordinará dentro de la base PostgreSQL del servicio, sin accesos directos desde otro servicio.
- `PENDIENTE` es estado de la **solicitud**. El POST no crea una membresía; los estados actuales de `membresias` y su habilitación posterior al pago son conceptos separados.
- El diseño exige evitar altas nuevas con DNI/email existentes y la asociación de un empleado externo a otro DNI. Una repetición con el mismo origen, clave y cuerpo devuelve el resultado original; una clave reutilizada con otro cuerpo produce conflicto sin nuevos efectos.
- El modelo físico, las restricciones, las migraciones y el registro durable de idempotencia están pendientes. El **mock separado usa memoria** y no demuestra persistencia después de reiniciar.
- **Tienda** es el servicio separado confirmado para consultar productos y stock, según [ADR-015](ADR-015-limites-con-tienda.md). Desde el paso 6 tiene estructura ejecutable sin base, volumen, persistencia local, caché ni stock propio. El catálogo y las existencias pertenecen a la distribuidora; su identidad y contrato están pendientes.

La tabla de almacenamiento inicial que sigue se conserva como antecedente. El cuarto servicio no agrega un motor ni modifica las bases de los tres anteriores; su implementación está pendiente. Los límites vigentes están registrados en ADR-015, sucesor de D1.

Los esquemas y afirmaciones de validación del 12/10 se conservan como antecedentes del flujo de clases; no incluyen la nueva solicitud ni acreditan su implementación. Esta revisión no modifica bases ni datos.

**Referencias:** sección 3, página 4; sección 4.1, página 5; sección 5, páginas 6–7. Esta aclaración mantiene la decisión de motores y propiedad; cualquier sustitución posterior deberá dejar el ADR sucesor correspondiente.

## Requisito del enunciado

### Implementación de empleados - paso 5

Se mantiene la base `socios` y se agregan tablas mediante la inicialización transaccional existente (`CREATE TABLE IF NOT EXISTS`), sin reemplazar tablas ni datos anteriores:

| Tabla | Propiedad y restricciones |
|---|---|
| `socios` | Cuenta SOCIO, DNI/email únicos; el alta externa no define contraseña ni habilita membresía. |
| `solicitudes_membresia` | Identificador de solicitud, socio asociado único, estado PENDIENTE y fecha; separado de `membresias`. El tratamiento administrativo posterior queda pendiente. |
| `empleados_externos` | Clave primaria `(origen, empleado_externo_id)` y referencia única al socio. |
| `altas_empleados_idempotencia` | Clave primaria `(origen, clave)`, contenido normalizado, respuesta original JSONB, solicitud referenciada y fecha. |

Los cuatro registros se confirman en una sola transacción. Se serializan los reintentos por origen/clave y los registros de un mismo empleado por origen/identificador mediante `pg_advisory_xact_lock`; la unicidad normalizada de DNI/email cubre también carreras con altas administrativas. No se utiliza Redis, RabbitMQ ni almacenamiento del consumidor para esta garantía.

La idempotencia persiste entre reinicios y réplicas y no tiene una limpieza automática en esta etapa. Cambiar `EMPLEADOS_ORIGEN_ID` cambia el ámbito de las claves: debe conservarse al reiniciar. Los errores no se guardan como altas exitosas. Las pruebas con PostgreSQL provocan un fallo al insertar el último registro, comprueban el rollback y reintentan exitosamente la misma clave.

El adaptador en memoria conserva reglas equivalentes para pruebas de un solo proceso; solo PostgreSQL acredita durabilidad y coordinación entre instancias. No se crean pagos, planes ni membresías desde esta operación.

### Validación adicional del paso 4

Se conservan PostgreSQL y la propiedad de cada base. Socios consulta el historial de membresías por socio y selecciona el período aplicable a la fecha solicitada; en memoria se conserva cada membresía por su identificador para no perder la vigente al agregar una renovación futura. Los índices únicos `LOWER(BTRIM(email))` y `BTRIM(dni)` evitan identidades ambiguas incluso ante escrituras concurrentes. Si una base existente contiene duplicados incompatibles, la inicialización falla sin borrar, fusionar ni sobrescribir esas cuentas.

Clases mantiene sus tablas existentes, índices únicos parciales y bloqueos por clase. Una cancelación y una espera persistidas permiten inferir una promoción pendiente sin una tabla nueva. La nueva política queda en [D4, ADR-017](ADR-017-consistencia-y-recuperacion-de-espera.md).

`npm run test:postgres` comprobó ambos adaptadores contra PostgreSQL 17 efímero y dos instancias con pools independientes. El inicio completo se comprobó por separado con usuarios de base distintos en Compose; las pruebas conservaron los datos y volúmenes del grupo. Esto no valida aún pagos, solicitudes de empleados, persistencia de accesos ni almacenamiento no relacional integrado al dominio.

### Referencias

- **Sección 5, página 6:** D3 debe justificar el almacenamiento por servicio, sus patrones de acceso y las limitaciones aceptadas.
- **Sección 6.2 y 6.3:** la Entrega 1 requería la propuesta inicial y la Entrega 2 exige validar la persistencia integrando al menos un tipo de almacenamiento operativo al flujo principal.
- **Sección 2.8, página 3:** el sistema debe utilizar almacenamiento relacional y no relacional y proteger operaciones que no pueden duplicar ni perder información.

## Decisión inicial y distribución de almacenamiento

Mantener la propiedad definida en [D1](ADR-001-limites-de-servicios.md), con almacenamiento separado por servicio:

| Servicio | Almacenamiento | Datos y patrones de acceso | Motivo |
|---|---|---|---|
| **Socios y Membresías** | PostgreSQL, base propia | Socios, planes, membresías, pagos y comprobantes. Consulta por socio y membresía; evaluación del estado y las fechas de vigencia; registro del pago y su efecto sobre la membresía. | Las asociaciones y restricciones requieren integridad relacional. Pago, comprobante y habilitación deben poder guardarse en una misma transacción local. |
| **Clases y Reservas** | PostgreSQL, base propia | Clases por identificador, sede e inicio; reservas por clase y socio; lista de espera por clase y orden de inscripción. Lectura de capacidad y reservas confirmadas para calcular cupos. | Cupos, duplicados, cancelación y reasignación necesitan coordinar registros relacionados dentro del mismo servicio. |
| **Accesos y Ocupación** | MongoDB, base propia | Sedes por identificador; presencia actual por socio y sede; historial de intentos y movimientos por socio, sede y fecha; conteo de presencias abiertas por sede. | Los movimientos se representan como documentos y se consultan principalmente por esos identificadores y por tiempo. Se separa el historial creciente del estado actual de presencia. |

Las dos bases PostgreSQL comparten la instancia en el entorno local pero residen en bases independientes (`socios` y `clases`), con usuarios y credenciales estrictamente separados. Ningún servicio accede a la base de otro.

## Validación en la Entrega 2: Integración operativa de PostgreSQL

En la Entrega 2 se implementó y validó de punta a punta la persistencia relacional con **PostgreSQL 17** en `Clases y Reservas` y `Socios y Membresías`.

### 1. Modelado de esquemas y restricciones relacionales

En `clases-reservas`:
```sql
CREATE TABLE IF NOT EXISTS clases (
  clase_id VARCHAR(50) PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL,
  sede_id VARCHAR(50) NOT NULL,
  profesor VARCHAR(100),
  actividad VARCHAR(50),
  inicio TIMESTAMPTZ NOT NULL,
  fin TIMESTAMPTZ NOT NULL,
  capacidad INT NOT NULL,
  publicada BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reservas (
  reserva_id VARCHAR(50) PRIMARY KEY,
  clase_id VARCHAR(50) NOT NULL REFERENCES clases(clase_id),
  socio_id VARCHAR(50) NOT NULL,
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('CONFIRMADA', 'CANCELADA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lista_espera (
  espera_id VARCHAR(50) PRIMARY KEY,
  clase_id VARCHAR(50) NOT NULL REFERENCES clases(clase_id),
  socio_id VARCHAR(50) NOT NULL,
  orden INT NOT NULL,
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('PENDIENTE', 'PROMOVIDO', 'CANCELADO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Garantías a nivel de motor de datos:
CREATE UNIQUE INDEX IF NOT EXISTS uq_reserva_activa ON reservas (clase_id, socio_id) WHERE estado = 'CONFIRMADA';
CREATE UNIQUE INDEX IF NOT EXISTS uq_espera_activa ON lista_espera (clase_id, socio_id) WHERE estado = 'PENDIENTE';
CREATE INDEX IF NOT EXISTS idx_clases_consulta ON clases (publicada, sede_id, inicio);
```

En `socios-membresias`:
```sql
CREATE TABLE IF NOT EXISTS socios (
  socio_id VARCHAR(50) PRIMARY KEY,
  dni VARCHAR(20) NOT NULL UNIQUE,
  nombre VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'ACTIVO',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS membresias (
  membresia_id VARCHAR(50) PRIMARY KEY,
  socio_id VARCHAR(50) NOT NULL REFERENCES socios(socio_id),
  tipo_plan VARCHAR(50) NOT NULL,
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ NOT NULL,
  estado VARCHAR(20) NOT NULL CHECK (estado IN ('HABILITADA', 'SUSPENDIDA', 'VENCIDA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_membresias_socio ON membresias(socio_id);
```

### 2. Patrones de acceso soportados

1. **Cálculo dinámico de cupos disponibles:**
   - La capacidad libre no se almacena como una columna redundante sujeta a desfases, sino que se calcula transaccionalmente mediante agregación filtrada:
   ```sql
   SELECT c.clase_id, c.nombre, c.sede_id, c.inicio, c.capacidad,
          GREATEST(0, c.capacidad - COALESCE(COUNT(r.reserva_id) FILTER (WHERE r.estado = 'CONFIRMADA'), 0))::int AS cupos_disponibles
   FROM clases c
   LEFT JOIN reservas r ON c.clase_id = r.clase_id
   WHERE c.publicada = TRUE
   GROUP BY c.clase_id, c.nombre, c.sede_id, c.inicio, c.capacidad;
   ```
2. **Reserva concurrente y protección del último cupo:**
   - Se ejecuta dentro de una transacción PostgreSQL con bloqueo pesimista a nivel de fila (`SELECT ... FROM clases WHERE clase_id = $1 FOR UPDATE`).
   - Evita que dos solicitudes concurrentes confirmen cupos por encima de la capacidad de la clase.
3. **Cancelación y promoción automática:**
   - Dentro de la misma transacción, la cancelación de una reserva libera el cupo e inspecciona la tabla `lista_espera` bloqueando candidatos (`ORDER BY orden ASC FOR UPDATE`), promoviendo inmediatamente al siguiente socio con membresía habilitada.

### 3. Limitaciones aceptadas

- **Contención en fila única:** Al bloquear la fila de una clase con `FOR UPDATE`, solicitudes masivas concurrentes para la misma clase se encolan secuencialmente. Para una clase individual de 20-30 cupos esto asegura consistencia matemática estricta a costa de una latencia de cola insignificante (< 10 ms por transacción).
- **Separación de bases:** Al no compartir base con Socios, no existen claves foráneas que crucen servicios. La consistencia entre la existencia del socio y la reserva se resuelve mediante validación de frontera vía API.
