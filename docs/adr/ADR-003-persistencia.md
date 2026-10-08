# D3 - Persistencia

**Estado:** propuesta inicial para la Entrega 1.  
**Fecha:** 07/10/2026.

## Requisito del enunciado

- **Sección 5, página 6:** D3 debe justificar el almacenamiento por servicio, sus patrones de acceso y las limitaciones aceptadas.
- **Sección 6.2, página 8:** la Entrega 1 requiere una versión inicial de D3.
- **Sección 2.8, página 3:** el sistema debe utilizar almacenamiento relacional y no relacional y proteger operaciones que no pueden duplicar ni perder información.

El enunciado exige esos tipos y garantías; PostgreSQL y MongoDB son los productos propuestos en este diseño inicial para resolverlos. Todavía no hay mediciones de volumen o rendimiento que permitan afirmar una ventaja cuantitativa.

## Decisión propuesta

Mantener la propiedad definida en [D1](ADR-001-limites-de-servicios.md), con almacenamiento separado por servicio:

| Servicio | Almacenamiento | Datos y patrones de acceso | Motivo |
|---|---|---|---|
| **Socios y Membresías** | PostgreSQL, base propia | Socios, planes, membresías, pagos y comprobantes. Consulta por socio y membresía; evaluación del estado y las fechas de vigencia; registro del pago y su efecto sobre la membresía. | Las asociaciones y restricciones requieren integridad relacional. Pago, comprobante y habilitación deben poder guardarse en una misma transacción local. |
| **Clases y Reservas** | PostgreSQL, base propia | Clases por identificador, sede e inicio; reservas por clase y socio; lista de espera por clase y orden de inscripción. Lectura de capacidad y reservas confirmadas para calcular cupos. | Cupos, duplicados, cancelación y reasignación necesitan coordinar registros relacionados dentro del mismo servicio. |
| **Accesos y Ocupación** | MongoDB, base propia | Sedes por identificador; presencia actual por socio y sede; historial de intentos y movimientos por socio, sede y fecha; conteo de presencias abiertas por sede. | Los movimientos se representan como documentos y se consultan principalmente por esos identificadores y por tiempo. Se separa el historial creciente del estado actual de presencia. |

Las dos bases PostgreSQL pueden compartir una instancia en el entorno local, con usuarios y permisos separados. Ningún servicio accede a la base de otro ni utiliza relaciones de base de datos que crucen sus límites.

## Condiciones de consistencia del diseño

- **Socios y Membresías:** conservar las asociaciones entre pago, comprobante y membresía y evitar repetir sus efectos. La evaluación de habilitación considera el estado y las fechas; un indicador almacenado por sí solo no demuestra vigencia.
- **Clases y Reservas:** proteger el último cupo, la ausencia de reservas confirmadas duplicadas y la prioridad de espera. Elegir PostgreSQL no alcanza por sí solo: D4 precisará las restricciones y la coordinación de operaciones concurrentes.
- **Accesos y Ocupación:** mantener un registro de presencia por pareja socio/sede. Un ingreso o egreso aceptado debe actualizar esa presencia y registrar el movimiento de manera atómica. Los movimientos rechazados se registran sin alterar la presencia.

Para esa actualización de varios documentos, se propone utilizar transacciones de MongoDB. El entorno local deberá iniciarlo como **replica set**, condición de despliegue necesaria para esas transacciones. La configuración inicial no implica alta disponibilidad. Véanse [transacciones](https://www.mongodb.com/docs/manual/core/transactions/) y [condiciones de despliegue](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/) en la documentación oficial.

La ocupación se obtiene de las presencias abiertas. El historial se conserva en registros separados, evitando una lista indefinida de movimientos dentro de un único documento de socio o sede. Los índices sobre las claves y fechas de consulta se concretarán al implementar el modelo.

## Datos derivados y controles de comunicación

El índice de búsqueda pertenece a Clases y Reservas y la caché de ocupación a Accesos y Ocupación. Sus productos, actualización y tiempos se resolverán en D6 y D7. La reserva de un cupo y la aceptación de un movimiento utilizan el almacenamiento propietario; los datos derivados no sustituyen esas validaciones.

Los controles de [D5](ADR-005-comunicacion-entre-servicios.md) se guardarán en las bases de sus propietarios: avisos pendientes de publicación en Socios y Membresías; mensajes recibidos/procesados y reasignaciones pendientes en Clases y Reservas. Son registros técnicos para recuperar fallas y evitar duplicaciones.

## Alternativas y limitaciones

- Usar solo SQL o solo NoSQL no cubre los dos tipos exigidos por el enunciado. Se distribuyen según los patrones de cada servicio.
- Guardar todo en una base compartida permitiría consultas directas, pero introduciría dependencia entre modelos y propiedad compartida de los datos; se mantiene la separación de D1.
- MongoDB agrega otro motor y la configuración de replica set. Sus transacciones deben coordinar los cambios de presencia e historial; no se presume que todo documento independiente sea suficiente para mantener la ocupación.
- Las transacciones locales no vuelven atómica una operación entre servicios. La validación de membresía y la reserva en otra base requieren coordinación adicional, a precisar en D4.
- La estructura inicial levanta PostgreSQL 17 y MongoDB 8.0 mediante `compose.yaml`, con volúmenes, usuarios separados y replica set de un nodo. No crea todavía tablas ni colecciones del negocio. Esquemas, migraciones, índices y conexiones desde el código se concretarán al implementar. D3 se validará en la Entrega 2 contra la implementación y su comportamiento.

Referencia técnica: [transacciones y aislamiento de PostgreSQL](https://www.postgresql.org/docs/current/transaction-iso.html).
