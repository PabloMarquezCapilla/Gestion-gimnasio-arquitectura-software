# D12 - Balanceo de carga

**Estado:** NGINX y least_conn conservados; distribución, caída y reemplazo comprobados. Resultado y límites en el postmortem.
**Fecha:** 12/10/2026; validación: 19/10/2026.

**Origen:** sección 2.3, página 2: al menos un servicio con dos o más instancias, reconocimiento de indisponibilidad y distribución/estado comprobables por observabilidad. D12 y su inclusión en E2 corresponden a las secciones 5 y 6.3; documentación actualizada según sección 3, página 4.

## Verificación reproducible

```sh
npm run test:balanceo
```

`scripts/verificar-balanceo.mjs` copia las fuentes a un directorio temporal, genera sus propias claves y un proyecto/puerto/imágenes/volúmenes exclusivos y construye el Compose del proyecto. No carga `.env` ni utiliza los datos o contenedores del grupo. Al terminar, incluso ante un fallo, retira únicamente sus propios recursos tras comprobar su identidad.

El ensayo realiza:

1. Verificación `nginx -t` y dos réplicas saludables de Clases.
2. Cuarenta GET por el gateway, usando `X-Instance-ID` para verificar que ambas reciben tráfico con PostgreSQL y sin `X-Mock`.
3. Doce solicitudes de reserva concurrentes para un único cupo: una confirma, once reciben conflicto. Se utiliza JWT real emitido por Socios; no hace falta una sesión ligada a una réplica.
4. Detención de una réplica temporal, consultas durante la orden y registro de la ventana de detección, incluidos todos los errores. Se exige una muestra estable de cuarenta lecturas atendidas por la superviviente dentro del presupuesto del ensayo (30 s), conservando la reserva.
5. Reemplazo de la instancia detenida, nuevas lecturas y comprobación de que ambas reciben tráfico sin reiniciar NGINX. También se registran las muestras durante la reincorporación.

El tiempo de detección informado incluye las consultas de muestreo; no es un SLO ni una medición de latencia pura. Los contadores y errores corresponden a ese ensayo local. El resultado completo se imprime en JSON, sin tokens ni claves. El resultado medido y su análisis se conservan en [POSTMORTEM](../POSTMORTEM.md).

## Evidencia observable

- **Réplicas:** `X-Instance-ID` en las consultas de Clases identifica el hostname del proceso que respondió.
- **Estado:** `/health/clases` consulta una instancia a través del gateway. `docker compose ps` muestra el estado de cada contenedor; una sola respuesta de salud del gateway no enumera todas las réplicas.
- **Gateway:** los logs JSON incluyen `upstream_addr`, `upstream_status` y `upstream_response_time`, además de ruta, código final y tiempo total. Una lista de upstreams/estados permite observar los intentos de una solicitud.
- **Límites:** las consultas son una muestra funcional; no acreditan capacidad máxima, percentiles, equidad exacta de reparto ni tolerancia a una caída del gateway o de la base compartida.

## Contexto

El sistema expone servicios que pueden escalar horizontalmente. Se necesita un punto de entrada que distribuya solicitudes, reconozca fallas de las instancias y permita comprobar qué ocurre durante su detención y recuperación. La detección requiere un intervalo observable; no se asume disponibilidad sin interrupciones.

## Decisión

Se conserva **NGINX 1.28** como gateway y balanceador HTTP, con **least_conn**, detección pasiva y resolución DNS dinámica. Compose sondea la salud de los procesos. La verificación utiliza esta configuración existente.

### 1. Servicio seleccionado y justificación

- **Tecnología:** NGINX 1.28 Alpine.
- **Motivos de selección:**
  - Ya centraliza el enrutamiento HTTP del proyecto y permite observar los destinos de cada petición.
  - Distribuye tráfico sin mantener la sesión en una instancia particular; los servicios verifican JWT y comparten su persistencia PostgreSQL.
  - Soporte nativo para resolución dinámica de nombres DNS en Docker (`resolver 127.0.0.11 valid=5s`), vital para entornos donde Docker puede recrear contenedores con nuevas direcciones IP sin reiniciar el balanceador.
  - Capacidad de enrutar selectivamente por prefijo de ruta (`/api/v1/clases`, `/api/v1/reservas`, `/api/v1/socios`, `/health`).

### 2. Estrategia de distribución de carga

Para los grupos de upstream de los microservicios:

```nginx
upstream clases_backend {
    zone clases_backend 64k;
    least_conn;
    server clases-reservas:3000 max_fails=3 fail_timeout=10s resolve;
}

upstream socios_backend {
    zone socios_backend 64k;
    least_conn;
    server socios-membresias:3000 max_fails=3 fail_timeout=10s resolve;
}
```

- **Algoritmo seleccionado: Least Connections (`least_conn`):**
  - *Funcionamiento:* Elige la instancia con menos conexiones activas; en empate utiliza reparto ponderado por turnos. [Documentación oficial](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#least_conn).
  - *Justificación frente a Round Robin:* Una consulta paginada de búsqueda o una transacción de reserva con validación remota toma más tiempo que una comprobación simple de salud. Round Robin reparte por turnos; `least_conn` usa las conexiones activas como aproximación a la carga. No mide CPU ni garantiza un reparto igual de solicitudes.

### 3. Verificación de disponibilidad (Health Checks)

Los dos mecanismos cumplen funciones diferentes:

1. **Monitoreo Pasivo continuo:**
   - Parámetros `max_fails=3 fail_timeout=10s` en cada backend.
   - Tres intentos fallidos dentro de 10 s permiten considerar indisponible ese servidor durante 10 s; cuentan los fallos definidos por `proxy_next_upstream`. No se requiere que sean consecutivos. [Parámetros de upstream](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server).
2. **Salud de contenedores en Compose:**
   - Endpoints dedicados de salud expuestos por cada microservicio (`/health` en cada proceso y mapeados a `/health/clases`, `/health/socios`, `/health/accesos` en el Gateway).
   - Docker Compose sondea estos endpoints cada 5 segundos. En Socios y Clases se consulta la conexión a PostgreSQL; Accesos y Tienda informan su estructura y no acreditan su integración de negocio.
   - Compose registra salud y coordina el inicio de dependencias. Esa marca no configura por sí sola la selección de peers de NGINX; el gateway usa los errores de upstream y su resolución DNS. Esta configuración no incluye un `health_check` activo de NGINX. [Healthcheck de Compose](https://docs.docker.com/reference/compose-file/services/#healthcheck), [upstreams de NGINX](https://nginx.org/en/docs/http/ngx_http_upstream_module.html).

### 4. Comportamiento ante la caída de una instancia

Para permitir otro intento ante fallas de comunicación, dentro de sus límites:

```nginx
proxy_next_upstream error timeout invalid_header http_502 http_503 http_504;
proxy_next_upstream_tries 3;
proxy_next_upstream_timeout 5s;
```

- Se permiten hasta tres intentos y un presupuesto de 5 s para pasar al siguiente upstream, según el estado de los peers. No se garantiza que toda solicitud pueda reintentarse: puede haber errores transitorios, y una respuesta ya enviada al cliente no puede reconstruirse.
- No se habilita `non_idempotent`: un POST ya enviado al backend no se repite automáticamente por esa opción. El consumidor de empleados conserva su `Idempotency-Key` si necesita reintentar un resultado incierto. [Semántica oficial de reintentos](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_next_upstream).
- El tiempo de conexión configurado es 3 s y la espera de lectura 10 s. El ensayo registra las fallas durante detección y reincorporación, y exige servicio estable desde la instancia disponible; no promete cero errores durante la transición.

## Consecuencias

- **Escalado previsto:** el número de réplicas puede cambiar mediante Compose y `resolve` permite actualizar direcciones. El ensayo comprueba dos instancias y el reemplazo de una; no prueba reparto sobre tres instancias ni un plazo instantáneo de incorporación.
- **Disponibilidad local limitada:** hay un solo gateway y bases compartidas. La redundancia de Clases no elimina esas dependencias; no se ha desplegado una solución multizona ni un balanceador gestionado en la nube.

Las garantías se limitan a las comprobaciones reproducibles: la detección pasiva y el DNS no aseguran ausencia de errores durante la transición. El [postmortem](../POSTMORTEM.md) registra el impacto observado y acciones pendientes.
