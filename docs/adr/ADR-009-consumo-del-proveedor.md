# D9 - Consumo del proveedor

**Estado:** diseño conservado; estructura interna de Tienda preparada en el paso 6. Integración externa pendiente de contrato, URL y autenticación.
**Fecha:** 12/10/2026.

## Actualización factual de alcance - 19/10/2026

### Paso 6: preparación sin contrato externo

El equipo confirmó que todavía no dispone de documentación, URL ni autenticación de la distribuidora. Se prepara únicamente la parte propia:

- Workspace `services/tienda`, imagen y servicio de Compose, sin base, caché, broker, volumen ni datos de productos.
- Estructura en Capas: `app.ts` recibe HTTP y verifica JWT; `services.ts` representa explícitamente la consulta todavía no habilitada; `server.ts` compone y arranca el proceso. No se crea un puerto de productos ni un adaptador HTTP con supuestos sobre el proveedor.
- Ruta **interna del gimnasio** `GET /api/v1/tienda/productos`, a través del gateway y con el JWT emitido por Socios. Actualmente responde `503` con `{ codigo: INTEGRACION_PENDIENTE, mensaje }`, sin lista de productos ni cantidades. No es una ruta acordada con la distribuidora ni su contrato externo.
- `GET /health` del servicio, publicado como `/health/tienda`, informa `estado: estructura`, `integracion: PENDIENTE_CONTRATO` y `persistencia: ninguna`. HTTP 200 acredita que el proceso responde; no que el proveedor esté disponible.
- La pestaña Tienda del portal del socio muestra carga, integración pendiente o un error de comunicación. Un 503 de integración pendiente conserva la sesión; un 401 la invalida como en las otras funciones. Una respuesta desconocida nunca se interpreta como catálogo vacío o stock cero.

**Pendiente para completar el paso 6:** contrato/repositorio del proveedor, URL, autenticación, rutas y parámetros, paginación, formatos de productos/stock y errores. Con esos datos se definirán el adaptador, la traducción al modelo propio, los presupuestos y el comportamiento ante fallas. No se fijan ahora credenciales, rutas externas, datos de ejemplo ni políticas numéricas nuevas.

Esta preparación no acredita consumo externo real ni una integración conjunta. Las comprobaciones del recorrido interno se registran en README. Se conservan las decisiones de propiedad y ubicación de ADR-015; el balanceador corresponde al paso 7.

### Diseño de la integración que sigue pendiente

La capacidad externa que se consumirá queda delimitada a **consultar productos y stock de una distribuidora desde el microservicio Tienda**, según [ADR-015](ADR-015-limites-con-tienda.md). Su estructura propia está preparada; el cliente externo sigue pendiente. El alcance es solo de consulta; no incorpora base de datos nueva, persistencia local, caché ni stock propio. El catálogo y las existencias pertenecen a la distribuidora. La identidad del proveedor, su contrato, URL y credenciales no están disponibles.

Se conserva la política general de integración de este ADR. Los ejemplos de pagos, clima, geolocalización, calendarios y biometría de la sección siguiente son **antecedentes de hipótesis del 12/10**, no funcionalidades del alcance vigente ni alternativas seleccionadas para Tienda.

El adaptador concreto, el desglose de datos recibidos, los errores y los parámetros de comunicación se determinarán a partir del contrato real. Los tiempos y umbrales numéricos del antecedente son propuestas sin validar para esta integración. No se presentan un cliente, un circuit breaker ni un fallback como implementados.

El consumo partirá de **Tienda**; la sección 4.1, página 5, excluye iniciarlo desde el frontend o nuestro API Gateway. La respuesta exitosa de Tienda y las operaciones externas se definirán cuando se reciba el contrato; no se fijan ahora rutas ni estructuras de respuesta del proveedor. Una falla de consulta representa información desconocida y no permite afirmar que el stock sea cero.

**Referencias:** sección 3, página 4 (documentación); sección 4.1, página 5 (integración); sección 5, páginas 6–7 (historia de decisiones). Esta anotación concreta el alcance sin sustituir la política arquitectónica general. Si se cambia esa política al conocer el contrato, se deberá registrar un sucesor y marcar este ADR como reemplazado.

## Contexto

El enunciado exige que nuestro sistema consuma una capacidad provista por otro grupo asignado por la cátedra e incorpore esa capacidad en un flujo de negocio importante del gimnasio (sección 4.1, página 5). La invocación debe iniciarse desde el microservicio responsable de dicho flujo, no desde el API Gateway.

Dado que la capacidad del grupo proveedor aún está pendiente de asignación formal por la cátedra, es necesario definir la arquitectura de integración, el patrón de adaptación al contrato externo y el comportamiento ante errores, cambios en el contrato o indisponibilidad temporal del proveedor.

## Decisión general registrada el 12/10/2026

Se adopta como diseño el patrón **Capa Anti-Corrupción (Anti-Corruption Layer - ACL) / Adapter**, previsto mediante un cliente dedicado dentro del microservicio consumidor, con políticas de **Circuit Breaker** y **Degradación Elegante (Graceful Fallback)**. La implementación concreta sigue pendiente del proveedor y su contrato.

### 1. Antecedente: hipótesis de ubicación antes de conocer la capacidad

Dependiendo de la naturaleza de la capacidad que sea asignada al grupo:
- **Si el proveedor ofrece servicios de pago/facturación:** El consumo se originará desde `Socios y Membresías` al confirmar pagos de altas o renovaciones.
- **Si el proveedor ofrece meteorología, geolocalización o calendarios externos:** El consumo se originará desde `Clases y Reservas` para enriquecer la información de la clase o sede.
- **Si el proveedor ofrece control de identidad o biometría:** El consumo se originará desde `Accesos y Ocupación` previo a la validación de ingreso.

En todos los casos, la llamada parte desde la capa de integración del microservicio de negocio correspondiente.

### 2. Patrón Anti-Corruption Layer (ACL)

Para evitar que el modelo de datos interno de nuestro gimnasio quede acoplado o "contaminado" por los esquemas, nombres de campos o idiosincrasias del grupo proveedor:

```text
[Servicio de Negocio Propio]
         │
         ▼
[Interface de Puerto Interno: IProveedorExternoClient]
         │
         ▼
[Adaptador ACL: HttpProveedorExternoClient]
         │ (HTTP + Timeout + Retries + Circuit Breaker)
         ▼
[API Externa del Grupo Proveedor]
```

- **Aislamiento de tipos:** El adaptador traduce las respuestas y códigos del contrato OpenAPI del proveedor a los tipos de dominio propios del gimnasio (`types.ts`).
- **Tolerancia a cambios del proveedor:** Si el proveedor modifica nombres de campos o versiones menores de su contrato, solo se modifica la lógica de serialización/deserialización del adaptador ACL, sin alterar los controladores ni las reglas de negocio del gimnasio.

### 3. Antecedente: parámetros propuestos de errores, indisponibilidad y degradación

El sistema del gimnasio no debe colapsar si el microservicio del proveedor se cae, responde lentamente o experimenta fallas internas:

1. **Presupuesto estricto de tiempo (Timeout):**
   - Tiempo máximo de espera: **2.5 segundos** por solicitud. Al vencerse, la petición se aborta.
2. **Reintentos con Backoff y Jitter:**
   - Máximo **1 reintento** tras **150 ms** con jitter aleatorio para lecturas seguras ante respuestas `502`, `503`, `504` o errores de red `ECONNRESET`.
3. **Circuit Breaker:**
   - Si la tasa de fallas hacia el proveedor supera el 50% en una ventana de 10 peticiones, el circuito pasa a estado **Abierto (Open)** durante 30 segundos, rechazando llamadas inmediatamente (*Fail-Fast*) para evitar agotar pools de conexiones.
4. **Estrategia de Fallback (Degradación Elegante):**
   - **Flujos no bloqueantes (ej. información complementaria de clases o clima):** El sistema captura la indisponibilidad del proveedor, registra un log de advertencia y continúa el flujo de reserva omitiendo el dato externo o sirviendo el último valor conocido desde caché.
   - **Flujos bloqueantes (ej. autorización externa indispensable):** Se retorna un error claro al usuario (`503 CAPACIDAD_EXTERNA_INDISPONIBLE`) explicando que la operación externa no pudo completarse temporalmente, sin corromper el estado interno del gimnasio.

## Consecuencias

- **Independencia arquitectónica:** El gimnasio puede operar de forma autónoma aun ante fallas prolongadas del grupo externo.
- **Facilidad de testing:** La interfaz del puerto ACL permite sustituir fácilmente al proveedor por un `MockProveedorClient` en los entornos de integración continua y pruebas locales.
- **Integración pendiente:** Conocer el contrato permitirá definir el adaptador, su ubicación, las validaciones y sus políticas de fallas. No se presume que baste con configurar una URL ni que el proveedor utilice API Key.
