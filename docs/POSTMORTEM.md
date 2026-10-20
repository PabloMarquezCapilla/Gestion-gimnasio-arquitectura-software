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

## Acciones y límites pendientes

- Medir por separado resolución DNS, fallos pasivos y latencia durante detección antes de ajustar umbrales; no se promete cero errores.
- Incorporar tableros/alertas y contrastar el impacto con objetivos de servicio acordados. [D11](adr/ADR-011-observabilidad.md).
- Ensayar caída/lentitud del proveedor cuando exista contrato y registrar su efecto sobre el flujo real. La pantalla de integración pendiente no sustituye esa prueba.
- Extender pruebas a las dependencias de los flujos aún no implementados y a carga sostenida; no atribuir a esta muestra tolerancia del sistema completo.
