# D2 - Arquitectura interna de los servicios

**Estado:** patrones conservados y estructura de Socios/Clases implementada en el paso 4. Tienda tiene estructura propia desde el paso 6; su cliente externo y el dominio de Accesos siguen pendientes.
**Fecha:** 12/10/2026; validación de estructura 19/10/2026.

**Referencia:** sección 2.1, página 2 (al menos dos servicios con patrones internos diferentes), D2 en sección 5 y actualización documental en sección 3, página 4. Se mantienen Hexagonal y Capas; no se sustituye la decisión inicial.

## Contexto

Cada uno de los microservicios del sistema (`Socios y Membresías`, `Clases y Reservas`, `Accesos y Ocupación`) debe resolver una problemática de negocio específica, interactuar con su respectivo motor de persistencia y comunicarse con otros servicios o clientes externos a través de HTTP y mensajería.

Para asegurar mantenibilidad, facilidad de testing unitario y desacoplamiento de la infraestructura técnica (como bases de datos y frameworks web), es necesario definir el estilo arquitectónico interno y los patrones de diseño aplicados dentro de cada microservicio.

## Decisión

Para cumplir con el requisito de la sección 2.1 del enunciado (*"Al menos dos servicios deberán tener patrones de arquitectura diferentes, trabajados durante la materia"*) y adecuar el diseño interno a la complejidad de cada subdominio, se seleccionan **patrones de arquitectura interna diferenciados según el servicio**:

| Microservicio | Patrón de Arquitectura Interna | Adecuación al problema del servicio |
|---|---|---|
| **`Clases y Reservas`** | **Arquitectura Hexagonal (Ports & Adapters)** | `ReservasService` concentra reservas, espera, validación remota y recuperación. Depende de puertos propios; HTTP, PostgreSQL y memoria son adaptadores. Conserva las consultas de clases, que ya no son la capacidad ofrecida al otro grupo. |
| **`Socios y Membresías`** | **Arquitectura en Capas (Layered Architecture)** | HTTP en `app.ts`/`empleados.http.ts` → casos de uso `AuthService`, `SociosService` y `EmpleadosService` → persistencia en `repository.ts`; `security.ts` ofrece operaciones criptográficas. El POST externo utiliza las mismas capas y PostgreSQL; el mock separado se conserva. |
| **`Accesos y Ocupación`** | **Arquitectura Orientada a Eventos / Proyección de Lectura (CQRS-lite), prevista** | Diseño para separar registro de movimientos y lectura de ocupación. Actualmente solo tiene estructura HTTP; este paso no implementa esas reglas ni su proyección. |
| **`Tienda`** | **Estructura en Capas, integración pendiente** | `app.ts` controla transporte/autenticación, `services.ts` representa la consulta no habilitada y `server.ts` arranca el proceso. Sin repositorio ni cliente externo mientras no exista contrato; no se incorpora un patrón nuevo distinto de los ya elegidos. |

### 1. Detalle de `Clases y Reservas`: Arquitectura Hexagonal (Ports & Adapters)

```text
services/clases-reservas/src/
├── types.ts                  # Núcleo de Dominio: entidades, invariantes y contratos de resultado
├── ports.ts                  # Puertos propios IClaseRepository e ISociosClient
├── application/
│   └── reservas.service.ts   # Casos de uso, reglas y recuperación; sin Fastify ni pg
├── repository.ts             # Adaptadores de persistencia Postgres / Memory
├── clients/
│   └── socios.client.ts      # Adaptadores HTTP / Mock del puerto ISociosClient
├── auth.ts                   # Validación de sesión en el adaptador HTTP
├── tracing.ts                # Aspecto transversal: contexto distribuido W3C (traceparent)
├── app.ts                    # Adaptador de entrada HTTP: valida y traduce resultados
└── server.ts                 # Composición, arranque y trabajador de recuperación
```

- **Puertos de Salida (Driven Ports):**
  - `IClaseRepository`: abstrae la persistencia transaccional del catálogo, reservas y cola de espera.
  - `ISociosClient`: abstrae la colaboración remota hacia `Socios y Membresías`.
- **Adaptadores Secundarios (Driven Adapters):**
  - `PostgresClaseRepository`: implementa transacciones ACID con bloqueo pesimista (`SELECT ... FOR UPDATE`) e índices únicos parciales.
  - `HttpSociosClient`: presupuesto total de 3000 ms por verificación, incluida lectura del cuerpo y como máximo un reintento; credencial técnica y propagación W3C.
  - `MemoryClaseRepository` y `MockSociosClient`: adaptadores de prueba para tests de contrato y concurrencia en memoria.

### 2. Detalle de `Socios y Membresías`: Arquitectura en Capas (Layered Architecture)

```text
services/socios-membresias/src/
├── app.ts                    # Capa de Presentación / Transporte HTTP (Rutas REST y DTOs)
├── services.ts               # AuthService/SociosService: identidad, permisos, altas y vigencia
├── empleados.http.ts         # Transporte externo, validación del contrato y credencial de origen
├── empleados.service.ts      # Alta pendiente y contrato de persistencia atómica
├── security.ts               # scrypt, comparación de claves y configuración JWT
├── errors.ts                 # Errores de aplicación e identidad duplicada
├── repository.ts             # Capa de Acceso a Datos (Persistencia relacional de socios y membresías)
├── types.ts                  # Modelos de datos transversales a las capas
├── tracing.ts                # Middleware transversal de trazabilidad y logs estructurados
├── crear-admin.ts            # Entrada local explícita para el administrador inicial
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
- **Verificación:** los casos de uso pueden probarse sin red ni SQL; `npm test` incluye contratos, autenticación, reglas, concurrencia e interfaz. `npm run test:postgres` comprueba por separado los adaptadores reales con dos instancias. Los resultados del cierre se registran en README, sin prometer duraciones de ejecución.
- **Flexibilidad Operativa:** Facilita extender adaptadores (Redis, RabbitMQ, MongoDB) sin modificar las reglas de negocio ni la API pública.
