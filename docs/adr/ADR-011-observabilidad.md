# D11 - Observabilidad

**Estado:** primera versión decidida e implementada para la Entrega 2.  
**Fecha:** 12/10/2026.

## Contexto

En una arquitectura distribuida orientada a microservicios, depurar incidentes o auditar el flujo de negocio mediante logs planos no estructurados e independientes en cada contenedor resulta ineficiente e ineficaz. Para entender el estado interno del sistema a partir de sus salidas externas, se requiere una estrategia integral de observabilidad estructurada sobre los tres pilares fundamentales: **Logs estructurados**, **Métricas cuantitativas** y **Trazas distribuidas correlacionadas**, acompañados de objetivos de nivel de servicio (SLO) y reglas de alerta proactivas.

## Decisión

Se adopta una arquitectura de observabilidad estandarizada, basada en **Pino (Logs JSON estructurados)**, **W3C Trace Context (Trazabilidad distribuida)**, y el modelo de métricas **RED / USE (Prometheus + Grafana)**.

### 1. Estrategia de Logs Estructurados y Correlacionados

Todos los microservicios emiten logs exclusivamente a `stdout` en formato **JSON estructurado** utilizando el motor de logging de Fastify / Pino:

- **Campos estándar obligatorios en cada entrada de log:**
  - `time`: timestamp epoch en milisegundos.
  - `level`: severidad numérica estándar (10: trace, 20: debug, 30: info, 40: warn, 50: error, 60: fatal).
  - `service`: identificador unívoco del microservicio (`clases-reservas`, `socios-membresias`, `accesos-ocupacion`).
  - `trace_id`: identificador global de 32 caracteres hexadecimales de la transacción distribuida.
  - `span_id`: identificador de 16 caracteres hexadecimales de la operación actual dentro del servicio.
  - `parent_span_id`: identificador del span padre que originó la llamada (si aplica).
  - `msg`: mensaje descriptivo de la acción o evento.
  - `err`: objeto estructurado de error con stack trace y código (en niveles warn/error).

Ejemplo real emitido por el sistema en el flujo principal:
```json
{
  "level": 30,
  "time": 1791852487665,
  "service": "clases-reservas",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "span_id": "ec9c21c06067600c",
  "parent_span_id": "00f067aa0ba902b7",
  "claseId": "clase-demo-001",
  "socioId": "socio-demo-01",
  "msg": "Iniciando solicitud de reserva para clase"
}
```

### 2. Trazabilidad Distribuida (W3C Trace Context)

Para reconstruir el camino exacto de una petición a través del API Gateway, `Clases y Reservas` y `Socios y Membresías`:

1. **Recepción e Inyección:**
   - La cabecera estándar W3C `traceparent` (`00-<trace_id>-<span_id>-<flags>`) y la cabecera `X-Correlation-ID` son aceptadas en el Gateway y leídas en cada microservicio por el plugin transversal `tracing.ts`.
   - Si una solicitud externa carece de traza, el primer punto de contacto genera un nuevo `trace_id` criptográfico de 16 bytes (32 caracteres hexadecimales).
2. **Propagación Inter-Servicios:**
   - Al invocar a `Socios y Membresías`, el cliente HTTP genera un nuevo `span_id` hijo y reenvía `traceparent` y `X-Correlation-ID`.
   - Ambos servicios registran el mismo `trace_id` en sus logs, permitiendo correlacionar la llamada síncrona en milisegundos.
3. **Respuesta al Cliente:**
   - Todo endpoint HTTP inyecta `traceparent` y `X-Correlation-ID` en las cabeceras de respuesta, facilitando que el usuario o el equipo de soporte reporte incidentes referenciando dicho identificador.

La reconstrucción visual de esta primera traza distribuida fue demostrada exitosamente en `scripts/demostrar-traza-distribuida.mjs`.

### 3. Métricas RED y USE

Cada microservicio expone un endpoint `/metrics` en formato texto compatible con Prometheus:

- **Métricas de Servicios HTTP (Modelo RED):**
  - **Rate (Tasa):** `http_requests_total{service, method, route, status}` — peticiones por segundo.
  - **Errors (Errores):** `http_requests_total{status=~"5.."}` — tasa de respuestas fallidas.
  - **Duration (Duración):** `http_request_duration_seconds_bucket` — histograma de latencia para percentiles p50, p95 y p99.
- **Métricas de Infraestructura y Recursos (Modelo USE):**
  - **Utilization (Utilización):** `pg_pool_active_connections`, `node_eventloop_lag_seconds`.
  - **Saturation (Saturación):** `pg_pool_waiting_clients`, `node_memory_heap_used_bytes`.
  - **Errors (Errores):** `pg_pool_connection_errors_total`.

### 4. Tableros y Criterios de Alerta (SLO / SLI)

#### Objetivos de Nivel de Servicio (SLOs)
- **Disponibilidad general:** $\ge 99.5\%$ de solicitudes exitosas (códigos $< 500$) en ventanas mensuales.
- **Latencia de Reservas:** $\ge 95\%$ de solicitudes a `POST /api/v1/reservas` completadas en menos de **500 ms**.
- **Latencia de Consulta de Clases (Capacidad Compartida):** $\ge 99\%$ de solicitudes a `GET /api/v1/clases` completadas en menos de **150 ms**.

#### Reglas de Alerta Proactivas
1. **Alerta Crítica: Tasa de Errores Elevada (Error Budget Burn):**
   - *Condición:* Tasa de respuestas 5xx $> 1\%$ durante 5 minutos continuos.
   - *Canal:* Notificación inmediata al equipo de guardia.
2. **Alerta de Degradación: Latencia Anómala:**
   - *Condición:* Percentil p99 de latencia en reservas $> 1500\text{ ms}$ durante 3 minutos.
3. **Alerta de Saturación de Base de Datos:**
   - *Condición:* Conexiones activas del pool de PostgreSQL $> 85\%$ de la capacidad máxima por más de 2 minutos.

## Consecuencias

- **Diagnóstico inmediato:** La correlación por `trace_id` permite rastrear cualquier error desde el log del Gateway hasta la consulta SQL en cuestión de segundos.
- **Transparencia técnica:** Los consumidores de la capacidad compartida pueden citar su `x-correlation-id` ante cualquier discrepancia.
- **Preparado para OpenTelemetry:** La arquitectura basada en W3C Trace Context y campos estándar permite enviar las trazas a Jaeger o Grafana Tempo sin cambios en el código.
