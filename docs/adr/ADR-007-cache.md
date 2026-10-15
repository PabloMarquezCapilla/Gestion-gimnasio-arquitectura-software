# D7 - Cache

**Estado:** decidida para la Entrega 2; implementada en E2 mediante políticas de exclusión estricta (Cache-Control: no-store) para garantizar consistencia de cupos, y proyectada con Redis 7 para ocupación en la fase de escalabilidad.  
**Fecha:** 12/10/2026.

## Contexto

El sistema de gestión de gimnasio presenta patrones de acceso con alta frecuencia de lectura y baja frecuencia de modificación:
1. **Ocupación en tiempo real por sede (`Accesos y Ocupación`):** consultada constantemente por recepcionistas, socios desde la app móvil y paneles informativos del gimnasio.
2. **Catálogo de clases publicadas (`Clases y Reservas`):** consultado intensivamente por socios navegando la grilla semanal y por sistemas externos que integran la capacidad compartida.

Ejecutar agregaciones complejas contra el almacenamiento principal en cada consulta de lectura introduce carga innecesaria en la base de datos y aumenta la latencia de respuesta. Se requiere definir qué datos almacenar temporalmente, las estrategias de vigencia e invalidación, el comportamiento ante fallas del componente de caché y las métricas para evaluar su eficacia.

## Decisión

Se adopta el patrón **Cache-Aside (Lazy Loading)** con almacenamiento temporal en memoria distribuida (**Redis 7**) y fallback local, aplicando políticas de vigencia diferenciadas según la criticidad de los datos.

### 1. Información almacenada temporalmente

| Clave / Dominio | Servicio propietario | Datos almacenados | Vigencia (TTL) | Estrategia de invalidación |
|---|---|---|---|---|
| `ocupacion:sede:{sedeId}` | `Accesos y Ocupación` | Conteo de personas activas dentro de la sede (`{ sedeId, presentes, aforoMaximo, porcentaje, actualizadoEn }`). | **30 segundos** | **Reactiva y por tiempo:** Se invalida y actualiza inmediatamente al confirmarse un ingreso o egreso en recepción; si no hay movimientos, expira a los 30s. |
| `catalogo:clases:{hashFiltros}` | `Clases y Reservas` | Lista paginada de clases públicas por sede y fecha. | **60 segundos** | **Por tiempo (TTL):** Expira a los 60s. Se invalida ante altas, bajas o modificaciones de horarios de clases por el administrador. |
| **Exclusión de caché** | `Clases y Reservas` | **La reserva efectiva y cálculo crítico del último cupo NUNCA se sirven desde caché.** | N/A | Las operaciones de reserva y la capacidad compartida con `Cache-Control: no-store` consultan directamente el almacenamiento transaccional para evitar falsos positivos de cupos. |

### 2. Ciclo de vida e invalidación

- **Patrón Cache-Aside:**
  1. La aplicación intenta leer la clave desde Redis.
  2. Si existe (*Cache Hit*), retorna el valor deserializado en < 2 ms.
  3. Si no existe (*Cache Miss*), consulta la base de datos PostgreSQL/MongoDB, calcula el valor, lo escribe en Redis con su correspondiente TTL y retorna la respuesta.
- **Invalidación Proactiva vs Basada en TTL:**
  - Para la ocupación, ante cada evento exitoso de `IngresoRegistrado` o `EgresoRegistrado`, el servicio actualiza la clave en Redis o ejecuta un comando `DEL ocupacion:sede:{sedeId}` atómico, garantizando que la siguiente lectura recalcule con datos frescos.
  - El TTL actúa como salvaguarda (*safety net*) en caso de que un evento de invalidación se pierda o falle temporalmente.

### 3. Comportamiento ante fallas (Resiliencia de la caché)

La disponibilidad de la base de datos o del servicio de negocio nunca debe verse comprometida por un incidente en el servidor de caché:

- **Estrategia Fail-Open (Degradación elegante):**
  - Si la conexión a Redis experimenta timeout (> 200 ms) o caída completa del proceso, el cliente de caché captura la excepción, emite un log de advertencia con `level: warn` y **continúa la ejecución dirigiéndose directamente al almacenamiento principal**.
  - El sistema continúa operando normalmente con un ligero incremento de latencia, evitando caídas en cascada.
- **Protección contra Cache Stampede (Avalancha):**
  - Se incorpora un jitter aleatorio de ±10% en los TTLs para evitar que múltiples claves masivas expiren simultáneamente.

### 4. Criterios de medición y observabilidad

La efectividad de la capa de caché se mide continuamente mediante métricas exportadas a Prometheus (D11):

1. **Cache Hit Ratio:**
   $$\text{Hit Ratio} = \frac{\text{Hits}}{\text{Hits} + \text{Misses}}$$
   - **Objetivo:** $\ge 85\%$ para consultas de ocupación de sedes bajo carga normal.
2. **Latencia comparativa:**
   - Latencia con *Cache Hit*: objetivo p95 $\le 5\text{ ms}$.
   - Latencia con *Cache Miss* (base de datos): objetivo p95 $\le 45\text{ ms}$.
3. **Tasa de errores de conexión de caché:** alerta inmediata si la tasa de errores hacia Redis supera el 0.5% en una ventana de 5 minutos.

## Consecuencias

- **Reducción sustancial de carga:** Disminuye en más del 80% las consultas de agregación repetitivas sobre MongoDB y PostgreSQL para lecturas de estado frecuente.
- **Tolerancia a inconsistencia transitoria acotada:** En el peor escenario de falla de invalidación, la ocupación mostrada tendrá un desfase máximo de 30 segundos, lo cual es plenamente aceptable para la visualización en pantallas de recepción y aplicaciones de socios.
- **Protección del flujo crítico:** Al no utilizar caché para la transacción de reserva de cupos, se garantiza la ausencia absoluta de inconsistencias en el aforo de las clases.
