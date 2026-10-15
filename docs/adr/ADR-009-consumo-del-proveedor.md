# D9 - Consumo del proveedor

**Estado:** decidida para la Entrega 2.  
**Fecha:** 12/10/2026.

## Contexto

El enunciado exige que nuestro sistema consuma una capacidad provista por otro grupo asignado por la cátedra e incorpore esa capacidad en un flujo de negocio importante del gimnasio (sección 4.1, página 5). La invocación debe iniciarse desde el microservicio responsable de dicho flujo, no desde el API Gateway.

Dado que la capacidad del grupo proveedor aún está pendiente de asignación formal por la cátedra, es necesario definir la arquitectura de integración, el patrón de adaptación al contrato externo y el comportamiento ante errores, cambios en el contrato o indisponibilidad temporal del proveedor.

## Decisión

Se adopta el patrón **Capa Anti-Corrupción (Anti-Corruption Layer - ACL) / Adapter** implementado mediante un cliente HTTP dedicado dentro del microservicio consumidor, complementado con mecanismos de **Circuit Breaker** y **Degradación Elegante (Graceful Fallback)**.

### 1. Ubicación del consumo en el dominio del gimnasio

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

### 3. Comportamiento ante errores, indisponibilidad y degradación

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
- **Transición inmediata al conocer la asignación:** Una vez asignado el grupo, solo resta implementar la clase adaptadora concreta con la URL y la API Key del proveedor provistas.
