# D7 - Caché

**Estado actual (30/10/2026):** implementado y medido para ocupación; [ADR-020](ADR-020-cache-ocupacion-redis.md) concreta esta decisión. El texto siguiente conserva el diseño previo y su estado histórico. Exclusión de caché de cupos conservada.
**Fecha original:** 12/10/2026. **Revisión factual:** 19/10/2026.
**Enunciado:** §2.7, página 3; §5, D7, página 7; decisión requerida en §6.3, página 8.

## Contexto y decisión

Se mantiene la propuesta Cache-Aside con Redis para la futura consulta repetitiva de ocupación por sede. El servicio Accesos será propietario del cálculo; MongoDB conservará los movimientos. Redis será una copia temporal prescindible, sin autoridad para permitir un ingreso ni una reserva.

Hoy no hay servicio Redis, cliente, invalidación ni métricas de caché en el proyecto. `Cache-Control: no-store` impide almacenar una respuesta: no constituye una caché implementada. Clases y cupos se consultan directamente en PostgreSQL y las reservas se deciden dentro de una transacción.

## Política prevista, todavía sin implementación ni validación de negocio

- Dato candidato: ocupación derivada por sede, nunca credenciales, pagos, decisiones de habilitación o último cupo.
- Clave orientativa: `ocupacion:sede:{sedeId}`. Se conserva el TTL inicial propuesto de 30 s, sujeto a acuerdo y medición al implementar Accesos.
- Invalidar después de confirmar ingreso/egreso; en un miss, recalcular desde la fuente y guardar con TTL. Evitar que un recálculo concurrente reponga un dato anterior después de invalidar (versión o coordinación por sede por definir).
- Ante error o timeout de Redis, consultar la fuente con tiempo acotado y registrar el fallo. Si también falla la fuente, informar indisponibilidad; no mostrar cero como si fuera una medición.
- El TTL por sí solo no limita a 30 s la antigüedad desde el evento si un cálculo viejo vuelve a escribirse. La garantía se verificará con carreras e invalidación antes de afirmarla.
- El catálogo con cupos mantiene `no-store`. La propuesta histórica de cachear catálogo durante 60 s no está aplicada; requeriría separar metadatos de disponibilidad y revisar el contrato antes de activarla.

## Medición y alternativas

Comparar consultas equivalentes con y sin caché: aciertos/fallos, p95 de latencia, consultas a la fuente, antigüedad del dato y comportamiento ante caída e invalidación concurrente. Los objetivos iniciales (85% de aciertos, p95 de 5 ms en hit) son hipótesis de diseño, no resultados ni SLO aceptados.

Se evaluó memoria local, pero requeriría invalidar cada réplica y podría dar valores diferentes. Redis agrega operación y otro punto de falla; se diferirá su incorporación hasta tener el flujo de ocupación y demostrar beneficio.

## Consecuencias

Se agrega una dependencia prescindible para acelerar lecturas derivadas, con un costo de invalidación y operación que debe medirse. E2 documenta D7; la caché efectiva y su comparación antes/después siguen pendientes para §2.7.
