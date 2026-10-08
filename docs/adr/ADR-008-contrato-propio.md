# D8 - Contrato de la capacidad propia

**Estado:** capacidad confirmada por el grupo; diseño inicial para la Entrega 1.  
**Fecha:** 07/10/2026.

## Contexto

El enunciado exige publicar una capacidad utilizable por otro grupo, con un contrato formal, estándar y versionado en `docs/contracts/`. La Entrega 1 solicita seleccionar y documentar esa capacidad y registrar D8. El consumidor todavía no fue asignado por la cátedra.

## Decisión

Ofrecer **consulta de clases y cupos disponibles**, propiedad de Clases y Reservas. Esta elección fue confirmada durante la definición del contrato. Se reutilizan los datos y las reglas del [alcance](../ALCANCE_PRELIMINAR.md).

La interfaz inicial será HTTP con respuestas JSON, descrita en [OpenAPI 3.1.1](../contracts/openapi-v1.yaml), versión de API `1.0.0`:

- `GET /api/v1/clases`: listado con filtro por sede e intervalo de inicio, paginación y orden determinista.
- `GET /api/v1/clases/{claseId}`: detalle y disponibilidad de una clase publicada.

Los cupos se calculan en el almacenamiento propietario al producir la respuesta. Se enviará `Cache-Control: no-store` para evitar reutilizar respuestas anteriores. Su consulta no retiene cupos ni valida socios; una reserva sigue sujeta a las reglas del gimnasio. Las operaciones son idempotentes y no requieren una clave de idempotencia.

Para la integración se propone una clave de consumidor mediante `X-API-Key`, transmitida por HTTPS en el entorno operativo y configurada fuera del repositorio. Nuestro API Gateway dirigirá las solicitudes al servicio propietario.

## Alternativas y motivos

- Se consideraron también la consulta de ocupación por sede y la validación de membresías. Se eligió clases y cupos porque aprovecha el flujo principal y permite consultar actividades sin requerir datos personales del socio.
- Se utiliza una API de consulta para obtener una respuesta al solicitarla. Los eventos internos de membresías seguirán la decisión de comunicación D5.
- OpenAPI permite describir operaciones, parámetros, datos, errores y autenticación en un formato procesable, y usar el mismo contrato al preparar el mock.

## Compatibilidad y publicación

La versión mayor se identificará en la ruta. Los cambios incompatibles requieren una nueva versión mayor, conservar el contrato anterior y coordinar la migración; las ampliaciones compatibles incrementan la versión menor y las correcciones documentales, el parche.

El contrato y los ejemplos se publicarán en el repositorio. La estructura inicial incluye un mock local en `http://localhost:8080`, con las rutas del contrato, clave configurada en `.env` y datos ficticios en memoria. Sus instrucciones están en [docs/contracts/README.md](../contracts/README.md). La implementación real y su URL pública están pendientes; el entorno operativo deberá ser accesible al consumidor y mantenerse durante la evaluación.

## Consecuencias

- Se exponen dos operaciones de lectura con datos de clases y disponibilidad; el contrato no ofrece operaciones de reserva al otro grupo.
- La disponibilidad puede cambiar después de consultarla. Un fallo de consulta representa información desconocida, no una clase llena.
- Cuando se asigne el consumidor, habrá que acordar y verificar la incorporación de la capacidad a un flujo importante de su negocio.
- Los parámetros, esquemas, errores y ejemplos quedan definidos en [docs/contracts/README.md](../contracts/README.md) y en el contrato. El mock y la implementación deberán respetarlos.
