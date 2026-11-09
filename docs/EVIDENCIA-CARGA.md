# Evidencia: test de carga con k6 (D13)

**Fecha:** 09/11/2026. **Herramienta:** k6 0.55.0 en Docker, dentro de la red del compose, contra el gateway NGINX. Ejercita el sistema completo: JWT validado en el gateway, rate limiting, balanceo entre 2 réplicas de Clases y PostgreSQL.
**Script:** [`tests/carga/flujo-principal.k6.js`](../tests/carga/flujo-principal.k6.js). **Resultados crudos:** [`docs/evidence/carga-k6/`](evidence/carga-k6/).

## Qué se mide

El flujo principal de un socio:
- Búsqueda de clases (`GET /api/v1/catalogo/clases` con texto, filtro de cupo, orden y paginación) en todos los recorridos.
- Reserva (`POST /api/v1/reservas`, la operación crítica con control de cupo) en uno de cada cinco recorridos.

Criterios:
- **Respuestas esperadas:** 200 y 201, más 409, que es un resultado de negocio esperado (clase llena o reserva repetida).
- **Objetivo de servicio:**
  - p95 de búsqueda < 300 ms;
  - p95 de reserva < 500 ms;
  - menos de 1 % de fallas (5xx, errores de red, 401/429 del gateway).
- **Clientes:** cada usuario virtual usa una IP de cliente propia (`X-Forwarded-For`, aceptado solo desde la red interna). Así el límite por IP del gateway se aplica por cliente, como pasaría con socios reales.

Entorno: una sola PC (AMD Ryzen 7 7445HS, 12 hilos, 15,2 GiB) con Docker Desktop. El generador de carga comparte la máquina con el sistema, así que los números son una cota inferior.

## Resultados

| Perfil | Comando | Solicitudes HTTP/s | Fallas | Búsqueda p50 / p95 | Reserva p50 / p95 | ¿Cumple el objetivo? |
|---|---|---:|---:|---|---|---|
| Uso normal: rampa de 0 a 100 socios con pausas de 0,5–1,5 s | `npm run test:carga` | 55 | 0 % | 4,8 / 7,2 ms | 25 / 64 ms | Sí |
| Tasa fija de 250 recorridos/s | `npm run test:carga -- tasa 250` | 300 | 0 % | 4,1 / 10 ms | 14 / 571 ms | Búsqueda sí; reserva al límite |
| Tasa fija de 400 recorridos/s | `npm run test:carga -- tasa 400` | 479 | 0 % | 4,8 / 49 ms | 19 / 452 ms | Sí |
| Estrés: rampa de 50 a 1200 recorridos/s (antes de la corrección) | `npm run test:carga -- estres` | 602 | **17,3 %** | 24 / 338 ms | 51 / 847 ms | No |
| Estrés, después de la corrección del gateway | `npm run test:carga -- estres` | 483 sostenidos (600 VUs al máximo) | 0 % | 80 / 819 ms | 490 / 1820 ms | No: saturado, pero sin errores |

## Análisis

**Primer límite: configuración del gateway (corregido).** En el primer estrés, el 17 % de fallas eran 500 del propio NGINX, con el log `512 worker_connections are not enough`. Era el valor por defecto, y el gateway además abría una conexión nueva hacia cada servicio en cada solicitud. Se subió a `worker_connections 4096` y se agregó `keepalive 32` por upstream. Con eso el mismo estrés pasó a 0 % de fallas. El gateway nunca superó el 40 % de CPU.

**Límite principal actual: CPU de Clases y PostgreSQL.** Con la carga máxima, `docker stats` mostró ([muestras](evidence/carga-k6/docker-stats-estres.txt)):
- las dos réplicas de `clases-reservas` cerca del 100 % de CPU, que es un núcleo cada una porque Node.js corre en un solo hilo;
- PostgreSQL en 250–280 %, por las búsquedas de texto completo y los bloqueos `FOR UPDATE` de las reservas.

A partir de ~480 solicitudes/s la latencia crece (cola) en lugar de aparecer errores.

**Las reservas degradan antes que las búsquedas.** Compiten por las mismas 6 clases de demostración y se serializan con el bloqueo de fila. Esa es la garantía de consistencia del cupo (D4), y su costo es latencia bajo contención. Con más clases reales la contención se reparte.

**Capacidad declarada:** hasta ~480 solicitudes HTTP/s (400 recorridos/s) cumpliendo el objetivo, en esta máquina. El uso normal esperado de un gimnasio (decenas de socios simultáneos) está muy por debajo: 55 solicitudes/s con 100 socios activos.

## Alternativas de escalado (en orden)

1. **Más réplicas de Clases:** `deploy.replicas`. NGINX ya balancea con `least_conn` y Prometheus descubre las réplicas solo. Escala casi lineal mientras PostgreSQL tenga CPU libre.
2. **Más CPU para PostgreSQL**, o una réplica de lectura para el catálogo. La búsqueda es solo lectura y tolera unos segundos de retraso (D6).
3. **Caché del catálogo de clases** por pocos segundos, con el mismo patrón que la ocupación (D7). Solo si las mediciones lo justifican.

## Cómo repetirlo

```bash
npm run iniciar
npm run test:carga              # uso normal
npm run test:carga -- tasa 400  # capacidad en un punto
npm run test:carga -- estres    # saturación
```

Durante el ensayo, el tablero de Grafana (http://localhost:3001) muestra el reparto de solicitudes entre las dos réplicas, la tasa de errores y la latencia.
