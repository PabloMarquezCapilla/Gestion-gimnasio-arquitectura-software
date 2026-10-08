# D1 - Límites de servicios y propiedad de los datos

**Estado:** propuesta inicial para la Entrega 1.  
**Fecha:** 07/10/2026.

## Contexto

El [alcance confirmado](../ALCANCE_PRELIMINAR.md) relaciona la confirmación de un pago con la habilitación de una membresía; las reservas con el cupo y la lista de espera de una clase; y la ocupación con ingresos y egresos alternados por socio y sede. El enunciado requiere al menos tres microservicios y un API Gateway.

## Decisión propuesta

Dividir las responsabilidades en tres microservicios con almacenamiento propio:

| Servicio | Datos de los que es propietario |
|---|---|
| Socios y Membresías | Socios, planes, membresías, pagos y comprobantes internos. |
| Clases y Reservas | Clases y sus datos de actividad y profesor, capacidad, reservas, listas de espera e índice de búsqueda derivado. |
| Accesos y Ocupación | Sedes, intentos de ingreso, egresos, ingresos abiertos, ocupación derivada y su caché. |

Los otros servicios utilizan identificadores y consultan al propietario mediante sus interfaces. Solo el propietario modifica sus datos y aplica sus reglas. El frontend y el API Gateway dirigen las solicitudes al servicio responsable.

La distribución completa, los actores autorizados y las colaboraciones se detallan en [ARCHITECTURE.md](../ARCHITECTURE.md).

## Motivos y alternativa considerada

- **Pagos junto a membresías:** permite coordinar en el mismo límite la confirmación del pago, el comprobante y la habilitación, evitando distribuir esa operación entre dos propietarios.
- **Reservas junto a clases:** mantiene bajo un mismo responsable el cupo, los duplicados, las cancelaciones y la prioridad de la lista de espera, incluida la reserva concurrente del último cupo.
- **Sedes junto a accesos:** concentra el registro de movimientos por sede, la alternancia y la ocupación derivada.
- Separar Pagos o Reservas en servicios adicionales introduciría coordinación entre servicios para esas operaciones. Para el alcance inicial, se propone mantenerlas dentro de los límites anteriores.

## Consecuencias

- Cada servicio puede aplicar las reglas sobre sus propios registros; ningún otro accede directamente a su almacenamiento.
- Clases y Reservas y Accesos y Ocupación dependen de la consulta de habilitación de Socios y Membresías.
- Clases y Reservas consulta las sedes en Accesos y Ocupación y recibe cambios de habilitación para cancelar reservas futuras afectadas.
- El índice y la caché son derivados y deben actualizarse desde los datos de sus propietarios.
- D3 precisará la persistencia; D5, los contratos y el tratamiento de fallas. D4 deberá resolver la concurrencia, incluida la coordinación de cambios de membresía con reservas.
