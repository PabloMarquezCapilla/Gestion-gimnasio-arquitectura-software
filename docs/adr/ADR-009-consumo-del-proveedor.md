# D9 - Consumo del proveedor

**Estado:** actualizado el 09/11/2026. El consumo del catálogo de FAV (contrato 1.1.0 fijado) está implementado, integrado a la compra de socios ([ADR-023](ADR-023-compra-de-socios-en-tienda.md)) y protegido con circuit breaker y caché degradada ([ADR-024](ADR-024-circuit-breaker-fav.md)). La regla "no hay compras del socio" de abajo quedó reemplazada por ADR-023. Conexión conjunta pendiente.
**Fecha inicial:** 12/10/2026. **Revisión:** 06/11/2026.
**Enunciado:** §4.1, páginas 5–6; §5 D9, página 7; §6.3, página 8.

## Contexto

La integración con [FAV](https://github.com/JuanHernandez-99/Fav-del-universo) mantiene la consulta de su catálogo y disponibilidad desde Tienda. El 06/11/2026 el equipo confirmó además que FAV maneja una tienda dentro del gimnasio: Tienda guarda las existencias locales, FAV las consulta y registra reposiciones, y ADMIN registra las unidades vendidas. Es una única tienda; no hay compras del socio, devoluciones ni ajustes en esta versión. [ADR-022](ADR-022-tienda-y-consignaciones-fav.md) reemplaza el límite anterior que excluía stock local y reposición.

La rama `feature-inventario` revisada anteriormente ya no existe. Se inspeccionaron `main` (`f8680fb281ac6072471cc239b4b88c1ab82f6c13`) y `development` (`adb9838023ddd5d4340f8bc7a95b38fdbc695845`) sin elegir unilateralmente una rama de integración. El [OpenAPI de catálogo/pedidos 1.0.0](https://github.com/JuanHernandez-99/Fav-del-universo/blob/adb9838023ddd5d4340f8bc7a95b38fdbc695845/docs/contracts/catalogo-pedidos-v1.openapi.yaml) describe catálogo pero no disponibilidad. En el [gateway de development](https://github.com/JuanHernandez-99/Fav-del-universo/blob/adb9838023ddd5d4340f8bc7a95b38fdbc695845/gateway/templates/default.conf.template) ya existe `GET /inventario/v1/disponibilidad?variantes=...`, pública y respaldada por Inventario. Falta confirmar rama, versionar esa consulta en el contrato externo y coordinar URL y credenciales. La presencia de código no acredita una conexión operativa.

## Decisión

**Tienda** iniciará la llamada externa y adaptará el contrato al modelo del gimnasio mediante un cliente dedicado (Adapter / capa de adaptación). Se mantiene la política de aislar tipos, errores y versiones del proveedor. El navegador llama a Tienda por nuestro gateway; la salida al proveedor parte directamente del microservicio.

El catálogo y las existencias de la distribuidora pertenecen a FAV. Tienda es propietario del stock físico del gimnasio y de sus movimientos, guardados en su base PostgreSQL 17; no es una copia de las existencias de la distribuidora. Una consulta externa fallida representa información desconocida y no permite mostrar stock cero o un catálogo vacío como resultado válido. [D1 vigente](ADR-022-tienda-y-consignaciones-fav.md).

La capacidad ofrecida en sentido contrario se documenta por separado en [OpenAPI FAV 1.0.0](../contracts/openapi-fav-v1.yaml) y [su guía](../contracts/fav-tienda.md): `GET /api/v1/consignaciones/stock` y `POST /api/v1/consignaciones/reposiciones`, con credencial del grupo e idempotencia de entregas. Esas rutas ya están implementadas y verificadas con HTTP/PostgreSQL locales; no se declara una conexión real con FAV. No sustituyen Car Cruds ni el contrato que necesitamos consumir de FAV.

### Parte propia implementada

- Workspace `services/tienda`, imagen/Compose y Capas: HTTP/autenticación en `app.ts`, reglas y puerto en `stock.ts`, adaptador PostgreSQL en `stock.postgres.ts` y composición en `server.ts`.
- API de FAV: consulta y reposición con `X-API-Key`; el POST exige `Idempotency-Key`, conserva entregas entre reinicios y rechaza reutilización incompatible de clave/referencia sin sumar stock.
- API interna y panel ADMIN: `GET /api/v1/tienda/stock` y `POST /api/v1/tienda/ventas`, con JWT, control de rol e idempotencia de ventas por actor. La interfaz conserva una respuesta incierta en sessionStorage sin guardar JWT ni volver a descontar existencias con otra clave.
- `GET /api/v1/tienda/productos` es una ruta del gimnasio con JWT. Responde `503` y `INTEGRACION_PENDIENTE`; no contiene productos ni invoca una API ficticia.
- `/health/tienda` comprueba PostgreSQL en el inicio operativo; no comprueba al proveedor ni acredita la prueba conjunta. Hay métricas HTTP/movimientos en `/metrics/tienda` y logs correlacionados.
- La pantalla distingue stock local, catálogo pendiente y error de comunicación; un 503 conserva la sesión y un 401 propio la invalida. [Evidencia local y límites](../EVIDENCIA-TIENDA.md).

### Adaptación y resiliencia pendientes

Al fijar el contrato externo que incluya disponibilidad se conectarán sus rutas, campos, filtros/paginación, validación de respuestas, traducción de errores, autenticación y test de contrato capaz de detectar incompatibilidades. Se conserva el diseño general de timeout, reintentos de lecturas seguras y degradación controlada; sus valores y mecanismos de protección deben verificarse al implementar. No se incorporan pedidos del contrato de FAV por el solo hecho de estar disponibles.

Los ejemplos anteriores de otros dominios (pagos, clima o biometría) eran hipótesis previas a la asignación; no pertenecen al alcance vigente. Los parámetros numéricos orientativos de esa propuesta no se presentan como políticas acordadas con la distribuidora.

La integración real debe incorporarse al flujo de consulta del socio y demostrar consecuencias de negocio según §4.1. Una pantalla de estado o llamada aislada no acredita ese requisito. La aceptación del flujo y el comportamiento ante caída del proveedor se verificarán con el contrato y en la prueba conjunta.

## Alternativas y consecuencias

Consumir desde el navegador expondría la integración al cliente y contradice §4.1; hacerlo desde nuestro gateway desplazaría una responsabilidad de negocio. Compartir bases con FAV confundiría los propietarios; la nueva persistencia local responde a movimientos físicos distintos y debe conservar esa separación.

El adaptador concentra cambios del proveedor, pero un cambio incompatible aún puede exigir revisar tipos y comportamiento propios; no se garantiza que baste con cambiar una URL. La capacidad ofrecida se verifica con `npm run test:tienda`; las pruebas locales no acreditan consumo externo, test de contrato del proveedor ni ensayo de su caída. La documentación de Car Cruds se mantiene separada en [D8 vigente](ADR-018-integracion-car-cruds.md).
