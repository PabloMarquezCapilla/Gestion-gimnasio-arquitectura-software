# ADR-020 — Concreción de D7: ocupación con Redis

**Estado:** aceptado e implementado localmente, 30/10/2026. Complementa ADR-019 y concreta ADR-007 sin borrar su historia.

## Evidencia y alcance

La lectura repetida ejecutaba `findOne` sobre sedes y `countDocuments` sobre presencias abiertas. Índices: `_id`, único `(sedeId,socioId)` y `(sedeId,abierta)`. Recepción consume `/api/v1/accesos/sedes/:sedeId/ocupacion` mediante NGINX; autentica ADMIN antes de leer. La línea base se midió y conservó antes de implementar Redis: 2000 lecturas, 4000 comandos MongoDB, p95 11,38 ms. La comparación controlada posterior está en [EVIDENCIA-CACHE](../EVIDENCIA-CACHE.md). Demuestra presión evitable bajo carga sintética repetitiva; no prueba volumen real ni saturación de producción.

## Decisión

Cache-aside en Accesos. MongoDB sigue siendo la fuente de verdad. Se almacena exclusivamente el entero de ocupación por sede; no JWT, autorizaciones, personas, historial ni decisiones de admisión. Un hit también evita la comprobación de existencia de sede: el catálogo no tiene borrado público; una futura mutación de sedes debe invalidar esta caché. No cambia el contrato HTTP ni `Cache-Control: no-store`. `consultadoEn` indica atención de consulta, no instante de lectura de MongoDB.

Claves: `pulse:ocupacion:v1:ttl30000:{sedeId}:generation` y `:value`. Namespace configurable, separado por entorno/base; todas las réplicas deben compartir configuración. Las llaves `{}` conservan el mismo hash slot para Lua. El valor expira; el token aleatorio expira a 2×TTL. No son datos permanentes. TTL inicial 30 s, configurable 50–30000 ms: conserva la propuesta de D7 como límite técnico eventual, no como SLO de negocio aprobado.

## Carreras y frescura

1. LOOKUP atómico obtiene/crea token y captura con `TIME` de Redis un plazo máximo **antes** de consultar MongoDB. Si no existe token, elimina un valor huérfano; la evicción no permite reutilizar generaciones.
2. Ante miss se consulta la fuente. STORE compara token y guarda sólo por el tiempo restante hasta ese plazo. Una lectura lenta no obtiene 30 s adicionales al terminar. Hits no renuevan expiración.
3. Después del commit de cada movimiento aceptado (también replay aceptado) INVALIDATE reemplaza el token aleatorio y elimina el agregado atómicamente. Una carga iniciada antes no puede reponerlo. No agrega escrituras MongoDB.
4. Tokens aleatorios evitan ABA tras expiración o reinicio; Redis se ejecuta sin persistencia. Evicción LRU es segura: si se pierde el token se descarta el valor y se recalcula.

No se promete consistencia inmediata. Una lectura ya en vuelo puede devolver el estado anterior. Si falla invalidación o el proceso cae entre commit e invalidación, otra réplica puede servir el agregado previo hasta expirar: plazo diseñado máximo 30 s desde el inicio de su carga, con reloj/expiración Redis funcionando normalmente. No es garantía de entrega de red antes de 30 s. Durante cambios de configuración deben coordinarse todas las réplicas y reiniciarse las claves, evitando espacios de invalidación distintos. Aún no hay outbox de invalidación ni single-flight para misses concurrentes; quedan como deudas explícitas.

## Fallos y operación

`REDIS_URL` opcional, `redis:` o `rediss:`. Conexión y reconexión en segundo plano, cola offline deshabilitada, máximo 1000 comandos pendientes, conexión 500 ms, operación 100 ms por defecto. El timeout usa una carrera de promesas: también acota comandos ya enviados. Éstos pueden ejecutarse tarde; CAS/plazo siguen evitando reposición vieja y una invalidación tardía sólo descarta un agregado. No hay reintento de negocio por fallo Redis. El límite de cola acota acumulación durante una conexión bloqueada.

Fallo de lectura/escritura Redis: métrica y log estructurado asociado a petición, fallback a MongoDB. Fallo de invalidación: registro explícito; no revierte ni transforma en fracaso el movimiento ya confirmado. Si también falla MongoDB y no hay hit vigente, se propaga error; nunca se inventa cero. Un hit vigente puede responder aunque MongoDB esté caído; salud y escrituras siguen comprobando la fuente. Cierre destruye conexión y reconexión pendiente.

Compose: Redis 8.2.11 Alpine, 64 MiB, `allkeys-lru`, sin volumen/persistencia ni puerto publicado. No condiciona el arranque/salud de Accesos. Redis del Compose es para la red interna de desarrollo; producción requiere aislamiento y controles de acceso/TLS según despliegue, aún no ensayado.

## Costos y alternativas

Un hit requiere un viaje y un Lua Redis; un miss agrega lookup y store al trabajo MongoDB; un movimiento agrega invalidación. Redis consume memoria/conexiones y demanda operación. Memoria local se descartó por divergencia entre réplicas; refresco sólo por TTL deja mayor ventana habitual tras movimientos. CAS por generación resuelve la carrera sin bloqueos distribuidos ni escrituras auxiliares MongoDB. No hay coalescencia de misses: arranques concurrentes pueden repetir consultas. Medición real y limitaciones en la evidencia; no se fijan porcentajes esperados como requisito.
