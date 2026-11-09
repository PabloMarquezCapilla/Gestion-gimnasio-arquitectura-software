# D13 - Capacidad y costos

**Estado:** actualizado el 09/11/2026 con un test de carga k6 sostenido y de saturación a través del gateway; capacidad y límite principal medidos. Ver la sección "Test de carga k6" al final.
**Fecha original:** 12/10/2026. **Validación:** 19/10/2026. **Actualización:** 09/11/2026.
**Enunciado:** §5, D13, página 7; decisión requerida en §6.3, página 8.

## Contexto y criterio

El análisis de capacidad debe apoyarse en resultados reproducibles, identificar límites y justificar alternativas de escalado. Se utiliza una línea base local y una estimación ilustrativa de infraestructura; todavía no hay un despliegue ni presupuesto definitivo elegidos.

## Prueba de carga reproducible

`npm run test:postgres` usa PostgreSQL 17 temporal en Docker, dos instancias HTTP de Clases con pools independientes y JWT real. Después de sus verificaciones funcionales realiza 20 lecturas de calentamiento y 300 consultas `GET /api/v1/reservas/clases`, con 10 trabajadores concurrentes, alternando las instancias. Cada medición abarca envío y lectura completa del JSON, con conexión cerrada entre solicitudes. Si alguna respuesta no es 200, el ensayo falla.

Resultado del 19/10/2026, 23:09 Argentina (20/10 02:09 UTC):

| Dato | Medición |
|---|---:|
| Solicitudes / concurrencia | 300 / 10 |
| Duración de la muestra | 904,94 ms |
| Throughput de la muestra | 331,51 solicitudes/s |
| Latencia media / p50 | 30,04 / 28,43 ms |
| p95 / p99 | 38,84 / 78,56 ms |
| Errores | 0 |
| Datos / réplicas | 6 clases ficticias / 2 instancias |

Entorno: Node 22.18.0 sobre Windows, Intel i7-1355U, 12 CPU lógicas y 15,7 GiB de memoria del host. Las aplicaciones y el generador comparten máquina; PostgreSQL corre en Docker Desktop. No incluye gateway, navegador, proveedor, TLS o latencia de nube. Es una muestra breve sobre pocos datos, no un ensayo sostenido, saturación, capacidad garantizada ni validación de SLO.

El mismo ensayo verifica 12 intentos concurrentes sobre un último cupo y una sola reserva persistida. El ensayo de balanceo agrega 12 escrituras por NGINX: una 201 y once 409; distribución y caída en D12. No se atribuyen a esos casos percentiles de escritura que no se midieron.

## Límite identificado y alternativa de escalado

El límite estructural del flujo de escritura es la serialización por fila de clase (`FOR UPDATE`): más réplicas HTTP no permiten asignar simultáneamente el último cupo de la misma clase. El presupuesto de llamada a Socios y los pools también condicionan la capacidad. Es un riesgo identificado por el diseño, sin umbral de saturación medido; no se afirma que PostgreSQL sea el primer recurso saturado en todas las cargas.

Primera alternativa: mantener transacciones cortas sin red bajo bloqueo, medir espera de locks/CPU/pools con datos representativos y aumentar réplicas HTTP solo cuando la aplicación sea el límite. Las lecturas de metadatos podrían escalar con caché o réplicas si las mediciones lo justifican; cupos y escrituras conservarán validación transaccional. Cambiar reservas a 202 asíncrono o particionar por sede requeriría revisar contrato y consistencia; no se implementa ni se presenta como una solución ya probada.

## Estimación ilustrativa de infraestructura

Para poder discutir costos sin elegir aún el despliegue, se calcula un escenario educativo: una VM Linux con Docker Compose, gateway NGINX, los servicios del repositorio (Clases x2), PostgreSQL, MongoDB y RabbitMQ en el mismo host. No es alta disponibilidad entre máquinas ni una capacidad validada para producción.

Precios públicos consultados el 19/10/2026; USD sin impuestos, 730 horas/mes. Supuestos explícitos de cálculo, no necesidades del negocio confirmadas:

| Concepto | Supuesto y fórmula | USD/mes |
|---|---|---:|
| Cómputo | EC2 t3.large, Linux, US East N. Virginia, 2 vCPU/8 GiB; 730 × 0,0835 | 60,96 |
| Disco | 30 GB gp3; ejemplo de tarifa 0,08 USD/GB-mes, sin IOPS/throughput extra | 2,40 |
| IPv4 pública | 1 dirección; 730 × 0,005 | 3,65 |
| **Subtotal ilustrativo** | Suma antes de red, backups y otros servicios | **67,01** |

Fuentes: [EC2 T3, tabla Linux/US East](https://aws.amazon.com/ec2/instance-types/t3/), [EBS, ejemplo gp3](https://aws.amazon.com/ebs/pricing/), [VPC, IPv4 pública](https://aws.amazon.com/vpc/pricing/). El ejemplo de EBS debe confirmarse para la región elegida en la calculadora al presupuestar.

El subtotal excluye transferencia, snapshots/backups, dominio, almacenamiento de logs, soporte, impuestos y créditos de CPU T3 Unlimited. No se descuentan promociones o créditos educativos. La memoria/disco de la VM deben verificarse con todos los flujos y datos antes de adoptarla. Faltan volumen y retención reales, tráfico, objetivo de disponibilidad y presupuesto del grupo para cotizar un despliegue definitivo; con servicios administrados o varias máquinas el costo cambia.

## Consecuencias

E2 dispone de resultados reproducibles, un límite estructural explicado, una alternativa de escalado condicionada a mediciones y una estimación trazable. El despliegue y su presupuesto definitivo siguen sujetos a elección del equipo; no se han creado recursos ni generado gastos en la nube.

## Test de carga k6 (09/11/2026)

`npm run test:carga` ejecuta k6 contra el gateway, con JWT, rate limiting, dos réplicas de Clases y PostgreSQL. El detalle está en [EVIDENCIA-CARGA](../EVIDENCIA-CARGA.md).

- **Capacidad medida:** ~480 solicitudes HTTP/s (400 recorridos/s de búsqueda más reserva) con 0 % de fallas, búsqueda p95 49 ms y reserva p95 452 ms. Cumple el objetivo de p95 < 300/500 ms. El uso normal con 100 socios activos genera 55 solicitudes/s.
- **Primer límite encontrado y corregido:** `worker_connections` (512 por defecto) del gateway. Producía 17 % de 500 en saturación. Se corrigió con 4096 conexiones y keepalive hacia los servicios.
- **Límite principal actual:** CPU de las réplicas de Clases (un núcleo cada una, porque Node.js corre en un solo hilo) y de PostgreSQL (búsqueda de texto completo y bloqueos de cupo). Pasado ese punto la latencia crece sin errores.
- **Escalado elegido:** primero más réplicas de Clases, mientras PostgreSQL tenga CPU libre; después más CPU o una réplica de lectura para el catálogo.
- **Despliegue:** se eligió una VM con Docker Compose ([DEPLOY](../DEPLOY.md)); el costo es la estimación de arriba. Para la presentación alcanza una VM de 2 vCPU y 8 GiB: la carga esperada está más de un orden de magnitud por debajo del límite medido.
