# Evidencia de cobertura de tests unitarios (§2.11)

**Fecha:** 09/11/2026. **Comando:** `npm run test:cobertura`, que usa la cobertura nativa de Node 22 sobre el código compilado de los cuatro servicios. Excluye los propios tests, los scripts y el frontend; el frontend tiene sus tests en `npm run test:frontend`.

**Umbrales que exige el comando** (falla si no se cumplen): líneas ≥ 70 %, ramas ≥ 80 %, funciones ≥ 80 %.

## Resultado

272 tests, 0 fallas.

**Reverificación del 10/11/2026.** Tras las correcciones de fin de mes, costo mensual y descubrimiento de pruebas, `npm run test:cobertura` aprobó 278 pruebas y sus tres umbrales. La cobertura global fue 73,47 % de líneas, 88,11 % de ramas y 86,73 % de funciones. El lanzador explícito de k6 queda fuera del descubrimiento automático. Los valores de las tablas siguientes corresponden al ensayo original del 09/11/2026.

| Alcance | Líneas | Ramas | Funciones |
|---|---:|---:|---:|
| **Todos los archivos** | **73,4 %** | **88,0 %** | **86,5 %** |

Reglas de negocio relevantes (dominio y casos de uso):

| Archivo | Regla | Líneas | Ramas |
|---|---|---:|---:|
| `clases-reservas/application/reservas.service` | Reserva, cupo y lista de espera | 97,5 % | 88,6 % |
| `clases-reservas/application/busqueda-clases.service` | Validación de búsqueda | 100 % | 98,2 % |
| `clases-reservas/application/gestion-clases.service` | Publicación y edición de clases | 94,2 % | 86,8 % |
| `clases-reservas/application/membresias-eventos.service` | Consumo idempotente del evento | 100 % | 92,3 % |
| `accesos-ocupacion/domain` | Alternancia de ingreso y egreso | 100 % | 97,4 % |
| `accesos-ocupacion/ocupacion` | Caché de ocupación | 96,1 % | 93,1 % |
| `socios-membresias/services` | Habilitación de membresía | 98,2 % | 92,1 % |
| `socios-membresias/membresias.gestion` | Planes, pagos y suspensión | 96,4 % | 97,3 % |
| `socios-membresias/car-cruds-evidencias.service` | Informe mensual a Car Cruds | 96,9 % | 91,8 % |
| `tienda/stock` | Reposiciones, ventas y compras | 100 % | 98,6 % |
| `tienda/catalogo` | Catálogo de FAV y caché degradada | 100 % | 89,1 % |
| `tienda/circuit-breaker` | Circuit breaker | 100 % | 97,1 % |

## Lectura

Las reglas de negocio superan el 94 % de líneas y el 86 % de ramas. El promedio total baja por los adaptadores de PostgreSQL y RabbitMQ (`*.postgres`, `membresias.eventos`, la parte Postgres de `repository`). No se ejercitan con dobles en memoria: se prueban contra dependencias reales en los tests de integración por servicio:

| Servicio | Comando |
|---|---|
| Socios y Membresías, Clases | `npm run test:postgres` y `npm run test:membresias` |
| Mensajería (Outbox, Inbox y DLQ) | `npm run test:eventos` |
| Accesos (MongoDB y Redis) | `npm run test:accesos` y `npm run test:cache` |
| Tienda (PostgreSQL) | `npm run test:tienda` |

Esos tests no se suman a este porcentaje porque corren en procesos aparte con contenedores temporales.
