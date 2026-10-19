# D2 - Arquitectura interna de los servicios

**Estado:** decidida para la Entrega 2.  
**Fecha:** 12/10/2026.

## Contexto

Cada uno de los microservicios del sistema (`Socios y Membresías`, `Clases y Reservas`, `Accesos y Ocupación`) debe resolver una problemática de negocio específica, interactuar con su respectivo motor de persistencia y comunicarse con otros servicios o clientes externos a través de HTTP y mensajería.

Para asegurar mantenibilidad, facilidad de testing unitario y desacoplamiento de la infraestructura técnica (como bases de datos y frameworks web), es necesario definir el estilo arquitectónico interno y los patrones de diseño aplicados dentro de cada microservicio.

## Decisión

Para cumplir con el requisito de la sección 2.1 del enunciado (*"Al menos dos servicios deberán tener patrones de arquitectura diferentes, trabajados durante la materia"*) y adecuar el diseño interno a la complejidad de cada subdominio, se seleccionan **patrones de arquitectura interna diferenciados según el servicio**:

| Microservicio | Patrón de Arquitectura Interna | Adecuación al problema del servicio |
|---|---|---|
| **`Clases y Reservas`** | **Arquitectura Hexagonal (Ports & Adapters)** | El servicio concentra las reglas de negocio más críticas (aforo, reservas concurrentes, lista de espera, promoción automática), expone el contrato OpenAPI compartido a otros grupos y consume sincrónicamente a `Socios y Membresías`. Aislar el núcleo mediante puertos (`IClaseRepository`, `ISociosClient`) y adaptadores intercambiables (`PostgresClaseRepository`, `MemoryClaseRepository`, `HttpSociosClient`, `MockSociosClient`) permite validar reglas y contratos sin acoplamiento a la infraestructura. |
| **`Socios y Membresías`** | **Arquitectura en Capas (Layered Architecture)** | El dominio de socios, autenticación y vigencia de membresías sigue un flujo transaccional vertical clásico: Capa de Presentación/Controladores HTTP (`app.ts`) $\rightarrow$ Capa de Servicios de Dominio y Seguridad Criptográfica (`security.ts`, reglas de vigencia) $\rightarrow$ Capa de Acceso a Datos (`repository.ts`). Esta organización minimiza la indirección y facilita las operaciones ABM y de validación. |
| **`Accesos y Ocupación`** | **Arquitectura Orientada a Eventos / Proyección de Lectura (CQRS-lite)** | Separa el flujo de escritura de alta frecuencia (registro de eventos de ingreso y egreso en colecciones documentales de MongoDB) de la vista proyectada de lectura rápida (cálculo y caché de ocupación actual por sede). |

### 1. Detalle de `Clases y Reservas`: Arquitectura Hexagonal (Ports & Adapters)

```text
services/clases-reservas/src/
├── types.ts                  # Núcleo de Dominio: entidades, invariantes y contratos de resultado
├── repository.ts             # Puerto de Salida (IClaseRepository) + Adaptadores (Postgres / Memory)
├── clients/
│   └── socios.client.ts      # Puerto de Salida (ISociosClient) + Adaptador ACL HTTP con resiliencia
├── tracing.ts                # Aspecto transversal: contexto distribuido W3C (traceparent)
├── app.ts                    # Adaptador Primario (Driving Adapter HTTP/Fastify + casos de uso)
└── server.ts                 # Composición e Inyección de Dependencias ( Composition Root )
```

- **Puertos de Salida (Driven Ports):**
  - `IClaseRepository`: abstrae la persistencia transaccional del catálogo, reservas y cola de espera.
  - `ISociosClient`: abstrae la colaboración remota hacia `Socios y Membresías`.
- **Adaptadores Secundarios (Driven Adapters):**
  - `PostgresClaseRepository`: implementa transacciones ACID con bloqueo pesimista (`SELECT ... FOR UPDATE`) e índices únicos parciales.
  - `HttpSociosClient`: implementa timeout de 3000 ms, reintentos con jitter y propagación W3C Trace Context.
  - `MemoryClaseRepository` y `MockSociosClient`: adaptadores de prueba para tests de contrato y concurrencia en memoria.

### 2. Detalle de `Socios y Membresías`: Arquitectura en Capas (Layered Architecture)

```text
services/socios-membresias/src/
├── app.ts                    # Capa de Presentación / Transporte HTTP (Rutas REST y DTOs)
├── security.ts               # Capa de Lógica de Negocio y Seguridad (Hashing scrypt + timingSafeEqual)
├── repository.ts             # Capa de Acceso a Datos (Persistencia relacional de socios y membresías)
├── types.ts                  # Modelos de datos transversales a las capas
├── tracing.ts                # Middleware transversal de trazabilidad y logs estructurados
└── server.ts                 # Inicialización del proceso y pool de conexiones
```

- **Flujo unidireccional por capas:** La capa HTTP recibe las solicitudes (`/api/v1/auth/*`, `/api/v1/socios/:id/habilitacion`), delega la validación criptográfica e invariantes de negocio a la capa de servicio/seguridad y persiste o consulta el estado en la capa de datos.

## Alternativas consideradas y motivos de selección

1. **Aplicar un único patrón idéntico en todos los microservicios (ej. Hexagonal pesada en todos o Transaction Script en todos):**
   - *Motivo de rechazo:* Aplicar Arquitectura Hexagonal completa con múltiples puertos en servicios centrados en datos o eventos simples agrega código repetitivo (*boilerplate*), mientras que usar un *Transaction Script* plano en `Clases y Reservas` acoplaría las reglas de lista de espera y cupos directamente a SQL e impediría testear el contrato OpenAPI de forma aislada.
2. **Domain-Driven Design (DDD) táctico con Event Sourcing completo:**
   - *Motivo de rechazo:* Para el alcance del sistema, reconstruir el estado de cada socio desde eventos puros complejiza innecesariamente las consultas relacionales de vigencia. Se reservó el enfoque basado en eventos únicamente para el historial de accesos y la mensajería asíncrona entre servicios.

## Consecuencias

- **Cumplimiento arquitectónico y adecuación al problema:** Cada microservicio utiliza el patrón que mejor resuelve su complejidad específica (Hexagonal donde hay orquestación e integraciones múltiples; Capas donde predomina la gestión transaccional de entidades).
- **Alta Testabilidad:** Permite ejecutar la suite de pruebas de contrato OpenAPI (`services/clases-reservas/test/contract.test.mjs`), autenticación (`test/auth.test.mjs`), concurrencia (`test/concurrencia.test.mjs`) e integración de punta a punta (`test/flujo-principal.test.mjs`) en ~1.5 segundos.
- **Flexibilidad Operativa:** Facilita extender adaptadores (Redis, RabbitMQ, MongoDB) sin modificar las reglas de negocio ni la API pública.
