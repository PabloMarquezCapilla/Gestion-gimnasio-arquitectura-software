# Tienda y consignaciones de FAV

**Estado:** alcance, contrato y PostgreSQL confirmados por el equipo; backend de stock/reposiciones y panel de ventas implementados y verificados con HTTP/PostgreSQL, Chrome y Compose/NGINX. Publicado por HTTPS en Azure. El recorrido principal de catálogo, reposición y compra con FAV está verificado. [Evidencia conjunta](../EVIDENCIA-TIENDA.md#prueba-conjunta-en-azure-del-10112026).
**Fecha:** 06/11/2026.
**Reemplazada parcialmente por:** [ADR-023](ADR-023-compra-de-socios-en-tienda.md) (09/11/2026). Los socios ahora compran desde el portal; esas compras también descuentan este stock. El resto de la decisión sigue vigente.
**Reemplaza:** [ADR-015, D1](ADR-015-limites-con-tienda.md), que limitaba Tienda a lectura sin persistencia. Complementa D8 y [D9](ADR-009-consumo-del-proveedor.md); no reemplaza Car Cruds ni su ADR-018.
**Enunciado:** §3, página 4; §4.1, páginas 5–6; §5 D1/D3/D8/D9 e historia de decisiones, páginas 6–7; presentación grupal, páginas 8–9.

## Contexto

El equipo aclaró la asignación del profesor: el gimnasio ofrece el espacio y FAV maneja el abastecimiento de una tienda. Además de consumir su catálogo, el gimnasio debe ofrecer consulta del stock local y recepción de reposiciones. Esta ampliación fue confirmada expresamente; las suposiciones del mock de FAV no constituyen reglas del gimnasio.

La rama externa `feature-inventario` ya no existe. Se inspeccionó `development` en `adb9838023ddd5d4340f8bc7a95b38fdbc695845` para contrastar el cliente existente. Todavía deben confirmar la rama de integración, URL y credenciales. Su límite ficticio de veinte unidades no se adopta.

## Decisión y responsabilidades

| Responsable | Datos y operación |
|---|---|
| FAV | Catálogo, IDs de variantes, precios y stock de distribuidora; envía entregas al gimnasio y consulta las existencias recibidas. |
| Tienda | Stock físico de una única tienda del gimnasio, recepciones, ventas acumuladas y resultados idempotentes. No representa el stock general de FAV. |
| ADMIN del gimnasio | Registra las unidades vendidas desde la aplicación; no puede vender más unidades que las disponibles. |
| Socios, Clases y Accesos | Conservan sus responsabilidades y almacenes; no administran las existencias de Tienda. |

Tienda mantiene Capas. NGINX enruta las entradas y el servicio valida las credenciales. Las salidas al catálogo de FAV partirán del backend de Tienda, sin lectura de bases ajenas. En la decisión inicial del contrato la persistencia aún estaba por elegir; el equipo confirmó después **PostgreSQL 17 con base y usuario `tienda`**, separados de Socios y Clases dentro de la instancia existente. D3 registra esa concreción y sus límites.

### Reglas confirmadas

- Una única tienda para esta versión, sin stock por sede.
- Una reposición recibe una variante y suma unidades disponibles. `productoCodigo` es el `varianteId` de FAV.
- Una venta registrada por ADMIN descuenta disponibles y suma vendidos acumulados. El saldo nunca puede ser negativo. No se incluyen devoluciones ni ajustes.
- Referencia de entrega única por proveedor. Repetir clave y datos, o enviar otra clave para la misma referencia y datos, conserva entrega, ID y resultado sin sumar stock.
- Reutilizar clave o referencia con otros datos produce conflicto sin alterar existencias. La confirmación de entrega, stock y resultado debe ser atómica y resistir concurrencia/reinicio.

### Contrato propio adicional

[OpenAPI FAV 1.0.0](../contracts/openapi-fav-v1.yaml) y [guía de intercambio](../contracts/fav-tienda.md):

- `GET /api/v1/consignaciones/stock?proveedorId=fav`: disponibles y vendidos acumulados por variante.
- `POST /api/v1/consignaciones/reposiciones`: una variante, unidades y referencia de entrega.
- `X-API-Key` identifica a FAV; el POST también exige `Idempotency-Key`. Las credenciales no pertenecen a usuarios SOCIO/ADMIN.

Las rutas y campos conservan la forma que su cliente ya esperaba. El contrato distingue repetición de conflicto y error técnico; FAV debe revisar su compensación automática de todos los 4xx antes de la prueba conjunta. No se define todavía una API externa de ventas: son operaciones administrativas del gimnasio.

### Implementación local

`app.ts` autentica y adapta HTTP; `stock.ts` valida comandos y declara el puerto; `stock.postgres.ts` guarda `tienda_stock`, `tienda_reposiciones`, `tienda_ventas` y `tienda_operaciones`. Los movimientos bloquean clave/referencia y stock según corresponda y guardan entrega o venta, existencias y respuesta en una transacción. Las ventas se deduplican por administrador/clave; la nueva clave de una entrega ya recibida queda asociada al mismo resultado. No se llama a FAV mientras se mantiene un bloqueo SQL.

La API interna `GET /api/v1/tienda/stock` y `POST /api/v1/tienda/ventas` exige JWT ADMIN; la venta también exige `Idempotency-Key`. El panel conserva la operación incierta en sessionStorage por actor, sin JWT, para recuperar el mismo resultado. Las respuestas tardías no sustituyen el estado de otro administrador ni retiran una operación local diferente.

El arranque exige la conexión a la base propia y la credencial técnica de FAV. El inicializador incorpora base/usuario faltantes sin borrar datos ni rotar contraseñas; el script de inicio completa las credenciales nuevas ausentes. La salud verifica PostgreSQL y las métricas/logs describen solicitudes y movimientos; los contadores de operaciones resueltas incluyen replays, no movimientos únicos.

## Alternativas y consecuencias

Conservar solo lectura no permite recibir entregas ni informar stock propio. Dejar todas las existencias en FAV fue descartado por el equipo al confirmar que Tienda registra el stock del gimnasio. Incorporar esa responsabilidad en Socios mezclaría inventario con membresías.

La persistencia local no es una copia del stock externo: es un inventario distinto, con movimientos propios. Autenticación técnica, atomicidad, deduplicación y ventas están implementadas localmente; comparten la disponibilidad física de la instancia PostgreSQL. El catálogo/stock externo continúa requiriendo contrato y adaptación por separado; no se inventa el contrato del proveedor.

`GET /api/v1/tienda/productos` consume el catálogo de FAV y lo combina con el stock consignado local. `npm run test:tienda` verifica HTTP y PostgreSQL reales con dos instancias, concurrencia, reinicio, rollback y caída de almacenamiento. [EVIDENCIA-TIENDA](../EVIDENCIA-TIENDA.md) conserva los resultados de esos ensayos y del recorrido principal con FAV verificado en Azure. Los criterios y el orden de implementación están en el [plan de cierre](../PLAN-ENTREGA-3.md).
