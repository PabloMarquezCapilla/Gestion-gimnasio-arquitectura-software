# D2 - Arquitectura interna de los servicios

**Estado:** decidida para la Entrega 2.  
**Fecha:** 12/10/2026.

## Contexto

Cada uno de los microservicios del sistema (`Socios y Membresías`, `Clases y Reservas`, `Accesos y Ocupación`) debe resolver una problemática de negocio específica, interactuar con su respectivo motor de persistencia y comunicarse con otros servicios o clientes externos a través de HTTP y mensajería.

Para asegurar mantenibilidad, facilidad de testing unitario y desacoplamiento de la infraestructura técnica (como bases de datos y frameworks web), es necesario definir el estilo arquitectónico interno y los patrones de diseño aplicados dentro de cada microservicio.

## Decisión

Se adopta una **Arquitectura en Capas inspirada en Arquitectura Hexagonal (Ports & Adapters)** con **Inversión de Dependencias (Dependency Inversion Principle)** y el **Patrón Repositorio (Repository Pattern)**.

### Estructura de capas interna

Cada microservicio organiza su código en cuatro capas con responsabilidades delimitadas y flujo unidireccional de dependencias:

```text
services/<nombre-servicio>/src/
├── types.ts              # Capa de Dominio: tipos, contratos y modelos de datos puros
├── repository.ts         # Capa de Persistencia: interfaces (puertos) e implementaciones (adaptadores)
├── clients/              # Capa de Integración Externa: clientes HTTP y adaptadores remotos
├── tracing.ts            # Capa Transversal: observabilidad, contexto W3C y correlación
├── app.ts                # Capa de Transporte / Aplicación: Fastify, validaciones, rutas y casos de uso
└── server.ts             # Punto de Entrada / Composición: resolución de dependencias y arranque
```

1. **Capa de Dominio (`types.ts`):**
   - Modela las entidades de negocio esenciales (`ClaseEntidad`, `Reserva`, `EntradaEspera`, `Socio`, `Membresia`).
   - Define los invariantes y tipos algebraicos de estado (`CONFIRMADA`, `CANCELADA`, `HABILITADA`, etc.).
   - No tiene dependencias de librerías externas ni de detalles de persistencia.

2. **Capa de Persistencia e Infraestructura (`repository.ts`):**
   - Define puertos/interfaces abstractas (`IClaseRepository`, `ISociosRepository`).
   - Provee adaptadores concretos:
     - `PostgresClaseRepository` / `PostgresSociosRepository`: implementaciones para producción basadas en `pg.Pool`, transacciones ACID y bloqueos pesimistas (`SELECT ... FOR UPDATE`).
     - `MemoryClaseRepository` / `MemorySociosRepository`: implementaciones en memoria para pruebas automatizadas rápidas y ejecución offline sin dependencias pesadas.

3. **Capa de Integración Externa (`clients/`):**
   - Desacopla la invocación remota a otros microservicios mediante interfaces (`ISociosClient`).
   - Implementa `HttpSociosClient` con propagación de cabeceras de traza (`traceparent`, `x-correlation-id`), control de tiempos de espera (`timeout`) y reintentos ante fallas temporales.
   - Provee `MockSociosClient` para pruebas de integración aisladas.

4. **Capa de Aplicación y Transporte HTTP (`app.ts`):**
   - Configura las instancias de Fastify, esquemas OpenAPI / JSON Schema (AJV) y autenticación.
   - Orquesta los casos de uso del flujo principal (ej. verificar membresía, ejecutar transacción de reserva, manejar lista de espera).
   - Recibe las dependencias mediante **Inyección de Dependencias** a través de `AppOptions`, permitiendo componer el servicio con adaptadores de PostgreSQL o de memoria según el entorno.

5. **Punto de Entrada e Inicialización (`server.ts`):**
   - Lee variables de entorno (`DATABASE_URL`, `PORT`, `SOCIOS_SERVICE_URL`).
   - Conecta a la base de datos real, inicializa tablas/migraciones y arranca el servidor HTTP con manejo elegante de señales `SIGINT` y `SIGTERM`.

## Alternativas consideradas y motivos de selección

1. **Transaction Script monolítico en un único archivo:**
   - *Alternativa:* Colocar todas las consultas SQL directamente dentro de los manejadores de ruta de Fastify.
   - *Motivo de rechazo:* Genera alto acoplamiento entre el framework web y la base de datos, dificulta el testeo automatizado sin levantar PostgreSQL y viola el principio de responsabilidad única.

2. **Arquitectura Hexagonal estricta con Domain-Driven Design (DDD) completo (Value Objects, Event Sourcing, Aggregates pesados):**
   - *Alternativa:* Introducir clases de agregados con métodos de mutación interna, value objects inmutables y un despachador de eventos de dominio en memoria.
   - *Motivo de rechazo:* Para el tamaño y velocidad de desarrollo del proyecto actual, introduce sobreingeniería accidental y boilerplates innecesarios en TypeScript.

3. **Selección: Capas modulares con Inversión de Dependencias y Repositorios:**
   - *Ventajas:* Permite probar el 100% de los flujos de negocio y de los contratos OpenAPI en milisegundos mediante `MemoryRepository`, mientras que en producción se activa la persistencia transaccional de PostgreSQL sin cambiar una sola línea de lógica de aplicación.

## Consecuencias

- **Alta Testabilidad:** Permite ejecutar suites de pruebas de contrato OpenAPI (`test/contract.test.mjs`) y pruebas de integración de punta a punta (`test/flujo-principal.test.mjs`) de forma ultrarrápida y determinista.
- **Claridad de Dependencias:** El flujo de llamadas es estrictamente jerárquico: las rutas llaman a los servicios/casos de uso, y estos llaman a interfaces de repositorios o clientes externos.
- **Flexibilidad Operativa:** Facilita migrar o extender adaptadores (por ejemplo, agregar soporte para Redis o MongoDB) sin modificar las reglas de reserva ni la API pública.
