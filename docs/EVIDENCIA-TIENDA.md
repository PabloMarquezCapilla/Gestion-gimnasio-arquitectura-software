# Tienda: implementación y verificación local

## Prueba conjunta en Azure del 10/11/2026

- En la versión desplegada `7b413fd`, el portal y Tienda respondieron por HTTPS. La consulta autenticada de catálogo devolvió `200`, `origen: FAV` y dos productos con stock consignado.
- La consulta de stock con la clave del gimnasio en Azure devolvió `200`. PostgreSQL registró dos reposiciones de `fav` y el equipo confirmó que ambas llegaron desde el sistema de FAV.
- El gateway registró `201` para una compra del socio en el portal desplegado. Los ensayos de idempotencia, concurrencia y fallos se documentan por separado.

[Contrato de consignaciones](contracts/fav-tienda.md) · [Portal de Azure](https://gimnasio.68-211-88-90.sslip.io/)

## Revisión de conexión externa del 10/11/2026

- API de FAV en `https://fav-ucc.chilecentral.cloudapp.azure.com`. La primera credencial recibió `401 NO_AUTENTICADO`. Con la credencial renovada, `GET /v1/productos` devolvió `200` con JSON y el cliente de Tienda validó 5 productos y 19 variantes.
- En la verificación autenticada reportada por el equipo, `GET /v1/disponibilidad` también devolvió `200` para diez variantes. Ambas respuestas validaron contra OpenAPI 1.2.0. El `401` inicial en la consulta de consignaciones se resolvió usando la clave de la VM.
- En `development` `ff8ae75fb93cb31c0b597a36d18598890980fdf9`, el contrato 1.2.0 mantiene idénticos el esquema y las respuestas del catálogo respecto de la copia 1.1.0 de Tienda. Se conserva el cliente actual. Su adaptador de reposiciones ya exige `201`, `RECIBIDA` y UUID válido y distingue configuración, conflictos e incertidumbre.
- `npm run build --workspace=@gimnasio/tienda` y las 27 pruebas de `services/tienda/test/*.test.mjs` aprobadas. Cubren contrato, autorización, compras, idempotencia, caché degradada y circuit breaker mediante servidores locales. Esta revisión no volvió a ejecutar las pruebas PostgreSQL descritas abajo.
- Se configuró el catálogo en el `.env` local y se levantó Docker Compose. Con una cuenta de demostración, el gateway local respondió `200` en `GET /api/v1/tienda/productos` con `origen: FAV` y `total: 0`. La consulta de consignaciones también devolvió `200` con stock vacío. Las consultas verificaron el flujo sin registrar movimientos.
- En Azure, el portal y `/health` respondieron `200` por HTTPS. La consulta de consignaciones sin credencial respondió `401`. [Coordinación y contrato](contracts/fav-tienda.md).

## Evidencia de la implementación inicial

**Fecha:** 06/11/2026. **Base del trabajo:** `main` en `b6e34dd`; rama `feat/integracion-tienda-proveedor`.
**Enunciado:** §2.1–2.2, página 2; §2.8/2.11, página 3; §3, página 4; §4.1, páginas 5–6; D3/D4/D8, páginas 6–7. Se verifica este paso, no la entrega final completa.

## Capacidad implementada

Tienda mantiene Capas: HTTP/autenticación → servicio de comandos → repositorio PostgreSQL. Administra una única tienda del gimnasio, sin stock por sede ni cobros desde la plataforma. El catálogo de la distribuidora es distinto y su consumo sigue pendiente.

| Operación | Identidad y garantía |
|---|---|
| Consulta de stock de FAV | `GET /api/v1/consignaciones/stock?proveedorId=fav`, clave técnica. |
| Recepción de una variante | `POST /api/v1/consignaciones/reposiciones`, clave técnica e Idempotency-Key; entrega/stock/resultado atómicos. |
| Consulta administrativa | `GET /api/v1/tienda/stock`, JWT ADMIN. |
| Registro de venta realizada | `POST /api/v1/tienda/ventas`, JWT ADMIN e Idempotency-Key; nunca stock negativo. |

[OpenAPI FAV 1.0.0](contracts/openapi-fav-v1.yaml), [guía y operaciones internas](contracts/fav-tienda.md), [ADR-022](adr/ADR-022-tienda-y-consignaciones-fav.md).

## Datos, concurrencia y recuperación

PostgreSQL 17, base/usuario `tienda` independientes dentro de la instancia existente. Tablas: `tienda_stock`, `tienda_reposiciones`, `tienda_ventas` y `tienda_operaciones`. El inicializador crea lo faltante sin borrar registros ni rotar contraseñas. `npm run iniciar` incorpora solamente las nuevas credenciales ausentes `TIENDA_DB_PASSWORD` y `FAV_API_KEY`.

Las transacciones bloquean la identidad de operación, la referencia de entrega y la variante según corresponda, sin llamadas de red bajo bloqueo. Una referencia y contenido iguales reconocen la entrega también con otra clave; esa nueva clave queda vinculada al resultado original. El replay ocurre antes de volver a modificar stock, aunque después haya ventas. Las ventas se diferencian por administrador/clave.

Los identificadores opacos se almacenan como cadenas JSON con índices digest de tamaño fijo y comparación del valor completo, preservando longitud, Unicode y caracteres escapados. No se impone un límite comercial de veinte unidades. Se rechazan cantidades no enteras/positivas o fuera del rango seguro y saldos no representables. El JSON HTTP tiene límite de transporte de 1 MiB, documentado como 413.

El panel conserva una operación incierta por administrador en sessionStorage, sin JWT. Recarga y nuevo login permiten recuperar su recibo usando los mismos datos. Una respuesta de una vista desmontada no puede borrar otra venta: comprueba vigencia de instancia e identidad de la operación antes de retirar el registro. El recibo confirmado se conserva visualmente si falla el refresco del stock.

## Verificaciones ejecutadas

Entorno: Windows, Node **22.18.0**, Docker Desktop, PostgreSQL **17.11**, NGINX **1.28** y Chrome. Bases, cuentas, variantes y claves de todos los ensayos son sintéticas y temporales; no se leyó `.env` del grupo para probar ni se invocó FAV.

| Verificación | Resultado |
|---|---|
| `npm test -- --test-reporter=tap` | **209 aprobadas**, 0 fallos y 0 omitidas; compila los cuatro servicios. |
| `npm run test:frontend` | **40 aprobadas**, incluidas respuestas tardías que no borran otra venta. Forman parte de la regresión anterior. |
| `npm run frontend:build` | TypeScript/Vite aprobados, 36 módulos. |
| `node --test scripts/verificar-tienda.mjs` | **18 aprobadas**: 17 escenarios y su contenedor lógico, con HTTP/PostgreSQL reales y dos instancias. |
| `node scripts/verificar-balanceo.mjs` | Compose/NGINX aislado aprobado: base/rol de Tienda, credenciales separadas, reposiciones/ventas/replays y balanceo de Clases. |
| Navegador con fixture y PostgreSQL real | Respuesta perdida después del commit, recarga/login y reintento: dos intentos HTTP, una venta persistida. |

Las suites se describen por separado; no se suman como si todas sus pruebas fueran independientes.

### Escenarios HTTP y PostgreSQL

- Clave FAV y JWT ADMIN separados; SOCIO no vende ni consulta stock administrativo. Autenticación anterior al parseo de JSON.
- Stock vacío real, tipos de contenido, cantidades/campos inválidos y JSON mayor a 1 MiB, sin crear movimientos.
- Entrega de 21 unidades, replay de clave/cuerpo y replay por referencia con otra clave; los conflictos no alteran el inventario.
- Varias claves para una entrega, entregas distintas de una variante y competencia de ventas por la última unidad, desde dos pools.
- Ventas y reposiciones simultáneas: disponibles = entradas − ventas aceptadas, sin saldos negativos.
- Fallo provocado con trigger antes del registro idempotente: rollback de stock, movimiento y resultado; el mismo comando puede reintentarse después.
- Límites de entero seguro, identificadores largos/Unicode, reinicio de aplicación y caída de PostgreSQL: error explícito, sin fabricar una lista vacía.

### Gateway y balanceo

Por NGINX, una reposición de 21 unidades y sus repeticiones, más una venta de 2 y su repetición, dejaron **19 disponibles y 2 vendidas**. El ensayo usó un administrador de su base temporal y comprobó que la clave de otro contrato no autoriza FAV y SOCIO no accede al stock administrativo.

La regresión de Clases distribuyó 40 solicitudes entre dos réplicas, 20/20; hubo cuatro 504 transitorios al detectar una réplica detenida. Se verificaron 40 respuestas correctas con la superviviente y otras 40 distribuidas tras reemplazarla, sin reiniciar NGINX. No se afirma una transición sin errores ni disponibilidad garantizada. Los recursos del proyecto temporal fueron retirados al terminar.

### Interfaz y resultado incierto

`scripts/tienda/web.mjs` sirve el frontend compilado y el backend de Tienda con su PostgreSQL exclusivo. Solo el login es sintético y no acredita el servicio real de identidad; ese recorrido completo se comprueba por NGINX en el ensayo anterior.

Se recibieron 5 unidades ficticias y se registró una venta de 2. El proxy del fixture perdió deliberadamente la primera respuesta **después** de recibir el 201 del backend. La pantalla informó error y conservó la venta. Tras recargar, ingresar y reintentar, mostró el recibo original y stock **3/2**. El estado del fixture comprobó dos solicitudes con idéntica clave/cuerpo/ventaId y una sola venta en PostgreSQL. Pestaña y recursos temporales cerrados.

## Reproducción y límites

```powershell
npm test
npm run frontend:build
npm run test:tienda
npm run test:balanceo
```

Los ensayos reales requieren Docker y verifican la identidad de sus recursos antes de retirarlos. Para repetir la prueba visual, ejecutar `node scripts/tienda/web.mjs`: imprime una URL y cuenta exclusivas del fixture, prepara 5 unidades y pierde la primera respuesta exitosa de venta. Recargar/login/reintentar conserva la entrega; Ctrl+C cierra el fixture y su base temporal. Ese proceso no es un modo de despliegue del gimnasio.

En esta etapa inicial se verificó el contrato de consignaciones localmente. FAV es responsable de enviar el `varianteId` correspondiente a la prenda recibida. Las compras y el consumo del catálogo se incorporaron después, según [ADR-023](adr/ADR-023-compra-de-socios-en-tienda.md).

La instancia PostgreSQL compartida continúa siendo un punto de falla. JWT se valida localmente hasta vencer, sin revocación inmediata. No se purga automáticamente el historial/idempotencia. Las métricas de operaciones resueltas incluyen repeticiones y no representan ventas únicas. El tablero global y la prueba de carga se incorporaron posteriormente y se documentan en [D11](adr/ADR-011-observabilidad.md) y [EVIDENCIA-CARGA](EVIDENCIA-CARGA.md).
