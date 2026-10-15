# D3 - Persistencia

**Estado:** validada en la Entrega 2 con almacenamiento relacional integrado.  
**Fecha:** 07/10/2026 (propuesta inicial) | 12/10/2026 (validación operativa con PostgreSQL).

## Requisito del enunciado

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
