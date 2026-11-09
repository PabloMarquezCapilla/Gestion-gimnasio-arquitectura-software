# Plan de cierre de entrega 3

**Estado.** 08/11/2026. PR #7 de Tienda integrada en `main`, commit `837df58`. Base del paso 4 consolidada en `6a7e6ca` y plan en `b4ab192`. Rama de trabajo `feat/membresias-eventos`, con apertura de PR pendiente por decisión del equipo. Paso 4 cerrado funcionalmente en local con corrección de recuperación, pruebas automáticas y resultados manuales del equipo. Paso 5 completo. Retiro voluntario y recorrido propio de clases del paso 6 verificados localmente. Restan políticas administrativas pendientes, fuentes/integraciones del paso 7 y cierre de observabilidad/despliegue.
**Referencia:** presentación grupal, páginas 8–9 del enunciado. La defensa individual de la página 9 tiene verificaciones adicionales, identificadas abajo.

## Forma de trabajo

Completar una etapa por vez: explicar el cambio, modificar lo mínimo necesario, actualizar su documentación, ejecutar las pruebas pertinentes y revisar el resultado con el equipo. Consultar las decisiones de negocio o datos externos faltantes; no deducirlos del código de otro grupo. Este backlog no autoriza implementar todos los pasos juntos ni publicar cambios.

## 0. Base actual — verificada

Se conservaron pagos/planes/membresías, reservas/FIFO, Accesos con MongoDB, caché Redis medida, JWT, balanceo y Car Cruds. El 06/11/2026 se verificaron **196/196 pruebas** y compilación frontend de **35 módulos** después de actualizar la copia local.

## 1. Contrato ofrecido a FAV — definido localmente; revisión con FAV pendiente

- Documentar el nuevo acuerdo: FAV también consume una API del gimnasio; Tienda administra un stock local único, independiente de sedes, recibe reposiciones y ADMIN registra ventas.
- Definidos [OpenAPI 1.0.0](contracts/openapi-fav-v1.yaml) y [guía FAV](contracts/fav-tienda.md): `GET /api/v1/consignaciones/stock`, `POST /api/v1/consignaciones/reposiciones`, `X-API-Key`, `Idempotency-Key` para el POST, modelos, reglas, ejemplos y códigos HTTP. El contrato y la guía forman parte de esta rama; aceptación de FAV, publicación del servicio y prueba conjunta pendientes.
- Conservar la misma entrega/respuesta ante repetición; clave o referencia reutilizada con datos diferentes produce conflicto. No permitir stock negativo ni agregar devoluciones o ajustes.
- **Cierre:** OpenAPI y guía coherentes, ejemplos validados y decisiones registradas. Un contrato publicado no acredita endpoints implementados.
- **Verificación documental del 06/11/2026:** YAML procesable, 40 referencias resueltas, 7 esquemas compilados y 19 ejemplos válidos; se rechazaron entradas inválidas y se comprobó que no existe el límite ficticio de veinte unidades. La verificación operativa se detalla en el paso 2.
- **Documentación:** `docs/contracts/`, ADR de la nueva responsabilidad, alcance y arquitectura. **Enunciado:** §4.1, páginas 5–6; D1/D3/D8/D9 y §3.

## 2. Stock y reposiciones de Tienda — implementado y verificado localmente

- PostgreSQL 17 con base/usuario `tienda`, elegidos por el equipo dentro de la instancia existente. Cuatro tablas propias: stock, reposiciones, ventas y operaciones idempotentes; Capas conservadas.
- Implementadas consulta/reposición FAV con clave técnica, stock/ventas ADMIN con JWT y panel. Movimientos y respuesta se guardan en una transacción; claves/referencias repetidas recuperan el resultado sin duplicar unidades. El panel conserva ventas inciertas por actor, sin JWT y sin que una respuesta tardía retire otra operación.
- **Verificación local:** 209 pruebas de regresión, 18 HTTP/PostgreSQL, compilación frontend y prueba en Chrome aprobadas. Compose/NGINX verificó base/rol de Tienda, permisos, reposiciones/ventas y replays; el navegador recuperó una venta tras perder la respuesta y recargar, sin descontarla dos veces. Se conservan los límites del balanceador durante detección y los ensayos no acreditan conexión con FAV.
- **Cierre:** resultados finales y límites en [EVIDENCIA-TIENDA](EVIDENCIA-TIENDA.md). El consumo de catálogo, aceptación de FAV, URL pública y prueba conjunta pertenecen a las etapas 3 y 9.
- **Documentación:** D3, ADR-022, contrato, arquitectura y evidencia. **Enunciado:** §2.1–2.2/2.8, §4.1 y presentación, páginas 8–9.

## 3. Consulta de productos y stock de FAV — pendiente de acuerdo externo

- Confirmar su rama vigente: `feature-inventario` ya no existe; `main` y `development` se inspeccionaron como análisis, sin elegir una unilateralmente.
- Fijar su contrato de productos y stock, URL y autenticación. Reutilizar portal → gateway → Tienda; el cliente HTTP externo pertenece a Tienda.
- **Cierre:** consulta real integrada al flujo, test de contrato, validación de respuestas, timeout y errores visibles sin inventar catálogo o stock cero. Coordinar prueba conjunta en ambos sentidos.
- **Documentación:** D9, guía de integración, configuración y evidencia de fallas. **Enunciado:** §4.1, páginas 5–6; presentación, página 8.

## 4. Cambios de membresía y mensajería — completo y verificado localmente

- ADMIN suspende una membresía elegida inmediatamente, manteniendo fechas y pagos, según decisión confirmada el 07/11. Reactivación conserva su pendiente. Comando idempotente y panel incorporados.
- Evento `MembresiaActualizada` versión 1 para suspensión mediante Outbox → RabbitMQ → Inbox, reintentos acotados y DLQ. Cancela reservas futuras afectadas y reutiliza recuperación FIFO. Proyección y bloqueo por socio evitan escrituras posteriores al consumo con evaluaciones HTTP antiguas.
- **Cierre:** comprobar cambio y evento atómicos, duplicados, caída/reinicio, reentrega, mensajes no procesables y efectos sin reservas/cupos duplicados.
- **Documentación:** D4/D5/D10, contrato versionado del evento y recuperación. **Enunciado:** §2.5, página 2; presentación, página 9; RN-R08/CA-R09 del alcance.
- **Verificación.** 12 pruebas PostgreSQL/RabbitMQ, 20 de pagos y regresión PostgreSQL aprobadas. Compose/NGINX comprobó suspensión y replay, cancelación y promoción con trabajadores reales y dos réplicas. La corrección posterior del panel aprobó 242 pruebas de regresión y compilación frontend. El equipo verificó suspensión normal, dos cupos reasignados y estado suspendido persistente con controles administrativos habilitados. El reintento con la misma clave está cubierto por pruebas automáticas. [Evidencia](EVIDENCIA-EVENTOS-MEMBRESIA.md).

## 5. Búsqueda y administración mínima de clases — completo y verificado localmente

- Conectar el FTS/GIN existente a API y portal con texto, paginación, filtros y orden; completar la publicación administrativa de clases prevista en el alcance.
- Consultar antes las reglas faltantes sobre modificaciones de clases con reservas; no introducir restricciones de reserva adicionales ni CRUD ajenos al alcance.
- **Cierre:** probar coincidencias, permisos, páginas y actualización del índice ante cambios; ensayar su mantenimiento/reconstrucción.
- **Documentación:** D6, contrato interno y criterios de aceptación. **Enunciado:** §2.2/2.6, página 2; presentación, página 9.

### Orden propuesto para el paso 5

Se reutilizan Clases y Reservas, su arquitectura Hexagonal, PostgreSQL FTS/GIN y los campos existentes de nombre, actividad, profesor, sede, inicio, fin y capacidad. Cada bloque termina con explicación del cambio, documentación y sus verificaciones antes de avanzar al siguiente.

| Bloque | Trabajo | Cómo comprobarlo |
|---|---|---|
| 5.1 Reglas confirmadas | Alta y publicación directa por ADMIN con campos obligatorios, inicio futuro, fin posterior y capacidad positiva. Edición antes del inicio, sólo sin reservas confirmadas ni espera pendiente. Filtros y órdenes confirmados. | Decisiones registradas en alcance y D6 el 07/11/2026. |
| 5.2 Backend implementado | `GET /api/v1/catalogo/clases` autenticado, FTS español, filtros, disponibilidad directa, páginas y orden. Reutiliza índice y almacenamiento propietarios. Conserva la API histórica. | 12 pruebas HTTP/PostgreSQL, 216 de regresión, compilación y Compose/NGINX aprobados. [EVIDENCIA-BUSQUEDA](EVIDENCIA-BUSQUEDA.md). |
| 5.3 Portal implementado | Texto, sede, profesor, fechas, cupo directo, orden y páginas de 20 resultados conectados a la API. Carga, vacío, error y reintento diferenciados. Reservas y espera propias independientes de la búsqueda. | 47 pruebas del cliente, 221 de regresión y 13 de búsqueda HTTP/PostgreSQL aprobadas. Recorrido en Chrome con servicios reales y base temporal. [Evidencia](EVIDENCIA-BUSQUEDA.md). |
| 5.4 Administración implementada | Publicación directa y edición ADMIN con sede validada en Accesos, versión esperada y resultado durable por administrador/clave. Panel con búsqueda y recuperación de operaciones inciertas. Edición bloqueada por inicio o inscriptos. | 230 pruebas de regresión, 11 HTTP/PostgreSQL/MongoDB y Compose/NGINX aprobados. Recorrido Chrome de publicación, pérdida/recuperación de respuesta y edición. [Evidencia](EVIDENCIA-BUSQUEDA.md). |
| 5.5 Cierre verificado | Publicación/edición por HTTP, comparación antes/durante/después de reconstruir GIN y procedimiento local de mantenimiento en D6. Recorrido por NGINX verificado. | 12 pruebas HTTP/PostgreSQL/MongoDB aprobadas. Cinco consultas comparadas, 20 lecturas completadas durante una fase real de REINDEX en dos instancias y datos de negocio conservados. Por NGINX, 16 lecturas adicionales y resultados/clase equivalentes después de reconstruir. [Evidencia](EVIDENCIA-BUSQUEDA.md). |

**Reglas acordadas el 07/11/2026.** ADMIN completa nombre, actividad, profesor, sede, inicio, fin y capacidad, y publica directamente. Inicio futuro, fin posterior y capacidad entera positiva. Se permite editar esos datos antes del inicio únicamente sin reservas confirmadas ni espera pendiente. Búsqueda por texto en nombre/actividad/profesor, sede, profesor y rango de inicio, con filtro de cupo directo que respeta FIFO. Orden por inicio ascendente/descendente o relevancia con texto. Nivel/categoría conserva su pendiente de definición para una ampliación. Administración implementada en el bloque 5.4. Sus versiones e idempotencia son controles técnicos para concurrencia y reintentos.

**Cierre del paso 4.** El equipo comprobó la suspensión normal. La prueba de respuesta perdida reveló un bloqueo de controles, corregido con plazo máximo, consultas disponibles y aviso de recuperación enfocado. Las capturas posteriores mostraron ambos cupos reasignados y el panel administrativo sin aviso pendiente, con controles habilitados. El equipo confirmó que la membresía seguía suspendida. Las pruebas automáticas verifican reintento con ruta, cuerpo y clave originales. Las APIs y trabajadores reales se verificaron en Compose. [Detalle y reproducción](EVIDENCIA-EVENTOS-MEMBRESIA.md). Los avisos previos de dependencias permanecen en la revisión final de la etapa 9.

### Continuación después del paso 5

El retiro de espera y el recorrido propio del paso 6 están verificados. Continúan la revisión administrativa y sus políticas pendientes, las fuentes y conexión Car Cruds del paso 7, observabilidad/fallas del paso 8 y despliegue/cierre del paso 9. La conexión de FAV del paso 3 se retoma cuando estén confirmados contrato y acceso. Las definiciones económicas, de alojamiento y de servicios externos se consultan antes de sus implementaciones dependientes.

## 6. Cierre del recorrido del socio — retiro verificado localmente; políticas administrativas pendientes

- Retiro de espera implementado antes del inicio, con historial e idempotencia por ID de entrada. Si la promoción ganó, responde 409 y actualiza «Mis Reservas» para una cancelación explícita. Reglas previamente confirmadas.
- Verificadas 239 pruebas de regresión, 17 HTTP/PostgreSQL/MongoDB, compilación frontend y NGINX. Incluyen propietario, reintentos, límite exacto, rollback y carrera de promoción. Chrome verificó retiro desde ambas vistas, respuesta perdida, nueva inscripción, promoción ganadora y cancelación explícita. [D4 y evidencia](adr/ADR-017-consistencia-y-recuperacion-de-espera.md).
- Revisar los flujos administrativos y propios existentes; resolver reactivación/superposición solo cuando el equipo confirme su política. No rehacer pagos ni reservas.
- **Cierre:** pruebas de propietario, repetición, límite temporal y carrera con promoción; recorrido web sin botones que simulen éxito.
- **Documentación:** alcance, contrato y limitaciones. **Enunciado:** frontend completo, página 8; reglas acordadas del proyecto.

## 7. Car Cruds y fuentes mensuales — pendiente de cierre

- Conservar su cliente, vínculo y envío durable independientes de FAV. Conectar los hechos comprobables de pagos e ingresos, respetando propietarios, período, corte y fotografía inmutable.
- Acordar lo económico aún abierto antes de calcularlo; no inferir asistencia desde reservas ni convertir información desconocida en cero. Obtener URL/token por canal privado.
- **Cierre:** prueba conjunta de lectura, vínculo, envío/repetición, conflicto, corte mensual y caída/recuperación, conservando referencia, versión y `observedAt` al reintentar.
- **Documentación:** ADR-018 y guía de contratos; corregir textos viejos que confunden módulos implementados con hechos aún no integrados. **Enunciado:** §4.1.

## 8. Observabilidad y fallas — pendiente de completar

- Reutilizar logs, trazas y métricas; completar tablero, alerta y cobertura de dependencias relevantes. Confirmar objetivos/canal antes de presentarlos como compromisos.
- **Cierre:** seguir una operación entre servicios y observar estado general, caché, réplicas y errores; provocar fallas y registrar recuperación real.
- **Documentación:** D10/D11/D12 y POSTMORTEM. **Enunciado:** §2.9–2.10, página 3; defensa individual, página 9.

## 9. Despliegue, evidencia y revisión final — pendiente

- Consultar alojamiento/presupuesto, desplegar la capacidad en nube con URL pública y secretos fuera del repositorio; coordinar conectividad con ambos grupos.
- Ejecutar regresión integrada, contratos, consistencia/concurrencia, carga y fallas; analizar capacidad/costos y revisar la frescura de ocupación con el negocio sin rehacer Redis.
- Revisar los avisos previos de dependencias Fastify/fast-uri detectados el 07/11 y verificar su actualización antes del cierre.
- **Cierre:** frontend hasta las capacidades compartidas, servicios y dos almacenamientos operativos, caché medida, búsqueda, evento y pruebas conjuntas; documentación sin contradicciones y limitaciones explícitas.
- Actualizar diagramas e índice ADR conservando decisiones reemplazadas. Revisar cambios y pruebas antes de la PR; la versión evaluable debe quedar en `main`.
- **Documentación:** README, alcance, arquitectura, D13 y evidencia. **Enunciado:** §2.11–2.12/§3, páginas 3–4; presentación y defensa, páginas 8–9.

## Límites y dependencias

No se agregan pasarela, factura fiscal, devoluciones, ajustes, stock por sede, consignaciones adicionales ni CRUD nuevos ajenos al alcance. Pendientes de consulta: rama/contratos/URL/credenciales de FAV, conexión Car Cruds, políticas comerciales abiertas y alojamiento. La persistencia de Tienda ya se acordó e implementó con PostgreSQL. Mientras una etapa dependa de respuestas externas, solo se avanza con trabajo independiente acordado.
