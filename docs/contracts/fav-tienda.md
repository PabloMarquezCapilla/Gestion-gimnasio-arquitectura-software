# Integración con FAV: stock y reposiciones del gimnasio

**Contrato:** [OpenAPI FAV 1.0.0](openapi-fav-v1.yaml), también navegable en Swagger UI en `/docs/` del gateway ([Azure](https://gimnasio.68-211-88-90.sslip.io/docs/)). **Responsable:** microservicio Tienda del gimnasio.

**Estado al 10/11/2026.** Tienda consulta el catálogo real de FAV desde Azure. El portal mostró dos productos con stock consignado, se registraron dos reposiciones enviadas por FAV y el gateway registró una compra exitosa. [Evidencia](../EVIDENCIA-TIENDA.md#prueba-conjunta-en-azure-del-10112026).

**Enunciado:** §3, página 4 (documentación); §4.1, páginas 5–6 (contrato formal, integración y pruebas); §5 D8/D9, página 7 (capacidad ofrecida y consumo del proveedor). Decisión: [ADR-022](../adr/ADR-022-tienda-y-consignaciones-fav.md).

## Responsabilidades y reglas

### Revisión de la rama externa del 10/11/2026

Se revisó `development` en `ff8ae75fb93cb31c0b597a36d18598890980fdf9`. FAV publica el contrato 1.2.0 con su URL de Azure. El esquema y las respuestas de `GET /v1/productos`, incluidos `Catalogo`, `Producto` y `Variante`, coinciden con la copia 1.1.0 fijada por Tienda. Se conserva esa copia y el cliente existente. La disponibilidad online de FAV continúa separada del stock consignado del gimnasio. [Contrato de FAV](https://github.com/JuanHernandez-99/Fav-del-universo/blob/ff8ae75fb93cb31c0b597a36d18598890980fdf9/docs/contracts/catalogo-pedidos-v1.openapi.yaml).

La URL comunicada por FAV es `https://fav-ucc.chilecentral.cloudapp.azure.com`. Con la credencial renovada, `GET /v1/productos` respondió `200` y el cliente de Tienda validó 5 productos y 19 variantes. [Resultados de la verificación](../EVIDENCIA-TIENDA.md#revisión-de-conexión-externa-del-10112026).

FAV conserva su catálogo, variantes y existencias de la distribuidora. Tienda administra el stock físico recibido en el gimnasio: **una única tienda, sin separación por sede**, en su base PostgreSQL `tienda` con usuario propio. Los servicios se comunican por API; ninguno consulta bases de datos ajenas.

- `productoCodigo` identifica exactamente una **variante de FAV** (`varianteId`), incluyendo talle y color; no es el identificador del producto general.
- FAV consulta las existencias del gimnasio y registra cada reposición con una referencia propia de entrega.
- El administrador del gimnasio registrará las unidades vendidas mediante una función interna. Esta guía no publica una operación de ventas para FAV.
- `unidadesDisponibles` es el total recibido menos el total vendido; nunca puede ser negativo.
- `unidadesVendidas` es el acumulado histórico de ventas de esa variante, sin reiniciarse por reposición.
- Devoluciones y ajustes quedan fuera de esta versión. No existe un límite comercial de 20 unidades por reposición.

## Acceso y operaciones

FAV envía una credencial de aplicación en `X-API-Key`, configurada en el gimnasio como `FAV_API_KEY`. El receptor comprueba esa credencial y `proveedorId=fav`. **El JWT de los usuarios del gimnasio no autoriza estas operaciones.** La clave se intercambia por canal privado y no se publica en el repositorio ni en el navegador del gimnasio.

Las respuestas llevan `Cache-Control: no-store`. Para probar contra Azure, configurá `{{gimnasioBaseUrl}}` con la [URL pública del gimnasio](https://gimnasio.68-211-88-90.sslip.io/).

Para probar en el equipo que inicia el gimnasio con `npm run iniciar`, usar `http://localhost:8080` como variable base (o el `GATEWAY_PORT` configurado). El inicio incorpora `TIENDA_DB_PASSWORD` y `FAV_API_KEY` ausentes sin cambiar claves existentes, y crea base/usuario faltantes sin borrar volúmenes. `localhost` no es una dirección compartida entre equipos. Esta API no necesita que el catálogo de FAV esté disponible para recibir sus entregas.

| Método y ruta | Resultado |
|---|---|
| `GET /api/v1/consignaciones/stock?proveedorId=fav` | `200`: stock disponible y vendido de las variantes recibidas. |
| `POST /api/v1/consignaciones/reposiciones` | `201`: reposición registrada o repetición del resultado original. |

### Consultar el stock

En Postman: método **GET**, URL `{{gimnasioBaseUrl}}/api/v1/consignaciones/stock?proveedorId=fav`, encabezado `X-API-Key: {{favApiKey}}`, sin cuerpo.

```json
{
  "proveedorId": "fav",
  "items": [
    { "productoCodigo": "var-remera-basica-blanca-m", "unidadesDisponibles": 3, "unidadesVendidas": 2 }
  ]
}
```

La respuesta incluye variantes recibidas aunque su disponibilidad sea cero. `items: []` significa que no se registró ninguna recepción; un fallo del servicio se comunica como error, sin fabricar una lista vacía.

### Registrar una reposición

En Postman: método **POST**, URL `{{gimnasioBaseUrl}}/api/v1/consignaciones/reposiciones`. Encabezados: `Content-Type: application/json`, `X-API-Key: {{favApiKey}}` e `Idempotency-Key: {{reposicionKey}}`. Cuerpo **raw → JSON**:

```json
{
  "proveedorId": "fav",
  "productoCodigo": "var-remera-basica-blanca-m",
  "unidades": 5,
  "referencia": "entrega-fav-0001"
}
```

`unidades` debe ser un entero positivo representable de forma segura en JSON, de 1 a `9007199254740991`. `referencia` identifica la entrega en FAV y es independiente de `Idempotency-Key`.

Respuesta `201` tanto al registrar como al repetir la misma entrega:

```json
{ "reposicionId": "41a759ec-67b5-45f0-9c16-16318663bd17", "estado": "RECIBIDA" }
```

Los valores de los ejemplos son ficticios. El receptor genera `reposicionId`; FAV no debe generarlo ni enviarlo.

## Idempotencia y recuperación

- Misma clave y mismos datos: se devuelve el mismo resultado, sin volver a sumar unidades.
- Otra clave con la misma referencia y datos: se reconoce la entrega existente y se devuelve el mismo ID y resultado.
- Reutilizar una clave o referencia con otros datos devuelve `409`; no modifica el stock.
- Registrar la reposición, sumar el stock y guardar el resultado repetible es una única transacción. La comprobación de claves/referencias está protegida frente a concurrencia y los resultados sobreviven al reinicio.

Ante pérdida de respuesta, timeout, fallo de red o `500`/`503`, conservar **la misma clave, referencia y cuerpo**. No crear otra entrega para resolver una respuesta incierta.

## Errores

Los errores usan JSON con `codigo` estable y `mensaje` explicativo. Las decisiones del cliente deben basarse en `codigo`, sin comparar el texto del mensaje.

| HTTP | `codigo` | Tratamiento |
|---|---|---|
| 400 | `SOLICITUD_INVALIDA` / `IDEMPOTENCIA_INVALIDA` | Corregir parámetros, cuerpo o clave conforme al OpenAPI. |
| 401 | `NO_AUTENTICADO` | Revisar la credencial; no asumir rechazo de mercadería. |
| 403 | `PROVEEDOR_NO_AUTORIZADO` | Revisar la identidad/permisos del proveedor. |
| 409 | `CLAVE_REUTILIZADA` / `REFERENCIA_REUTILIZADA` | Revisar el conflicto; no generar otra clave o referencia automáticamente. |
| 413 | `SOLICITUD_DEMASIADO_GRANDE` | El JSON excede 1 MiB. Es un límite de transporte, sin relación con la cantidad de unidades. |
| 415 | `TIPO_CONTENIDO_NO_ADMITIDO` | Enviar JSON con su tipo de contenido. |
| 422 | `STOCK_NO_REPRESENTABLE` | La suma excedería el rango entero seguro; revisar la entrega. No es un límite de 20 unidades. |
| 500 | `ERROR_INTERNO` | Resultado potencialmente incierto: recuperar con los mismos datos. |
| 503 | `SERVICIO_NO_DISPONIBLE` | Reintentar conservando los mismos datos. |

**Cliente de FAV.** Su adaptador distingue errores de configuración, conflictos, rechazos contractuales e incertidumbre. Para confirmar una reposición exige `201`, estado `RECIBIDA` y un UUID válido. Las redirecciones se evalúan sin seguirlas. [Cliente de FAV](https://github.com/JuanHernandez-99/Fav-del-universo/blob/ff8ae75fb93cb31c0b597a36d18598890980fdf9/services/inventario/internal/adaptadores/gimnasio/cliente.go).

## Verificación conjunta

El recorrido en Azure verificó el catálogo, la consulta de stock, la recepción de reposiciones de FAV y una compra. Los ensayos de repetición por clave y referencia, conflictos y recuperación ante fallos están registrados en la evidencia local. [EVIDENCIA-TIENDA](../EVIDENCIA-TIENDA.md).

## Operaciones internas del administrador

Estas rutas no se ofrecen a FAV. Exigen `Authorization: Bearer <JWT>` con rol ADMIN; la clave de FAV no sirve para usarlas. Como en Accesos, la autorización local reconoce el JWT hasta su vencimiento, sin revocación inmediata.

| Operación | Datos y respuesta |
|---|---|
| `GET /api/v1/tienda/stock` | Sin parámetros ni cuerpo; `200` con el mismo modelo de stock local descrito arriba. |
| `POST /api/v1/tienda/ventas` | JSON `{"productoCodigo":"var-remera-basica-blanca-m","unidades":2}` e `Idempotency-Key`. `201` con `{"ventaId":"<UUID>","estado":"REGISTRADA","productoCodigo":"var-remera-basica-blanca-m","unidades":2}`. |

La venta descuenta disponibles y suma vendidos, conserva actor/fecha y resultado en una transacción. La clave se diferencia por administrador: repetirla con el mismo cuerpo devuelve el recibo original, aunque el stock haya cambiado después. Otro cuerpo devuelve `409 CLAVE_REUTILIZADA`. No se admiten campos adicionales, precios, proveedor, actor o estado elegidos por el navegador.

La variante sin recepción produce `404 PRODUCTO_NO_ENCONTRADO`; unidades mayores a las disponibles producen `409 STOCK_INSUFICIENTE`, sin efectos. Cantidades inválidas dan `400 SOLICITUD_INVALIDA`; credencial ausente, `401`; rol SOCIO, `403 ACCESO_DENEGADO`. Se aplican también los errores técnicos y de transporte anteriores. Los rechazos no guardan un movimiento exitoso.

En **Tienda y stock**, ADMIN selecciona variante/unidades y confirma la venta realizada. El portal guarda la operación pendiente por administrador antes de enviarla, sin JWT; una respuesta incierta se recupera con la misma clave y cuerpo, incluso tras recarga y nuevo login. No borrar ese registro para iniciar otra venta. Una respuesta de una vista anterior no puede borrar una venta nueva. El panel solo informa unidades: no procesa cobros, devoluciones ni ajustes.

## Consumo del catálogo de FAV (gimnasio → FAV)

Tienda usa `GET /v1/productos` del [contrato FAV 1.2.0](fav-catalogo-pedidos-1.2.0.openapi.yaml). El verificador del contrato también consulta `GET /v1/disponibilidad`. Esa disponibilidad corresponde al stock online de FAV. El portal usa las unidades consignadas en el gimnasio.

| Variable | Uso |
|---|---|
| `FAV_CATALOGO_BASE_URL` | URL base que entrega FAV. Vacía: el catálogo responde `503 PROVEEDOR_NO_CONFIGURADO`. |
| `FAV_CATALOGO_API_KEY` | Clave del grupo, enviada en `X-API-Key`. Se entrega por canal privado y no se versiona. |
| `FAV_CATALOGO_TIMEOUT_MS` | Presupuesto total por consulta (por defecto 3000). |

**Flujo:**
1. El socio abre **Tienda** en el portal.
2. El portal llama a `GET /api/v1/tienda/productos` por el gateway.
3. Tienda consulta FAV, o su caché de 60 s.
4. Tienda cruza el resultado con el stock consignado y muestra solo las variantes con unidades.
5. El socio compra con `POST /api/v1/tienda/compras`: precio del servidor, descuento atómico y `Idempotency-Key`. Paga y retira en el mostrador.

Contrato del portal: [openapi-tienda-socios-v1.yaml](openapi-tienda-socios-v1.yaml).

**Errores y qué ve el socio:**

| Situación de FAV | Comportamiento |
|---|---|
| Responde bien | Catálogo con `origen: FAV`. |
| Caído, lento (más de 3 s) o con 429/5xx | Un reintento. Si falla, se muestra la última copia (hasta 15 min) con `origen: CACHE_DEGRADADA` y un aviso. Sin copia: `503 PROVEEDOR_NO_DISPONIBLE` y botón de reintento. |
| 3 fallos seguidos | Circuito ABIERTO durante 30 s: no se llama a FAV y se aplica la fila anterior ([ADR-024](../adr/ADR-024-circuit-breaker-fav.md)). |
| `401/403` | `502 FAV_CREDENCIAL_RECHAZADA`. No abre el circuito; revisar la clave. |
| Respuesta fuera de contrato | `502 FAV_RESPUESTA_INVALIDA`, detectada por el test de contrato y la validación Ajv en tiempo de ejecución. |

**Probar localmente:** `npm run mock:fav` levanta el mock en el puerto 8090, que sirve el ejemplo del contrato. Configurar `FAV_CATALOGO_BASE_URL=http://host.docker.internal:8090` y `FAV_CATALOGO_API_KEY=clave-fav-local`, y después `npm run iniciar`. Para simular fallas: `curl -X POST localhost:8090/__mock/modo -d '{"modo":"caido"}'` (también `lento`, `invalido` y `normal`).

**Tests:**
- `services/tienda/test/fav-catalogo-client.test.mjs`: test de contrato contra el OpenAPI fijado.
- `circuit-breaker.test.mjs` y `compras.test.mjs`.
- `scripts/verificar-compras-tienda.mjs`, con PostgreSQL real.
