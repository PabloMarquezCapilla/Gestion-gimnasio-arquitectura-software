# Compra de socios en Tienda con catálogo de FAV

**Estado:** aceptada e implementada; verificada localmente con PostgreSQL real, dos instancias y mock del contrato de FAV. El catálogo real y una compra exitosa por el gateway se verificaron en Azure. [Evidencia conjunta](../EVIDENCIA-TIENDA.md#prueba-conjunta-en-azure-del-10112026).
**Fecha:** 09/11/2026.
**Reemplaza parcialmente:** [ADR-022](ADR-022-tienda-y-consignaciones-fav.md) y [ADR-009](ADR-009-consumo-del-proveedor.md) en la regla "no hay compras del socio en esta versión". El resto de ambos sigue vigente.
**Enunciado:** §4.1 (capacidad del proveedor incorporada a un flujo importante del consumidor y comportamiento ante fallas), §2.5 (timeouts y errores), presentación grupal, páginas 8–9.

## Contexto

La capacidad de FAV tiene que formar parte de un flujo con consecuencias para el negocio, no quedar como una consulta aislada. Hasta ahora Tienda devolvía `503 INTEGRACION_PENDIENTE` y solo el ADMIN registraba ventas de mostrador.

FAV publicó la versión 1.1.0 de su contrato (`catalogo-pedidos`, commit `b9cb3e4` de `development`). Incluye `GET /v1/productos` con variantes y precio vigente, y `GET /v1/disponibilidad`. Su `POST /v1/pedidos` no está habilitado para la clave del gimnasio. La copia fijada está en `docs/contracts/fav-catalogo-pedidos-1.1.0.openapi.yaml`.

## Decisión

1. **Catálogo de Tienda:** Tienda consume `GET /v1/productos` desde su backend; el frontend no llama a FAV. El catálogo se cruza con el stock consignado local y solo muestra las variantes que tienen unidades en el gimnasio. No se usa `/v1/disponibilidad`: mide el stock online de FAV, no el de la tienda física.
2. **Compra del socio:** `POST /api/v1/tienda/compras` (solo rol SOCIO).
   - El cuerpo trae únicamente variantes y unidades. El precio sale del catálogo en el servidor, en centavos (`precio × 100`, redondeado).
   - Todo o nada: una transacción bloquea las filas de stock en orden de hash, valida y descuenta.
   - La compra queda `REGISTRADA`; se paga y se retira en el mostrador. No hay pasarela de pago.
   - `GET /api/v1/tienda/compras` lista las compras del socio.
3. **Idempotencia:** `Idempotency-Key` por socio, en la tabla `tienda_compras` con `UNIQUE (socio_hash, clave_hash)`.
   - Primero se busca una compra previa con esa clave, antes de cotizar. Así un reintento responde aunque FAV esté caído.
   - Misma clave con otro contenido devuelve `409 CLAVE_REUTILIZADA`.
   - Se usó una tabla propia en lugar de `tienda_operaciones`: los CHECK de esa tabla solo admiten REPOSICION/VENTA, y modificarlos requeriría una migración sobre datos existentes.
4. **Contrato propio para el portal:** `docs/contracts/openapi-tienda-socios-v1.yaml` 1.0.0.
5. **Lo que ve el usuario cuando FAV falla:**
   - Si hay una copia del catálogo de hasta 15 minutos: catálogo con `origen: CACHE_DEGRADADA` y un aviso "precios pueden haber cambiado". El portal puede mostrar esa copia. Una compra nueva debe consultar a FAV para cotizar.
   - Si no hay copia: `503 PROVEEDOR_NO_DISPONIBLE` con un mensaje claro, sin catálogo vacío inventado. Las compras nuevas se rechazan; los reintentos de compras ya registradas siguen respondiendo.
   - Contrato roto o credencial rechazada: `502` (no reintentable), sin abrir el circuito.

## Alternativas descartadas

- **Reenviar cada compra a `POST /v1/pedidos` de FAV:** FAV declara que la clave del gimnasio no habilita esa operación, y esos pedidos son compras del grupo para sí mismo, pagadas por transferencia. La mercadería ya está consignada en el gimnasio.
- **Precio enviado por el cliente:** permitiría manipular el total.
- **Llamar a FAV desde el frontend:** lo prohíbe §4.1.

## Consecuencias

- Las compras impactan en `unidadesVendidas`, que FAV ve en `GET /api/v1/consignaciones/stock`. Se cierra el circuito consignación → venta → reposición.
- El total queda fijado con el precio que FAV devuelve al cotizar la compra. Un reintento idempotente devuelve el resultado registrado.
- No hay cancelación, devolución ni marca de "pagada/retirada" en esta versión.
- `/health` de Tienda no depende de FAV, para que una caída del proveedor no saque instancias del balanceo.
