# Caché de ocupación: evidencia y reproducción — 30/10/2026

## Auditoría y secuencia

Se partió de `feat/accesos-mongo-recepcion` (`a8fdd8e`, con `620a53a`), no de main. Se creó `feat/cache-ocupacion-redis`. Antes de implementar Redis se ejecutaron 187 pruebas y se midió la línea base: [original inalterado](evidence/cache-ocupacion/baseline-original.json), conservado en commit `127f9d2` junto al procedimiento. Original: p50 7,882 ms; p95 11,379 ms; p99 13,954 ms; 2000 find + 2000 aggregate; cero errores. No se reconstruyen latencias individuales inexistentes del original.

La fuente usa `sedes.findOne` y `presencias.countDocuments({sedeId,abierta:true})`, con índices `_id`, único `(sedeId,socioId)` y `(sedeId,abierta)`. MongoDB traduce el conteo a aggregate. El frontend `AccesosPanel` consulta mediante la ruta NGINX `/api/v1/accesos/*` y refresca al registrar movimientos. Sólo el agregado numérico es candidato a caché; ni permisos ni habilitación dependen de él.

La revisión del enunciado utiliza las referencias conservadas de la etapa anterior: §2.7 p.3, D7 §5 p.7 y decisión §6.3 p.8. El PDF original estaba en un temporal de WhatsApp que ya no existe; no se afirma haberlo releído desde ese archivo en esta etapa. ADR-007 fue revisado antes de implementar y conserva su texto histórico. No hay SLO de frescura de negocio acordado: 30 s es el límite técnico propuesto y documentado en ADR-020.

La implementación verificada se conserva en `b94c392`. El campo `commit` de la comparación identifica el HEAD padre `127f9d2` al medir: la implementación aún estaba sin confirmar; no significa que Redis ya existiera en ese commit de línea base. Los scripts/runtime medidos son los posteriormente conservados en `b94c392`.

## Comparación controlada

[Resultados completos y latencias individuales](evidence/cache-ocupacion/comparacion.json). Mismo proceso y fixture MongoDB, 10 sedes × 10000 presencias sintéticas (30% abiertas), 2000 solicitudes por escenario, concurrencia 20, 100 lecturas de calentamiento, round-robin uniforme. HTTP real directo a Accesos con JWT ADMIN y lectura de JSON completo, sin gateway ni escrituras durante carga. MongoDB caliente en todos. Antes del escenario frío se invalidan las 10 sedes después del calentamiento; caliente conserva los valores del calentamiento. Las métricas y comandos excluyen calentamiento/invalidaciones preparatorias.

| Métrica | Sin caché (repetición) | Fría al comenzar | Caliente | Diferencia caliente − sin |
|---|---:|---:|---:|---:|
| p50 ms | 8,053 | 2,752 | 2,148 | −5,905 |
| p95 ms | 11,919 | 5,396 | 3,451 | −8,468 |
| p99 ms | 17,007 | 11,421 | 6,013 | −10,994 |
| Comandos MongoDB | 4000 | 20 | 0 | −4000 |
| Errores HTTP | 0 | 0 | 0 | 0 |
| Hits / misses | no aplica | 1990 / 10 | 2000 / 0 | no aplica |
| Hit rate | no aplica | 99,5% | 100% | no aplica |
| Errores de caché | no aplica | 0 | 0 | no aplica |

El p95 caliente se redujo 71,04% respecto de la repetición sin caché; no es una expectativa garantizada. El escenario frío incluye los primeros misses y luego hits: no significa que las 2000 solicitudes sean misses. La distribución inicial produjo 10 cargas, no mide la peor estampida sobre una misma sede. La línea base original se conserva separada para mostrar variación entre momentos (11,38 vs 11,92 ms p95), sin elegir retrospectivamente una referencia favorable.

Entorno real: macOS ARM, Node 22.23.3, MongoDB 8.0.28 y Redis 8.2.11 nativos temporales en loopback; CPU, RAM, índices, carga host, CPU/memoria del proceso y `INFO` Redis constan en JSON. Generador, aplicación y motores comparten host. No se reservó hardware ni aisló de todos los procesos ajenos. Los escenarios se ejecutaron una vez, en orden sin/fría/caliente; hay efecto de JIT/orden y no intervalos de confianza. No mide throughput sostenible, escrituras, producción, red entre hosts ni sobrecarga NGINX. Sí acredita eliminación real de consultas bajo lecturas repetidas, no una necesidad de producción ya confirmada.

Costo: cada hit ejecuta un Lua Redis, miss agrega lookup + store a la fuente, movimiento agrega invalidación. Se incorpora memoria, conexiones y operación de otro servicio. `INFO stats/memory/server` conserva actividad y memoria reales (incluye sobrecarga administrativa; no atribuir todo al endpoint). No se midió CPU independiente de cada motor ni costo monetario. Compose limita Redis a 64 MiB; el ensayo nativo no aplica ese límite, por lo que no acredita comportamiento bajo presión de memoria.

## Reproducción segura

No usar bases existentes. Los scripts generan recursos exclusivos, puertos loopback y marcadores de propiedad; sólo limpian esos recursos. No leen `.env` ni ejecutan flush/drop sobre recursos del usuario.

```sh
npm ci
npm run build
npm run test:cache
node scripts/medir-cache-ocupacion.mjs --compare --output=/tmp/comparacion-nueva.json
```

Docker es el modo predeterminado para MongoDB replica set y Redis aislados. Sin Docker, usar binarios explícitos ya disponibles o compilados en temporales, sin instalar servicios del sistema:

```sh
export CACHE_TEST_MODE=native
export MONGOD_BIN=/ruta/a/mongod
export REDIS_SERVER_BIN=/ruta/a/redis-server
npm run test:cache
node scripts/medir-cache-ocupacion.mjs --compare --output=/tmp/comparacion-nueva.json
```

El archivo de resultados se crea con exclusión (`wx`): usar nombre nuevo, no sobrescribir la evidencia original. La medición original precede a la implementación; para inspeccionar exactamente ese procedimiento: `git show 127f9d2:scripts/medir-cache-ocupacion.mjs`. Redis se compiló de la distribución oficial 8.2.11 en un temporal, NGINX 1.28.0 con PCRE2 10.46 también, sin instalación global. La descarga inicial con Python falló por certificados locales; se descargó con curl manteniendo validación TLS.

## Métricas

`/metrics` conserva el formato Prometheus y etiquetas existentes de servicio/instancia, sin sede, socio, clave idempotente ni token:

- `accesos_cache_hits_total`, `misses_total`, `bypass_total`, `errors_total` con el mismo prefijo `accesos_cache_`.
- `accesos_cache_invalidations_total`: intentos; `invalidation_errors_total`: fallidos; `stores_rejected_total`: cargas descartadas por generación/plazo.
- `accesos_occupancy_mongo_loads_total`: cargas de fuente; `mongo_queries_total`: intentos de existencia/conteo desde la aplicación. No equivale a comandos completados ni a consultas de movimientos/historial.
- `accesos_occupancy_mongo_counts_avoided_total`: un conteo evitado por hit. El camino actual también evita un find de sede. La comparación usa monitor del driver para contar comandos reales, no estos intentos.
- `accesos_occupancy_duration_seconds`: histograma de lectura backend (incluye fallback), no toda la duración HTTP.
- `accesos_cache_age_seconds`: antigüedad aproximada conservadora desde el inicio de carga hasta el lookup, sólo hits; no edad del último movimiento. TTL restante proviene de Redis.

Los nombres abreviados de las listas mantienen su prefijo indicado. Contadores se reinician por proceso. Fallos de operaciones se registran con logger de petición y correlación; reconexión produce log estructurado de servicio sin URI/credenciales. No se incorporó tablero, recolector ni alertas globales.

## Verificaciones ejecutadas

- `npm test`: **190 aprobadas**, cero fallos; antes de implementación 187.
- `npm run test:cache` con binarios nativos: **11 aprobadas**, cero fallos: Redis+Mongo reales, dos réplicas, sedes, TTL, token expirado, CAS/lectura antigua, dos ingresos y dos egresos concurrentes, replay, pausa/timeout, reinicio/reconexión, Redis ausente al iniciar, doble fallo sin cero, autorización y métricas.
- `npm run frontend:build`: aprobado.
- `npm run test:accesos` en modo nativo con NGINX+Chrome y `ACCESOS_WEB_CACHE=1`: **15 aprobadas**, cero fallos. Incluye navegador con Redis real, ingresos/egresos, ocupación, pérdida de respuesta y reanudación idempotente. El helper exige hits e invalidaciones efectivos. Socios usa su servidor HTTP real con repositorio de fixture en memoria: no acredita PostgreSQL.
- `docker compose config --quiet`: validación declarativa; Docker daemon no disponible. **Compose completo no ejecutado** en esta etapa.

Los ensayos iniciales detectaron un fallo real al reiniciar Redis con cliente 4.7.1 y comandos abortados; se actualizó al cliente 6.3.1. La primera repetición mostró que cancelar sólo la cola no limita una operación ya enviada; se corrigió con plazo explícito. Ambos fallos se conservaron como hallazgos, no se deshabilitaron escenarios. Las pruebas finales incluyen pausa y reinicio.

Para repetir navegador: configurar `ACCESOS_TEST_MODE=native`, `CACHE_TEST_MODE=native`, `MONGOD_BIN`, `REDIS_SERVER_BIN`, `ACCESOS_WEB_CACHE=1`, `NGINX_BIN`, `NGINX_MIME_TYPES`, `ACCESOS_PLAYWRIGHT_MODULE` y `ACCESOS_CHROME_BIN` con rutas a herramientas locales; ejecutar `npm run frontend:build` y `npm run test:accesos`. Sin las tres variables NGINX/Playwright, ese ensayo opcional no se ejecuta. Los fixtures nunca llaman Car Cruds ni el proveedor externo.

Logs finales en [directorio de evidencia](evidence/cache-ocupacion/). D7 y §2.7 quedan acreditados localmente para este flujo con medición, invalidación y fallos. Pendientes: Compose completo/despliegue, aprobación de frescura de negocio, representatividad de demanda real, presión de memoria, ensayo prolongado y observabilidad global de otra etapa. No se implementaron pagos, RabbitMQ, Tienda ni Car Cruds.
