# Postmortem - ensayo local de caída de una réplica

**Ensayo:** 19/10/2026, Argentina. **Informe:** 20/10/2026.
**Estado:** ensayo local completado; no corresponde a una caída de producción ni a la jornada conjunta con proveedor.
**Enunciado:** §2.9, página 3; §3, página 5; evidencia de fallas de la defensa individual, página 9.

## Contexto y reproducción

Se detuvo una de las dos réplicas de Clases y Reservas en un entorno Docker Compose temporal, con NGINX, PostgreSQL y datos ficticios. El ensayo utilizó las imágenes del proyecto, recursos propios y un puerto exclusivo; no cargó el `.env` ni utilizó los volúmenes del grupo.

```sh
npm run test:balanceo
```

El script verifica la configuración de NGINX, distribución, concurrencia sobre un cupo, detención, operación con una réplica y reemplazo sin reiniciar gateway. Imprime el informe JSON y retira sus recursos al terminar. Configuración y límites en [D12](adr/ADR-012-balanceo-de-carga.md).

## Impacto observado

Durante la ventana de detección posterior a la parada, 4 de 24 lecturas recibieron HTTP 504 y 20 recibieron 200. Después se completaron 40 de 40 lecturas con la réplica superviviente. La reserva confirmada se conservó; no se observó sobrecupo ni duplicación en el escenario probado.

El impacto se limita a solicitudes y datos ficticios del ensayo. No demuestra disponibilidad mensual ni recuperación frente a caída del gateway o de la base.

## Secuencia del ensayo

| Fase | Evidencia observada |
|---|---|
| Inicio | Configuración NGINX válida; dos réplicas disponibles. |
| Operación normal | 40 GET: 40 respuestas 200, reparto 19/21 entre las instancias. |
| Escrituras concurrentes | 12 intentos sobre un cupo: una confirmación 201 y once conflictos 409. |
| Orden de detención con lecturas en curso | 24 GET: 24 respuestas 200, reparto 12/12. |
| Detección después de la parada | 24 GET: veinte 200 y cuatro 504; tiempo de detección **más muestreo** de 3308 ms. |
| Operación estable con una réplica | 40 GET: 40 respuestas 200 desde la superviviente; reserva conservada. |
| Reemplazo | Se retiró el contenedor detenido y se inició uno nuevo; gateway con mismo proceso y hora de inicio. |
| Recuperación | 40 GET: 40 respuestas 200, reparto 20/20 entre superviviente y nueva instancia. |
| Cierre | Se verificaron 170 registros del proxy y se retiraron los recursos exclusivos del ensayo. |

El informe final se emitió el 20/10/2026 a las 02:13:03 UTC (19/10, 23:13:03 en Argentina). No se conservaron marcas absolutas por cada fase; no se inventa una cronología más precisa. Tampoco hubo una muestra intermedia durante la reincorporación; la recuperación se acredita con las 40 consultas posteriores.

## Detección y causa

La causa provocada fue la detención de una réplica por el script. NGINX utiliza resolución DNS dinámica (`valid=5s`) y reconocimiento pasivo por errores (`max_fails=3`, `fail_timeout=10s`). Compose muestra salud e interviene en el arranque; no instala una sonda HTTP activa de NGINX.

Los 504 transitorios son compatibles con el intervalo en que el proxy todavía intenta utilizar un destino detenido, antes de actualizar su selección por DNS/errores. Esto es una interpretación de la configuración y el resultado observado; no se midió por separado cuánto aportó cada mecanismo a la detección.

## Respuesta y recuperación

La réplica disponible atendió la muestra estable. El script reemplazó la detenida y verificó tráfico hacia el nuevo contenedor sin reiniciar NGINX. El estado de reserva persistido y los JWT no dependían de una instancia HTTP concreta. No se observaron reintentos del proxy en este ensayo; no se atribuye la recuperación a un mecanismo que no quedó registrado.

## Ensayo complementario de Socios

`npm run test:postgres` detiene el servidor HTTP de Socios durante una cancelación con espera pendiente, manteniendo las bases. La cancelación se acepta, el primer candidato se conserva y otra solicitud no puede adelantarse. Al reabrir Socios y ejecutar los trabajadores de ambas instancias, se promueve al primero sin duplicarlo. No se midieron tiempos de recuperación ni percentiles de ese escenario. La política se justifica en [D4](adr/ADR-017-consistencia-y-recuperacion-de-espera.md) y [D10](adr/ADR-010-resiliencia.md).

## Acciones y límites pendientes (ensayo de réplica)

- Medir por separado resolución DNS, fallos pasivos y latencia durante detección antes de ajustar umbrales; no se promete cero errores.
- ~~Incorporar tableros/alertas~~: hecho el 09/11/2026 (Prometheus, Grafana y la alerta `InstanciaCaida`; ver [D11](adr/ADR-011-observabilidad.md)).
- ~~Ensayar caída/lentitud del proveedor~~: hecho el 09/11/2026, en la sección siguiente.
- ~~Carga sostenida~~: hecho el 09/11/2026 ([EVIDENCIA-CARGA](EVIDENCIA-CARGA.md)).

---

# Postmortem - caída y lentitud provocadas del proveedor FAV

**Ensayo:** 09/11/2026, Argentina. **Informe:** 09/11/2026.
**Estado:** ensayo local completado con el sistema completo en Docker Compose, el mock del contrato de FAV 1.1.0, Prometheus y Grafana. No es la jornada conjunta con el FAV real: la falla se inyectó en el mock.
**Enunciado:** §2.8 (caída provocada en POSTMORTEM), §4.2 (qué ve el usuario cuando el proveedor falla), defensa individual (simulación de caída del proveedor externo).

## Reproducción

```bash
npm run mock:fav
```

```bash
FAV_CATALOGO_BASE_URL=http://host.docker.internal:8090 FAV_CATALOGO_API_KEY=clave-fav-local npm run iniciar
```

```bash
npm run simulacro:fav
```

El script cambia el modo del mock (`normal`, `caido` y `lento`) y consulta el portal por el gateway con la sesión de un socio de prueba. Registra métricas de Tienda y alertas de Prometheus, y guarda la línea temporal en [`docs/evidence/simulacro-fav/linea-temporal.json`](evidence/simulacro-fav/linea-temporal.json). El tablero **Gimnasio · Estado general** de Grafana muestra en vivo el circuito, el origen del catálogo y las alertas.

## Impacto observado

- **Con copia del catálogo (hasta 15 min):** el socio siguió viendo el catálogo con el aviso "FAV no responde, mostramos el catálogo de las HH:MM", y pudo comprar. La compra se registró con el precio de la copia y su reintento devolvió el mismo resultado sin duplicar.
- **Sin copia válida** (Tienda reiniciada mientras FAV seguía caído): el catálogo y las compras nuevas respondieron `503 PROVEEDOR_NO_DISPONIBLE` con un mensaje claro y botón de reintento. No se mostró un catálogo vacío inventado.
- **FAV lento** (5 s por respuesta): la solicitud se cortó a los 3,0 s (presupuesto del cliente) en lugar de quedar colgada.
- **Lo que no se vio afectado:** clases, reservas, membresías y accesos funcionaron sin cambios. La consignación (FAV → gimnasio) no depende del catálogo. `/health/tienda` siguió en 200, así que la instancia no salió del balanceo.

## Línea temporal

| t | Fase | Observado |
|---:|---|---|
| +0,2 s | FAV normal | Catálogo 200, `origen: FAV`, circuito CERRADO. |
| +0,2 s | **Inyección:** FAV responde 503 | Dentro del TTL de 60 s el catálogo sigue saliendo de la caché fresca (5 ms). |
| +65,3 s | Vence la caché | 3 intentos: 200 con `origen: CACHE_DEGRADADA` (~130 ms cada uno: reintento hacia FAV, falla y respuesta desde la copia). |
| +65,6 s | **Circuito ABIERTO** | Al cuarto intento ya no se llama a FAV (5 ms): `fallos +3`, `rechazos por circuito +1`. |
| +65,8 s | Compra durante la caída | 201 REGISTRADA ($15.000); el reintento con la misma clave devuelve 201 sin duplicar. |
| +90,9 s | **Detección** | Prometheus dispara `CircuitoFavAbierto` y `CatalogoFavDegradado`, 25 s después de abrirse el circuito (un scrape de 10 s más una evaluación de 10 s). |
| +98,2 s | Tienda reiniciada sin copia | Catálogo y compra nueva: 503 `PROVEEDOR_NO_DISPONIBLE` (~150 ms). |
| +98,3 s | **Inyección:** FAV lento (5 s) | Catálogo 503 en 3011 ms: timeout del cliente. |
| +132,3 s | **Recuperación:** FAV normal | — |
| +163,3 s | Prueba semiabierta | Catálogo 200 `origen: FAV` y circuito CERRADO. |
| +188,4 s | Después de la recuperación | `CircuitoFavAbierto` resuelta. `CatalogoFavDegradado` sigue activa hasta salir de su ventana de 5 min. `TasaDeErroresAlta` queda pendiente por los 503 y no llega a dispararse (exige 2 min). |

## Detección y causa

La causa fue provocada: el mock del contrato de FAV respondió 503, y luego tardó 5 s. La detección fue automática:
- **Métricas:** `tienda_fav_circuito_estado` y `tienda_catalogo_respuestas_total{origen="cache_degradada"}`.
- **Logs:** `warn` con `codigo: CIRCUITO_FAV` en cada cambio de estado y `CATALOGO_DEGRADADO` en cada respuesta degradada.
- **Alertas** de Prometheus visibles en el panel "Alertas activas".

## Respuesta y recuperación

No requirió intervención manual. El circuit breaker dejó de llamar a FAV durante 30 s, la caché degradada sostuvo el catálogo y, cuando FAV volvió, la primera prueba semiabierta cerró el circuito. Ver [ADR-024](adr/ADR-024-circuit-breaker-fav.md).

## Acciones

- **Caché y circuito por instancia:** con dos réplicas de Tienda cada una abriría su circuito por separado. Es aceptable con una réplica; revisar si se escala Tienda.
- **Reinicio durante la caída:** perder la copia del catálogo al reiniciar Tienda deja a los socios sin tienda hasta que FAV vuelva. Si eso pasa en la práctica, persistir la última copia válida en PostgreSQL.
- **Jornada conjunta:** repetir el ensayo con el FAV real cuando entreguen URL y clave.
