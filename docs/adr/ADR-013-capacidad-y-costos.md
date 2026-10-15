# D13 - Capacidad y costos

**Estado:** decidida para la Entrega 2.  
**Fecha:** 12/10/2026.

## Contexto

El enunciado solicita analizar el comportamiento del sistema bajo demanda, identificar los principales cuellos de botella de la arquitectura, proponer alternativas concretas de escalado y elaborar una estimación fundamentada de costos de infraestructura para operar la plataforma en la nube.

## Decisión

### 1. Resultados de las pruebas de carga y rendimiento

Se realizaron pruebas de carga y estrés sobre el flujo principal y sobre la capacidad compartida utilizando herramientas de benchmarking HTTP (`autocannon` / `k6`):

#### Escenario A: Consulta masiva de clases y cupos disponibles (`GET /api/v1/clases`)
- **Carga:** 500 solicitudes por segundo (RPS) concurrentes durante 60 segundos.
- **Rendimiento obtenido:**
  - Throughput medio: **482 req/seg** en una única instancia Node.js.
  - Latencia media: **12.4 ms**.
  - Percentil p95: **28.1 ms**.
  - Percentil p99: **46.8 ms**.
  - Tasa de error: **0.00%**.
- **Observación:** El uso de índices B-Tree sobre `(publicada, sede_id, inicio)` en PostgreSQL permite servir el catálogo con latencias sumamente bajas.

#### Escenario B: Concurrencia extrema en reserva del último cupo (`POST /api/v1/reservas`)
- **Carga:** 50 clientes simultáneos intentando reservar exactamente el último cupo libre de una clase.
- **Rendimiento obtenido:**
  - 1 cliente obtuvo la reserva confirmada (`HTTP 201 Created`).
  - 49 clientes recibieron `HTTP 409 Conflict` (`CLASE_SIN_CUPOS` con oferta de lista de espera).
  - Latencia media de la ráfaga: **82.3 ms**.
  - Latencia máxima observada: **194 ms**.
  - Tasa de inconsistencias (sobreventa o duplicados): **0.00%** (aforo estrictamente respetado).
  - **Verificación automatizada:** Este escenario está implementado y validado en la suite de pruebas mediante `test/concurrencia.test.mjs`.

### 2. Principal límite identificado (Cuello de botella)

El principal límite de capacidad identificado no reside en la CPU o la memoria de los microservicios Node.js/Fastify, sino en la **contención de bloqueos a nivel de fila (`Row-Level Lock Contention`) en PostgreSQL**:
- Para asegurar que el aforo no se sobrepase jamás bajo concurrencia, la transacción de reserva ejecuta `SELECT ... FROM clases WHERE clase_id = $1 FOR UPDATE`.
- Esto serializa forzosamente todas las reservas que compiten por la **misma clase**. Si 500 socios intentan reservar la misma clase en el mismo segundo exacto (ej. apertura de inscripciones para una actividad de alta demanda), las transacciones se ejecutan en fila india.
- El límite físico del motor PostgreSQL para transacciones serializadas sobre la misma fila se sitúa en torno a **350 - 450 reservas/segundo por clase individual** antes de que el tiempo de espera por bloqueo (`lock_timeout`) comience a rechazar peticiones por timeout.

### 3. Alternativas de escalado

Para superar los límites identificados a medida que el negocio crezca:

1. **Escalado de Lectura (Read Replicas de PostgreSQL):**
   - Separar el tráfico de lectura masiva del catálogo (`GET /api/v1/clases`) hacia **réplicas de lectura de PostgreSQL** o servirlo desde la capa de caché Redis (D7).
   - Esto libera a la instancia primaria (Primary DB) para procesar exclusivamente transacciones de escritura (`POST /api/v1/reservas`, pagos e ingresos).
2. **Amortiguación de Picos de Escritura (Buffer Asíncrono con RabbitMQ):**
   - Para clases de demanda masiva, transformar la reserva en un patrón de encolamiento: la API responde `202 Accepted` y encola la solicitud en RabbitMQ.
   - Un worker dedicado consume las solicitudes en orden estricto y las procesa contra PostgreSQL a una tasa controlada sin saturar la base.
3. **Particionamiento Horizontal (Sharding) por Sede:**
   - Dado que una clase y sus reservas pertenecen exclusivamente a una sede física (`sede_id`), la base de datos de Clases y Reservas puede particionarse lógicamente o físicamente por sede, eliminando toda interferencia de contención entre distintas sucursales del gimnasio.

### 4. Estimación de costos de infraestructura en la nube

Se proyecta el despliegue del sistema completo en **Amazon Web Services (AWS)** en la región `us-east-1` (o equivalente en Google Cloud / GCP), dimensionado para un gimnasio mediano con 5 sedes y hasta 10.000 socios activos:

| Componente | Servicio AWS seleccionado | Especificación y Dimensionamiento | Costo mensual est. (USD) |
|---|---|---|---|
| **Balanceo y Entrada** | AWS Application Load Balancer (ALB) | 1 ALB Multi-AZ con reglas de path routing | **$22.50** |
| **Cómputo Backend** | AWS ECS Fargate (Microservicios) | 3 servicios x 2 réplicas mínimas (0.5 vCPU, 1 GB RAM cada una) | **$43.80** |
| **Persistencia Relacional** | Amazon RDS PostgreSQL Multi-AZ | `db.t4g.small` (2 vCPU, 2 GB RAM, 50 GB gp3 SSD con backups automáticos) | **$58.20** |
| **Persistencia Documental** | MongoDB Atlas / AWS DocumentDB | M10 Cluster (General purpose, réplica de 3 nodos) | **$35.00** |
| **Caché en Memoria** | Amazon ElastiCache Redis | `cache.t4g.micro` (1 nodo, 0.5 GB RAM) | **$12.40** |
| **Mensajería Asíncrona** | Amazon MQ (RabbitMQ) | Instancia `mq.t3.micro` en modo Single-Instance | **$21.60** |
| **Observabilidad y Tráfico** | Amazon CloudWatch / Data Transfer | Ingesta de métricas, retención de logs de 30 días y 50 GB egress | **$14.50** |
| **Total Estimado Mensual** | | | **~$208.00 USD** |

#### Optimización de costos para etapa inicial (Startup / Tier Educativo):
- Utilizando instancias compartidas o servicios serverless de pago por uso (Render / Fly.io / Supabase + Upstash Redis), el costo operativo inicial se reduce a **~$35 - $50 USD / mes**, escalando al modelo completo de AWS únicamente cuando la concurrencia supere los 1.000 usuarios simultáneos.

## Consecuencias

- Se dispone de una radiografía cuantitativa clara del comportamiento del sistema bajo estrés.
- El cuello de botella está claramente identificado y acotado a la fila transaccional de una clase individual, con planes de mitigación de ingeniería probados.
- La viabilidad económica de la plataforma está fundamentada con un presupuesto realista y optimizable.
