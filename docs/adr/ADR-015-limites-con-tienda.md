# D1 - Límites de servicios con Tienda

**Estado:** diseño confirmado; estructura de Tienda ejecutable desde el paso 6. Consulta externa pendiente del contrato del proveedor.
**Fecha:** 19/10/2026.
**Reemplaza:** [ADR-001 - Límites de servicios y propiedad de los datos](ADR-001-limites-de-servicios.md).

## Contexto y requisitos

La asignación del profesor incorpora una sección Tienda que consulta productos y stock de una distribuidora. El equipo confirmó que esa responsabilidad pertenecerá a un servicio separado, sin una base de datos nueva y con implementación en la etapa de integración.

La sección 2.1 del enunciado, página 2, requiere al menos tres microservicios y un gateway. La separación de Tienda es una decisión del proyecto para la nueva capacidad, no un requisito de tener cuatro servicios en E1. La sección 6.2, página 8, exige límites, responsabilidades y propiedad de datos documentados. La sección 4.1, página 5, sitúa el consumo externo en el microservicio responsable. La sección 5, página 7, exige conservar el historial de decisiones reemplazadas.

## Decisión

Se mantienen los tres límites originales y se agrega Tienda al diseño:

| Servicio | Responsabilidad y propiedad de datos |
|---|---|
| Socios y Membresías | Socios, planes, membresías, pagos y comprobantes. También será propietario de la referencia al empleado externo, de su solicitud pendiente y de la idempotencia del POST definido en [D8, ADR-014](ADR-014-contrato-empleados.md). |
| Clases y Reservas | Clases, capacidad, reservas, listas de espera e índice de búsqueda derivado. Sus consultas continúan como funciones del gimnasio. |
| Accesos y Ocupación | Sedes, intentos de ingreso, egresos, ingresos abiertos, ocupación derivada y su caché. |
| Tienda | Consulta e integración con el catálogo y stock de la distribuidora. No administra stock propio ni incorpora una base de datos local en el alcance acordado. Productos y existencias son propiedad del proveedor. |

El frontend presentará la consulta de Tienda a través del gateway. El servicio Tienda será quien llame al proveedor; el frontend y nuestro gateway no efectuarán esa llamada externa directamente.

Se conserva la separación de las bases PostgreSQL de Socios y Clases y el almacenamiento MongoDB previsto para Accesos. Agregar Tienda no cambia esos motores ni habilita el acceso a bases ajenas.

El contrato, las rutas concretas y los datos de conexión de la distribuidora se resolverán cuando se conozcan y antes de implementar el cliente externo. No se incorporan compras, pedidos, reposición ni un servicio genérico para todas las integraciones.

## Motivos y alternativas consideradas

- **Servicio Tienda separado:** elegido por el equipo para mantener la consulta de productos y stock dentro de una responsabilidad explícita, sin mezclarla con membresías, reservas o ingresos.
- **Agregar la integración a uno de los servicios existentes:** se revisó como alternativa y el equipo confirmó la separación. Los límites existentes conservan sus responsabilidades.
- **Incorporar una base de datos de productos y stock propia:** no se adopta; el alcance consiste en consultar datos cuyo propietario es la distribuidora.

## Consecuencias y estado

- Desde el paso 6, el diseño y la estructura ejecutable contemplan cuatro servicios. Tienda tiene workspace, imagen, Compose, salud y una sección en el portal del socio. No se incorpora almacenamiento local.
- El contrato y mock de empleados pertenecen a Socios y Membresías; Tienda no intermedia ese alta.
- El proveedor sigue sin identificación, contrato ni URL conocidos. Esa información está pendiente y no se simula como una integración real ya existente.
- El equipo confirmó que todavía no dispone de esos datos. Por ello solo se prepara el recorrido interno portal → gateway → Tienda. La ruta interna `GET /api/v1/tienda/productos` exige la sesión existente y devuelve `503 INTEGRACION_PENDIENTE`; no define ni invoca una ruta de la distribuidora. El cliente externo y el modelo de productos se incorporarán con su contrato.
- La actualización de contexto y contenedores está en [ARCHITECTURE.md](../ARCHITECTURE.md). Los efectos sobre persistencia y comunicación se aclaran en [D3](ADR-003-persistencia.md), [D5](ADR-005-comunicacion-entre-servicios.md) y [D9](ADR-009-consumo-del-proveedor.md).
