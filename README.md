# Sistema integral de gestión de gimnasio

Trabajo Práctico Integrador — Arquitectura de Software 2026

## Integrantes

- Lorenzo Rossi
- Jose Baudino
- Pablo Marquez

## Dominio

Sistema integral de gestión de gimnasios orientado a membresías, pagos y comprobantes internos, reserva de clases, control de acceso y ocupación de sedes.

## Objetivo

Construir una plataforma que permita gestionar el ciclo completo de un socio dentro de un gimnasio: alta, renovación y vigencia de membresías, registro de pagos y comprobantes internos, búsqueda y reserva de actividades con cupos limitados, control de ingreso y consulta de ocupación de las sedes.

## Entrega 2: Dominio propio de punta a punta

En este hito se presentan:
1. **Servicios operativos y funcionalidad compartida funcionando:**
   - `Clases y Reservas` (`@gimnasio/clases-reservas`): operando contra base de datos PostgreSQL, calculando cupos dinámicamente y publicando la capacidad compartida (`GET /api/v1/clases`) de acuerdo al contrato OpenAPI v1.0.0.
   - `Socios y Membresías` (`@gimnasio/socios-membresias`): operando contra PostgreSQL, exponiendo la validación síncrona de habilitación de membresías requerida por el flujo principal.
2. **Almacenamiento integrado al flujo:**
   - **PostgreSQL 17** integrado con esquemas relacionales, transacciones ACID, restricciones de unicidad parcial para evitar reservas duplicadas y bloqueos a nivel de fila (`SELECT ... FOR UPDATE`) para evitar sobreventa de cupos.
3. **Logs estructurados y primera traza distribuida correlacionada:**
   - Logs en formato JSON estructurado estándar (Pino) con campos: `service`, `trace_id`, `span_id`, `parent_span_id`, `time`, `level`, `msg`.
   - Propagación de contexto distribuido mediante cabeceras estándar **W3C Trace Context (`traceparent`)** y `X-Correlation-ID`.
4. **Decisiones arquitectónicas completas:**
   - Decisiones nuevas: **D2, D6, D7, D9, D10, D12 y D13**.
   - Validaciones de decisiones previas: **D1, D3 y D5**.
   - Primera versión de **D11** (Observabilidad) y actualización de **D8** (Contrato propio operativo).

## Flujo principal implementado

1. El socio consulta su membresía en `Socios y Membresías` y busca clases en `Clases y Reservas`.
2. Solicita reservar mediante `POST /api/v1/reservas` antes del inicio de la clase.
3. `Clases y Reservas` llama sincrónicamente a `Socios y Membresías` (`GET /api/v1/socios/:socioId/habilitacion?fecha=...`) propagando la traza distribuida. Si la membresía está inactiva o vencida, retorna `422 MEMBRESIA_NO_HABILITADA`.
4. Mediante una transacción en PostgreSQL, se evitan duplicados (`409 RESERVA_DUPLICADA`) y se verifica el aforo. Si hay cupo, se confirma la reserva (HTTP 201). Si está llena, se ofrece ingreso voluntario a la lista de espera (HTTP 409 o ingreso a espera).
5. Ante una cancelación (`POST /api/v1/reservas/:id/cancelar`), se libera el cupo y se activa la promoción automática del siguiente socio habilitado en la lista de espera.

## Registro de Decisiones Arquitectónicas (ADRs)

| ADR | Decisión | Título | Estado |
|---|---|---|---|
| [ADR-001](docs/adr/ADR-001-limites-de-servicios.md) | **D1** | Límites de los servicios y propiedad de los datos | Validada en E2 con el flujo punta a punta |
| [ADR-002](docs/adr/ADR-002-arquitectura-interna-de-servicios.md) | **D2** | Arquitectura interna de los servicios | Decidida en E2 (Capas, Inversión de Dep., Repositorios) |
| [ADR-003](docs/adr/ADR-003-persistencia.md) | **D3** | Persistencia relacional y documental | Validada en E2 con PostgreSQL operativo |
| [ADR-004](docs/adr/ADR-004-consistencia-y-concurrencia.md) | **D4** | Consistencia y concurrencia | Decidida en E2 (ACID, FOR UPDATE, índices parciales) |
| [ADR-005](docs/adr/ADR-005-comunicacion-entre-servicios.md) | **D5** | Comunicación entre servicios (Síncrona/Asíncrona) | Validada en E2 (HTTP 3s timeout, retries, W3C trace) |
| [ADR-006](docs/adr/ADR-006-busqueda.md) | **D6** | Búsqueda | Decidida en E2 (PostgreSQL Full-Text Search + GIN) |
| [ADR-007](docs/adr/ADR-007-cache.md) | **D7** | Caché | Decidida en E2 (Cache-Aside, Redis, TTL e invalidación) |
| [ADR-008](docs/adr/ADR-008-contrato-propio.md) | **D8** | Contrato de la capacidad propia | Actualizada en E2 (operativo sobre base real, OpenAPI 1.0.0) |
| [ADR-009](docs/adr/ADR-009-consumo-del-proveedor.md) | **D9** | Consumo del proveedor | Decidida en E2 (Anti-Corruption Layer, circuit breaker) |
| [ADR-010](docs/adr/ADR-010-resiliencia.md) | **D10** | Resiliencia | Decidida en E2 (Timeouts, retries con jitter, bulkheads) |
| [ADR-011](docs/adr/ADR-011-observabilidad.md) | **D11** | Observabilidad (Logs, Métricas, Trazas, SLOs) | Primera versión en E2 |
| [ADR-012](docs/adr/ADR-012-balanceo-de-carga.md) | **D12** | Balanceo de carga | Decidida en E2 (NGINX least_conn, health checks) |
| [ADR-013](docs/adr/ADR-013-capacidad-y-costos.md) | **D13** | Capacidad y costos | Decidida en E2 (Pruebas de carga, cuello de botella, nube) |

## Ejecución y Pruebas

### Requisitos

- **Node.js 22 LTS**.
- **Docker Desktop** (opcional para ejecución en contenedores con PostgreSQL, MongoDB y RabbitMQ).

### 1. Compilación y Suite Completa de Pruebas

Para compilar todos los microservicios en TypeScript y ejecutar tanto los tests de contrato OpenAPI como los tests de integración del flujo principal de punta a punta:

```sh
npm ci --ignore-scripts
npm test
```

Esto ejecuta 16 pruebas automatizadas:
- Las 9 pruebas de conformidad estricta contra el contrato OpenAPI 3.1.1 en `services/clases-reservas/test/contract.test.mjs`.
- Las 3 pruebas de integración de punta a punta en `test/flujo-principal.test.mjs` (verificación de membresía, reserva, duplicados, lista de espera y propagación de trazas W3C).
- La prueba de concurrencia extrema en `test/concurrencia.test.mjs` (50 solicitudes simultáneas compitiendo por el último cupo libre, verificando aforo estricto y ausencia de sobreventa).
- Las 3 pruebas de autenticación y gestión de credenciales en `test/auth.test.mjs` (registro con hash scrypt, login exitoso y rechazo de credenciales inválidas).

### 2. Demostración de Traza Distribuida y Logs Estructurados

Para observar en tiempo real la emisión de logs JSON correlacionados y la reconstrucción del árbol de spans distribuidos a través de los microservicios:

```sh
node scripts/demostrar-traza-distribuida.mjs
```

### 3. Ejecución del Entorno Completo con Docker Compose

```sh
node scripts/iniciar.mjs
```

El Gateway queda expuesto en `http://localhost:8080`:

| Endpoint | Método | Descripción |
|---|---|---|
| `http://localhost:8080/` | `GET` | Portal web React (SPA) para socios y panel de administración. |
| `http://localhost:8080/consola.html` | `GET` | Consola técnica interactiva de pruebas de arquitectura y trazas W3C. |
| `http://localhost:8080/api/v1/clases` | `GET` | Capacidad compartida: clases y cupos reales (requiere `X-API-Key`). |
| `http://localhost:8080/api/v1/clases/{id}` | `GET` | Detalle y disponibilidad de una clase real (requiere `X-API-Key`). |
| `http://localhost:8080/api/v1/reservas/clases` | `GET` | Catálogo interno de clases y cupos para el portal de reservas. |
| `http://localhost:8080/api/v1/reservas` | `POST` | Creación de reservas con validación sincrónica de membresía. |
| `http://localhost:8080/api/v1/socios/{id}/habilitacion` | `GET` | Validación de vigencia y habilitación de membresía. |
| `http://localhost:8080/metrics/clases` | `GET` | Métricas Prometheus de Clases y Reservas. |
| `http://localhost:8080/metrics/socios` | `GET` | Métricas Prometheus de Socios y Membresías. |
| `http://localhost:8080/health/clases` | `GET` | Estado operativo de Clases y Reservas (conectividad con PostgreSQL). |
| `http://localhost:8080/health/socios` | `GET` | Estado operativo de Socios y Membresías (conectividad con PostgreSQL). |
| `http://localhost:8080/health/accesos` | `GET` | Estado del proceso de Accesos y Ocupación. |

### Probar la capacidad compartida en PowerShell

```powershell
$apiKey = (Select-String -LiteralPath .env -Pattern '^CAPACIDAD_API_KEY=').Line.Split('=', 2)[1]
Invoke-RestMethod -Uri 'http://localhost:8080/api/v1/clases?sedeId=sede-demo-01' -Headers @{ 'X-API-Key' = $apiKey }
```
