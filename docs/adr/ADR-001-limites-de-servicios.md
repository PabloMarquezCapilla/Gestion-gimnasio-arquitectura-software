# D1 - Límites de servicios y propiedad de los datos

**Estado:** validada en la Entrega 2.  
**Fecha:** 07/10/2026 (propuesta inicial) | 12/10/2026 (validación con implementación punta a punta).

## Contexto

El [alcance confirmado](../ALCANCE_PRELIMINAR.md) relaciona la confirmación de un pago con la habilitación de una membresía; las reservas con el cupo y la lista de espera de una clase; y la ocupación con ingresos y egresos alternados por socio y sede. El enunciado requiere al menos tres microservicios y un API Gateway.

## Decisión inicial

Dividir las responsabilidades en tres microservicios con almacenamiento propio:

| Servicio | Datos de los que es propietario |
|---|---|
| **Socios y Membresías** | Socios, planes, membresías, pagos y comprobantes internos. |
| **Clases y Reservas** | Clases y sus datos de actividad y profesor, capacidad, reservas, listas de espera e índice de búsqueda derivado. |
| **Accesos y Ocupación** | Sedes, intentos de ingreso, egresos, ingresos abiertos, ocupación derivada y su caché. |

Los otros servicios utilizan identificadores y consultan al propietario mediante sus interfaces. Solo el propietario modifica sus datos y aplica sus reglas. El frontend y el API Gateway dirigen las solicitudes al servicio responsable.

La distribución completa, los actores autorizados y las colaboraciones se detallan en [ARCHITECTURE.md](../ARCHITECTURE.md).

## Motivos y alternativas consideradas

- **Pagos junto a membresías:** permite coordinar en el mismo límite la confirmación del pago, el comprobante y la habilitación, evitando distribuir esa operación entre dos propietarios.
- **Reservas junto a clases:** mantiene bajo un mismo responsable el cupo, los duplicados, las cancelaciones y la prioridad de la lista de espera, incluida la reserva concurrente del último cupo.
- **Sedes junto a accesos:** concentra el registro de movimientos por sede, la alternancia y la ocupación derivada.
- Separar Pagos o Reservas en servicios adicionales introduciría coordinación entre servicios para esas operaciones. Para el alcance inicial, se mantiene la cohesión dentro de los límites anteriores.

## Validación en la Entrega 2: Dominio propio de punta a punta

Durante la implementación y prueba del flujo principal de punta a punta (`Socios y Membresías` <-> `Clases y Reservas`), se validó la adecuación de estos límites:

1. **Autonomía y propiedad estricta de datos:**
   - `Socios y Membresías` mantiene en su propia base relacional los registros de `socios` y `membresias`. Nunca expone su esquema ni tablas a otros servicios.
   - `Clases y Reservas` almacena de forma independiente `clases`, `reservas` y `lista_espera`. No almacena copias de datos personales del socio, solo su identificador de referencia (`socioId`).
2. **Interacción mediante interfaces bien definidas:**
   - Al procesar una solicitud en `POST /api/v1/reservas`, `Clases y Reservas` consulta sincrónicamente a `Socios y Membresías` mediante `GET /api/v1/socios/:socioId/habilitacion?fecha=...`.
   - La respuesta devuelve exclusivamente la evaluación de negocio (`habilitado: boolean`, `motivo`, datos vigentes de membresía).
   - `Clases y Reservas` utiliza dicha respuesta para autorizar o denegar la transacción de reserva dentro de su propio motor de base de datos.
3. **Comportamiento sin acoplamiento de almacenamiento:**
   - Se verificó que las migraciones, esquemas y transacciones de cada microservicio evolucionan de forma totalmente aislada.
   - En las pruebas de integración (`test/flujo-principal.test.mjs`), el aislamiento de fronteras permitió verificar escenarios de reservas exitosas, reservas rechazadas por membresía inactiva, y manejo de lista de espera sin ninguna contaminación de estado entre almacenes.

## Consecuencias confirmadas

- **Alta cohesión:** Cada servicio aplica localmente las reglas de negocio sobre sus entidades propietarias.
- **Acoplamiento controlado:** La dependencia de `Clases y Reservas` hacia `Socios y Membresías` está limitada a una única llamada de lectura idempotente por reserva.
- **Resiliencia requerida:** Si `Socios y Membresías` no está disponible, `Clases y Reservas` degrada controladamente respondiendo `503 SERVICIO_NO_DISPONIBLE` en lugar de confirmar reservas a ciegas o fallar de manera impredecible.
