# Plan de cierre de entrega 3

**Estado.** 11/11/2026. El gimnasio está desplegado por HTTPS en Azure. Se verificó el recorrido principal con FAV en ambos sentidos y el equipo confirmó la conexión con Car Cruds. Las correcciones de demostración, sedes y reportes están verificadas localmente en `fix/datos-demostracion`, pendientes de publicación y actualización de la VM. Las políticas administrativas y económicas abiertas se detallan en los pasos 6 y 7.
**Referencia:** presentación grupal, páginas 8–9 del enunciado. La defensa individual de la página 9 tiene verificaciones adicionales, identificadas abajo.

**Correcciones verificadas el 10/11/2026.** Fin de mes con regla confirmada, duración contractual durable para Car Cruds y costo desconocido ante datos históricos incompletos o fracciones. El descubrimiento de pruebas excluye el lanzador de carga. Balanceo genera su credencial de Grafana y reconoce sus volúmenes al limpiar. Aprobaron 278 pruebas de regresión/cobertura, 21 de PostgreSQL y el ensayo de balanceo con limpieza. La compilación frontend aprobó 41 módulos. Se mantienen los cuatro 504 transitorios durante detección de una réplica caída. [Detalle y límites](EVIDENCIA-MEMBRESIAS.md#correcciones-verificadas-el-10112026).

## Forma de trabajo

Completar una etapa por vez: explicar el cambio, modificar lo mínimo necesario, actualizar su documentación, ejecutar las pruebas pertinentes y revisar el resultado con el equipo. Consultar las decisiones de negocio o datos externos faltantes; no deducirlos del código de otro grupo. Este backlog no autoriza implementar todos los pasos juntos ni publicar cambios.

## 0. Base actual — verificada

Se conservaron pagos/planes/membresías, reservas/FIFO, Accesos con MongoDB, caché Redis medida, JWT, balanceo y Car Cruds. El 06/11/2026 se verificaron **196/196 pruebas** y compilación frontend de **35 módulos** después de actualizar la copia local.

## 1. Contrato ofrecido a FAV — publicado y verificado

- Documentar el nuevo acuerdo: FAV también consume una API del gimnasio; Tienda administra un stock local único, independiente de sedes, recibe reposiciones y ADMIN registra ventas.
- Definidos [OpenAPI 1.0.0](contracts/openapi-fav-v1.yaml) y [guía FAV](contracts/fav-tienda.md) con las operaciones de stock y reposición, autenticación e idempotencia. FAV envió reposiciones a la API publicada en Azure.
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

## 3. Consulta de productos de FAV y compra de socios — verificado en Azure

- Tienda consume el [contrato de FAV 1.2.0](contracts/fav-catalogo-pedidos-1.2.0.openapi.yaml) desde su backend. El flujo pasa del portal al gateway, a Tienda y a FAV.
- El catálogo cruza los productos de FAV con el stock consignado local. Los socios compran desde la web con precio tomado en el servidor y descuento atómico e idempotente. Protección: timeout, reintento, circuit breaker y caché degradada. [ADR-023](adr/ADR-023-compra-de-socios-en-tienda.md), [ADR-024](adr/ADR-024-circuit-breaker-fav.md) y contrato propio [openapi-tienda-socios-v1.yaml](contracts/openapi-tienda-socios-v1.yaml).
- **Verificación:** test de contrato del cliente contra el OpenAPI fijado; tests del circuito, del catálogo degradado y de las compras; `npm run test:tienda` con PostgreSQL real y dos instancias, donde 10 compradores simultáneos por la última unidad dan exactamente una compra.
- **Revisión del 10/11/2026.** Se creó `feat/conexion-fav` desde `main` actualizado tras la PR #9. La URL pública comunicada por FAV responde. Su contrato 1.2.0 conserva el esquema del catálogo 1.1.0 fijado y su cliente ya distingue rechazos, conflictos y resultados inciertos de reposiciones. Compilación y 27 pruebas de Tienda aprobadas.
- **Prueba conjunta.** En Azure, Tienda devolvió `200` con `origen: FAV` y dos productos con stock local. El equipo confirmó dos reposiciones enviadas desde FAV y el gateway registró una compra con `201`. [Evidencia](EVIDENCIA-TIENDA.md#prueba-conjunta-en-azure-del-10112026).

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

El retiro de espera y el recorrido propio del paso 6 están verificados. Continúan las políticas administrativas pendientes. La conexión real con Car Cruds fue confirmada por el equipo. Los pasos 8 y 9 registran la verificación de observabilidad y el despliegue.

## 6. Cierre del recorrido del socio — retiro verificado localmente; políticas administrativas pendientes

- Retiro de espera implementado antes del inicio, con historial e idempotencia por ID de entrada. Si la promoción ganó, responde 409 y actualiza «Mis Reservas» para una cancelación explícita. Reglas previamente confirmadas.
- Verificadas 239 pruebas de regresión, 17 HTTP/PostgreSQL/MongoDB, compilación frontend y NGINX. Incluyen propietario, reintentos, límite exacto, rollback y carrera de promoción. Chrome verificó retiro desde ambas vistas, respuesta perdida, nueva inscripción, promoción ganadora y cancelación explícita. [D4 y evidencia](adr/ADR-017-consistencia-y-recuperacion-de-espera.md).
- Revisar los flujos administrativos y propios existentes; resolver reactivación/superposición solo cuando el equipo confirme su política. No rehacer pagos ni reservas.
- **Cierre:** pruebas de propietario, repetición, límite temporal y carrera con promoción; recorrido web sin botones que simulen éxito.
- **Documentación:** alcance, contrato y limitaciones. **Enunciado:** frontend completo, página 8; reglas acordadas del proyecto.

## 7. Car Cruds y fuentes mensuales — implementado; conexión confirmada por el equipo

**09/11/2026:** el informe mensual completa los tres hechos según ADR-018. El contrato vigente es 0.4.0 y conserva el cuerpo mensual del perfil anterior.
- `used`: ingresos aceptados en Accesos, mediante el endpoint interno `GET /internal/v1/accesos/uso` con `X-Service-Key`.
- `costMinor`: importe del único plan confirmado que cubre el mes completo, dividido por los meses contratados; un mes parcial o ambiguo queda `null`.
- `spendingMinor`: pagos confirmados del mes hasta el corte.

Si Accesos no responde, `used` queda en `null` y el informe se genera igual. El test de contrato `car-cruds-campos.test.mjs` valida el payload completo contra el OpenAPI fijado. La URL y el token están configurados en el entorno de Azure y el equipo confirmó la conexión con Car Cruds. [Registro operativo](contracts/README.md#estado-de-la-conexión-en-azure).

- **Implementado.** Cliente, vínculo y envío durable independientes de FAV, con fuentes de pagos e ingresos, período, corte y fotografía inmutable.
- **Reglas económicas abiertas.** Meses parciales y fracciones de centavo conservan `null` hasta acordar su imputación.
- **Verificación.** Conexión desde Azure confirmada por el equipo. Las pruebas automáticas cubren lectura, vínculo, envío/repetición, conflicto, corte mensual y recuperación, conservando referencia, versión y `observedAt`. El procedimiento para repetir ensayos coordinados con el proveedor está en [DEPLOY](DEPLOY.md#prueba-conjunta-con-car-cruds).
- **Documentación.** ADR-018, guía de contratos y diagramas actualizados. Corresponde a §4.1 del enunciado.

## 8. Observabilidad y fallas — completo (09/11/2026)

**Hecho:**
- Prometheus, Grafana (tablero **Gimnasio · Estado general**) y 5 reglas de alerta con objetivo de servicio (D11).
- Simulacro de caída y lentitud de FAV con detección por alerta en 25 s ([POSTMORTEM](POSTMORTEM.md)).
- Rate limiting y JWT en el gateway (ADR-025).

Texto original del paso:


- Reutilizar logs, trazas y métricas; completar tablero, alerta y cobertura de dependencias relevantes. Confirmar objetivos/canal antes de presentarlos como compromisos.
- **Cierre:** seguir una operación entre servicios y observar estado general, caché, réplicas y errores; provocar fallas y registrar recuperación real.
- **Documentación:** D10/D11/D12 y POSTMORTEM. **Enunciado:** §2.9–2.10, página 3; defensa individual, página 9.

## 9. Despliegue, evidencia y revisión final — publicado en Azure

**Hecho el 09/11/2026:**
- Despliegue en VM listo ([DEPLOY](DEPLOY.md), ADR-026): `compose.prod.yaml`, Caddy con HTTPS y `scripts/desplegar-vm.sh`.
- Test de carga k6 con análisis de capacidad ([EVIDENCIA-CARGA](EVIDENCIA-CARGA.md)).
- Cobertura con umbrales ([EVIDENCIA-COBERTURA](EVIDENCIA-COBERTURA.md)).
- AsyncAPI del evento.

**Car Cruds.** Acceso configurado en la VM y conexión confirmada por el equipo. El gimnasio desplegado utiliza el contrato de referencia 0.4.0. [Estado de verificación](contracts/README.md#estado-de-la-conexión-en-azure).

**Hecho el 10/11/2026.** Se desplegó el gimnasio en Azure Chile Central. El portal, `/health` y el estado de Grafana devolvieron `200` por HTTPS. [URLs públicas](DEPLOY.md#4-urls-a-publicar).

Texto original del paso:


- Consultar alojamiento/presupuesto, desplegar la capacidad en nube con URL pública y secretos fuera del repositorio; coordinar conectividad con ambos grupos.
- Ejecutar regresión integrada, contratos, consistencia/concurrencia, carga y fallas; analizar capacidad/costos y revisar la frescura de ocupación con el negocio sin rehacer Redis.
- Revisar los avisos previos de dependencias Fastify/fast-uri detectados el 07/11 y verificar su actualización antes del cierre.
- **Cierre:** frontend hasta las capacidades compartidas, servicios y dos almacenamientos operativos, caché medida, búsqueda, evento y pruebas conjuntas; documentación sin contradicciones y limitaciones explícitas.
- Actualizar diagramas e índice ADR conservando decisiones reemplazadas. Revisar cambios y pruebas antes de la PR; la versión evaluable debe quedar en `main`.
- **Documentación:** README, alcance, arquitectura, D13 y evidencia. **Enunciado:** §2.11–2.12/§3, páginas 3–4; presentación y defensa, páginas 8–9.

## Límites y dependencias

**Revisión del 11/11/2026.** La rama `fix/datos-demostracion` desactiva la carga automática de demostración por defecto y configura las sedes Córdoba, San Francisco y Hernando. Panel principal, Caja y Reportes obtienen agregados completos desde cada servicio, con calendario argentino e importes por moneda. Se actualizaron contratos, estados documentales y referencias del enunciado. Pasaron 288 pruebas de regresión y 7 de reportes con HTTP/PostgreSQL, además de compilar el frontend. Quedan pendientes publicar estas correcciones, revisar y limpiar los registros de demostración existentes preservando el historial de integración, y completar el presupuesto efectivo de Azure en D13.

El [procedimiento de actualización](DEPLOY.md#actualizar-la-vm-existente) documenta respaldo, versión publicada, configuración, limpieza selectiva y comprobaciones del portal. El equipo confirmó Standard B2s v2, 2 vCPU, 8 GiB y una estimación de cómputo de 84,68 USD/mes. D13 incorpora esos datos y conserva pendientes disco, IP y consumo adicional. Los resultados de despliegue, limpieza y revisión visual se registrarán al ejecutar esa etapa.

La revisión documental comprobó los enlaces locales de la documentación y las referencias internas de 13 contratos sin destinos ausentes. La configuración Compose de producción validó con el dominio público configurado y `git diff --check` aprobó.

El alcance conserva pagos manuales con comprobantes internos y una única tienda con PostgreSQL, reposiciones y ventas. Las políticas comerciales abiertas siguen identificadas en los pasos 6 y 7. Las conexiones con FAV y Car Cruds están documentadas junto con sus verificaciones.
