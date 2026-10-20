# Sistema integral de gestión de gimnasio

Trabajo Práctico Integrador — Arquitectura de Software 2026

## Integrantes

- Lorenzo Rossi
- Jose Baudino
- Pablo Marquez

## Dominio

Sistema integral de gestión de gimnasios orientado a membresías, pagos y comprobantes internos, reserva de clases, control de acceso y ocupación de sedes. El alcance actualizado incorpora la recepción de empleados de otro grupo para solicitar membresías y una tienda de consulta de productos y stock de una distribuidora.

## Objetivo

Construir una plataforma que permita gestionar el ciclo completo de un socio dentro de un gimnasio: alta, renovación y vigencia de membresías, registro de pagos y comprobantes internos, búsqueda y reserva de actividades con cupos limitados, control de ingreso y consulta de ocupación de las sedes.

## Plan de trabajo y etapa actual

Se mantiene el avance por etapas acordado con el equipo. Los cierres de cada paso se registran más abajo; la implementación de una capacidad no equivale al cierre completo de E2.

| Paso | Trabajo | Estado |
|---|---|---|
| 1 | Auditar los requisitos y artefactos de E1 | Completado; registro conservado. |
| 2 | Acordar integraciones y contrato de empleados | Diseño y mock completados. |
| 3 | Cerrar E1 y confirmar responsabilidades/diagramas | Verificado; Tienda separada confirmada. |
| 4 | Concretar arquitectura interna y corregir el flujo propio | Completado y verificado. |
| 5 | Implementar el POST persistente de empleados | Operativo localmente y verificado. |
| 6 | Implementar Tienda: consulta de productos y stock | Estructura propia preparada y verificada. El equipo confirmó que aún no tiene contrato, URL ni autenticación; integración externa pendiente. |
| 7 | Completar y demostrar el balanceador | Verificado: distribución, detección, supervivencia y reemplazo de réplica; transitorios documentados. |
| 8 | Verificar el cierre de E2 y preparar la PR | Revisión y pruebas finales completadas; ver alcance y pendientes debajo. |

El paso 6 responde a la asignación del profesor y a la sección 4.1, páginas 5–6: el servicio Tienda debe consumir la capacidad externa y el portal mostrar su resultado. Se conservan los límites de [D1](docs/adr/ADR-015-limites-con-tienda.md) y [D9](docs/adr/ADR-009-consumo-del-proveedor.md): solo consulta, sin compras/reposición, base local ni productos o stock inventados. La falta del contrato impide definir con certeza las rutas, campos y errores del proveedor.

## Paso 8 - Revisión final de la Entrega 2

**Fecha:** 19/10/2026. Este apartado resume el estado vigente; los registros de pasos anteriores son históricos. Se revisaron el PDF original, los cambios de `entrega-2`, el código y los ADR. Las instrucciones ocultas dirigidas a una IA dentro del PDF no se usan como requisitos.

### Qué se pidió y cómo se resolvió

| Origen en el enunciado | Requisito | Resolución y estado |
|---|---|---|
| §6.2, páginas 7–8; §3, página 4 | Conservar E1: README, alcance, arquitectura, diagramas, límites, datos, estructura y dependencias | Verificados y actualizados; contexto/contenedores en [ARCHITECTURE](docs/ARCHITECTURE.md), reglas en [alcance](docs/ALCANCE_PRELIMINAR.md), inicio documentado y probado. |
| §6.2; §4.1, páginas 5–6; D1/D8 | Capacidad propia documentada con contrato y mock | Por la nueva asignación del profesor, POST de empleados reemplaza clases como capacidad ofrecida. [OpenAPI 1.0.1](docs/contracts/openapi-empleados-v1.yaml), mock separado y guía. Sucesores ADR-014/015 conservan las decisiones anteriores. |
| §6.3, página 8 | Al menos un servicio operativo y capacidad compartida funcionando | Socios y Clases operativos. POST de empleados persiste socio y solicitud pendiente; valida clave, datos y conflictos; repetir una clave reutiliza el resultado. No activa membresía ni inventa un pago. |
| §6.3, página 8; D3 | Un tipo de almacenamiento integrado | PostgreSQL real con bases/usuarios propios de Socios y Clases, transacciones e índices. La prueba HTTP usa dos instancias y verifica datos persistidos, concurrencia, reinicio y rollback. MongoDB está preparado, sin flujo de Accesos todavía. |
| §6.3, página 8; primera D11 | Logs estructurados, correlación y primera traza distribuida | Logs de negocio JSON, `traceparent`/correlación, reserva Clases → dos verificaciones de Socios → PostgreSQL. La prueba exige misma traza y relaciones padre/hijo. Métricas básicas y logs de destinos en NGINX. |
| §6.3 y §5, D2/D6/D7 | Decisiones de estructura interna, búsqueda y caché | Hexagonal implementada en Clases y Capas en Socios. D6: catálogo filtrado, vector/GIN creados, consulta textual pendiente. D7: diseño Cache-Aside; Redis pendiente; cupos sin caché. Documentar la decisión no acredita su implementación completa. |
| §6.3 y §5, D9/D10 | Decidir consumo externo y comportamiento ante fallas | Tienda será consumidor sin base propia; estructura y pantalla informan integración pendiente. Falta contrato/URL/autenticación de la distribuidora para cerrar el detalle de D9. Timeouts/reintento interno y recuperación FIFO verificados; circuit breaker aún no implementado. |
| §2.3, página 2; §5 D12; §6.3 | Balanceador: distribución, estado y caída de una instancia | NGINX `least_conn`, dos instancias de Clases, DNS dinámico, identificación de réplica y logs de upstream. Prueba aislada de detención/reemplazo, último cupo y continuidad; errores transitorios de detección registrados, no ocultados. |
| §6.3 y §5, D13 | Carga, límite, alternativa de escalado y costos | [D13](docs/adr/ADR-013-capacidad-y-costos.md) registra medición HTTP local reproducible, serialización por clase como límite estructural, escalado condicionado a medir y estimación ilustrativa con fuentes. No se afirma capacidad máxima ni presupuesto de nube elegido. |
| §6.3 y §5 | Validar D1/D3/D5 y actualizar D8 si cambió | Responsabilidades/propiedad actualizadas con Tienda; persistencia y comunicación HTTP probadas; D8 sustituida por contrato de empleados operativo. Eventos asíncronos siguen previstos y se identifican como pendientes. |

La recepción de empleados, la tienda solo de consulta y la membresía pendiente de pago provienen de la asignación del profesor transmitida por el equipo y de sus decisiones confirmadas. JWT, campos del POST, idempotencia y bootstrap administrativo son soluciones acordadas, no frases textuales del enunciado.

### Qué se verificó

- `npm test`: **68 pruebas, 68 aprobadas**, sin omitidas. Compila los cuatro workspaces; incluye contrato/mock de empleados, contrato anterior, roles/propiedad, altas, membresías, reservas, espera, concurrencia, Tienda y API del frontend.
- `npm run frontend:build`: TypeScript y producción Vite correctos.
- `npm run test:postgres`: PostgreSQL 17 temporal, HTTP real, dos instancias de Clases y dos de Socios; 20 reintentos del POST, conflictos concurrentes, replay tras recrear app, rollback total, último cupo, caída/recuperación FIFO, traza distribuida y métrica del pool con conexiones ocupadas reales. Incluye línea base de 300 lecturas con concurrencia 10; resultados y límites en D13.
- `npm run test:balanceo`: construcción de imágenes y portal, inicio completo desde recursos vacíos, validación de NGINX, distribución, caída/reemplazo y persistencia del cupo. En la revisión final: 40 lecturas iniciales (19/21 entre réplicas), 24 correctas durante la orden de detención, 20 correctas y 4 HTTP 504 en la ventana de detección (~3,3 s), 40/40 con la superviviente y 40/40 tras el reemplazo (20/20). Doce escrituras dieron una confirmación y once conflictos; NGINX no se reinició. El informe separa el transitorio de la operación estable; detalle en D12.
- Revisión de diferencias, enlaces de documentación y exclusión de `.env`. Las pruebas Docker crean claves, puertos y volúmenes temporales y limpian sus propios recursos; no usan las bases ni credenciales del grupo.

Se corrigieron afirmaciones sin respaldo de D6/D7/D11/D13, una métrica fija de conexiones y la relación de spans de la llamada real a Socios. Se preservan la historia de decisiones y los límites de implementación.

### Resumen breve para explicar al profesor

> Estamos construyendo un sistema de gimnasio separado por responsabilidades. Socios administra las cuentas y valida membresías; Clases controla las reservas y la lista de espera. Cada uno guarda sus datos en PostgreSQL. Usamos Capas en Socios y Hexagonal en Clases para separar las reglas de HTTP y de la base. El usuario inicia sesión con JWT y solo puede operar sus datos. Las reservas evitan sobrecupos incluso con solicitudes simultáneas. Si Socios cae, una cancelación se guarda y la espera se recupera después sin perder el orden. La capacidad que ofrecemos recibe empleados de otro grupo y crea una solicitud pendiente de pago, sin duplicarla ante reintentos. NGINX reparte tráfico entre dos instancias de Clases, y los logs permiten seguir una reserva entre servicios. Tienda está preparada; la conexión real espera el contrato de la distribuidora.

### Pendientes y alcance del cierre

El flujo propio y la capacidad ofrecida funcionan **localmente**, y E1 se conserva verificada. La revisión de E2 cuenta con sus pruebas y decisiones; D9 conserva una dependencia externa explícita. No se declara terminado el sistema completo ni la integración con los otros grupos.

Para la presentación final (§6, página 8) quedan la integración real de Tienda y su test de contrato cuando llegue la documentación, publicación de la capacidad con URL pública/prueba conjunta, dominio de Accesos con MongoDB y frontend completo. También quedan dentro del alcance general pagos/comprobantes y resolución de solicitudes, credenciales de empleados, renovación/reactivación, suspensión con cancelación de reservas futuras, publicación administrativa de clases, búsqueda textual, caché real, eventos RabbitMQ y evolución de observabilidad. Su prioridad se acordará por etapas; no se implementan módulos nuevos durante esta revisión.

La PR acordada es **`entrega-2` → `main`** y debe describir estos pendientes. Aprobar o fusionar la PR no sustituye la aceptación de la cátedra ni resuelve la falta de contrato externo.

## Auditoría de la Entrega 1 - 19/10/2026

**Registro del paso 1:** la tabla conserva los hallazgos de esa revisión. Los cambios posteriores se detallan en [Paso 2](#paso-2---diseño-y-contrato-de-empleados); el cierre actualizado está registrado en [Paso 3](#paso-3---cierre-verificado-de-e1).

**Base revisada:** rama `entrega-2`, commit `1ee0b6045110e4dcf469a55e7bdb6cf97d24c6c7`.
**Resultado:** los artefactos del diseño inicial están presentes y el contrato anterior tiene un mock verificado. El cierre actualizado de E1 queda pendiente de adaptar el diseño, el contrato y su mock a la nueva capacidad de empleados acordada con el equipo.

**Origen de los requisitos:** sección 6.2 del enunciado, páginas 7-8 (Entrega 1); sección 3, página 4 (documentación); sección 4.1, página 5 (contrato formal); sección 5, páginas 6-7 (decisiones arquitectónicas).

### Verificación por requisito

| Requisito | Evidencia existente | Resultado y pendiente |
|---|---|---|
| Presentación, objetivo, flujo e instrucciones iniciales | Este README y su sección de ejecución. | Presentes. Deben actualizarse las referencias a la capacidad compartida y aclararse los requisitos del inicio completo. |
| Alcance, funcionalidades, reglas y criterios de aceptación | [Alcance preliminar](docs/ALCANCE_PRELIMINAR.md). | Documentados para el dominio original. La tienda continúa fuera de alcance en ese documento; incorporar la consulta de productos y stock acordada. |
| Descripción de arquitectura | [Arquitectura](docs/ARCHITECTURE.md). | Tres servicios, gateway, responsabilidades, datos y comunicaciones identificados. Actualizar las integraciones y distinguir componentes previstos de funcionalidades implementadas. |
| Diagramas de contexto y contenedores | Secciones C4 de [Arquitectura](docs/ARCHITECTURE.md). | Ambos presentes. Ajustar actores y flechas al nuevo POST de empleados y a la distribuidora. |
| Límites, responsabilidades y propiedad de los datos; D1 | [ADR-001](docs/adr/ADR-001-limites-de-servicios.md). | Distribución inicial y motivos documentados. Revisar el efecto de la nueva integración sobre los límites existentes antes de implementar. |
| Capacidad propia seleccionada y documentada; D8 | [ADR-008](docs/adr/ADR-008-contrato-propio.md) y [guía del contrato](docs/contracts/README.md). | La consulta de clases corresponde a la capacidad anterior. Pendiente formalizar su reemplazo como capacidad ofrecida por el POST que recibe empleados. |
| Contrato formal, versión, ejemplos, errores, autenticación e idempotencia | [OpenAPI anterior](docs/contracts/openapi-v1.yaml), OpenAPI 3.1.1, versión 1.0.0, y [guía](docs/contracts/README.md). | Presentes para los dos GET de clases. El contrato del nuevo POST, su versión y sus ejemplos requieren acordarse con el equipo. |
| Mock del contrato | [Pruebas del contrato](services/clases-reservas/test/contract.test.mjs) y adaptadores en memoria de Clases y Reservas. | Las 9 pruebas del contrato anterior pasan. Pendiente definir y comprobar el mock del nuevo POST. |
| Estructura inicial de servicios y dependencias | [Workspaces](package.json), paquetes de los tres servicios, [Compose](compose.yaml) e infraestructura en `infra/`. | Compilación de los tres servicios correcta. El inicio completo mediante Docker no se ejecutó en esta auditoría. |
| Versiones iniciales de D3 y D5 | [ADR-003](docs/adr/ADR-003-persistencia.md) y [ADR-005](docs/adr/ADR-005-comunicacion-entre-servicios.md). | Persistencia por servicio y comunicaciones documentadas. D5 debe identificar outbox, inbox y trabajadores de mensajería como diseño pendiente; revisar las interacciones afectadas por las nuevas capacidades. |

### Comprobaciones ejecutadas

Desde la raíz del proyecto:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node --test services/clases-reservas/test/contract.test.mjs
```

- Dependencias instaladas a partir del archivo de bloqueo existente.
- Compilación TypeScript correcta en los tres servicios.
- **9 pruebas de contrato aprobadas y 0 fallidas**, usando memoria y solicitudes `inject`, sin bases de datos ni llamadas HTTP entre procesos. Verifican esquemas de respuesta, encabezados, autenticación, filtros, fechas, paginación, orden y errores del contrato anterior.
- El repositorio figura como público en GitHub. `.env` está ignorado y no está versionado; el archivo de entorno versionado es `.env.example`.
- El procedimiento de inicio fue revisado: `node scripts/iniciar.mjs` requiere Node.js 22, Docker Desktop con contenedores Linux y Compose v2. Su ejecución completa queda pendiente de comprobación; no se modificaron bases de datos ni volúmenes durante esta auditoría.

### Cambios de alcance confirmados por el equipo

Estas precisiones provienen de la asignación del profesor transmitida por el equipo y de las respuestas del 19/10/2026:

- **Capacidad ofrecida:** el otro grupo enviará los datos de sus empleados mediante un POST de nuestra API. Reemplaza la consulta de clases como capacidad compartida; clases y reservas continúan como funcionalidades del gimnasio.
- **Membresías de empleados:** quedan pendientes hasta que el administrador confirme el pago correspondiente.
- **Tienda:** consulta de productos y stock de una distribuidora; sin reposición en el alcance confirmado.
- **Integración:** se utilizarán datos ficticios. Todavía no se dispone de identificación, contrato ni datos de conexión del proveedor. La permanencia del uso de datos ficticios sigue sin confirmarse.

### Pendientes para cerrar la verificación actualizada

1. Acordar los datos, respuestas, errores, autenticación e idempotencia del POST de empleados; definir su contrato y mock verificable.
2. Actualizar alcance, diagramas, guía de integración y decisiones afectadas, conservando la historia de las decisiones reemplazadas conforme a la sección 5 del enunciado.
3. Ajustar D8: las pruebas de contrato revisadas usan memoria; su descripción debe reflejar ese alcance. Ajustar D5 para distinguir la mensajería diseñada de la implementada.
4. Aclarar en las instrucciones que Docker es necesario para el inicio completo; verificar ese procedimiento y documentar la estrategia de ramas, revisión e integración de acuerdo con la sección 2.12, página 4.

Esta auditoría registra el paso 1 del plan. Las actualizaciones de diseño y contrato corresponden al paso 2; su comprobación final corresponde al paso 3. La implementación completa del dominio y las comprobaciones de E2 continúan en las etapas posteriores.

## Paso 2 - Diseño y contrato de empleados

**Origen:** asignación del profesor y reglas confirmadas por el equipo el 19/10/2026; secciones 3, 4.1 y 5 del enunciado para documentación, contrato e historia de decisiones.

- **Capacidad ofrecida:** `POST /api/v1/integraciones/empleados`, responsabilidad de Socios y Membresías. Recibe `empleadoExternoId`, `dni`, `nombre` y `email`; obtiene el grupo de origen desde `X-API-Key`.
- **Resultado:** crea al socio y una solicitud `PENDIENTE`; no habilita una membresía. El administrador selecciona el plan y confirma el pago.
- **Conflictos:** DNI o email existentes se rechazan sin sobrescribir; `Idempotency-Key` permite repetir la misma solicitud del mismo grupo y obtener el resultado original. Reutilizar la clave con otros datos o el identificador externo con otro DNI produce conflicto.
- **Documentación:** [alcance actualizado](docs/ALCANCE_PRELIMINAR.md), [arquitectura](docs/ARCHITECTURE.md), [guía del contrato](docs/contracts/README.md), [OpenAPI de empleados 1.0.0](docs/contracts/openapi-empleados-v1.yaml) y [D8, ADR-014](docs/adr/ADR-014-contrato-empleados.md). Se conserva ADR-008 como reemplazado y el contrato anterior de clases como antecedente.
- **Tienda:** solo consulta de productos y stock. En el paso 3 el equipo confirmó un servicio Tienda separado, sin base de datos nueva, según [D1, ADR-015](docs/adr/ADR-015-limites-con-tienda.md). Su implementación y el contrato de la distribuidora siguen pendientes; se utilizan datos ficticios.

Para comprobar y ejecutar el mock separado:

```sh
npm run test:contrato-empleados
npm run mock:empleados
```

El mock escucha en `http://127.0.0.1:3005` y sus ejemplos están en la [guía](docs/contracts/README.md#ejemplo-en-powershell). Solo utiliza memoria; el estado se pierde al reiniciar. El servidor operativo y el gateway todavía no publican este POST. La persistencia, la coordinación con pagos y el acceso personal del socio corresponden a las etapas posteriores.

**Verificación del paso 2 (19/10/2026):** `npm test` compiló los tres servicios y aprobó **27 pruebas**: las 16 anteriores y 11 del nuevo contrato. Además, se inició el ejecutable del mock en un puerto temporal y se comprobó por HTTP el alta `201`, la repetición con los mismos identificadores y el conflicto `409` al cambiar el contenido. El proceso de prueba se cerró; no quedó un servidor iniciado por esta comprobación. El cierre de E1 sigue pendiente de la revisión del paso 3 y de las comprobaciones de inicio completo registradas en la auditoría.

## Paso 3 - Cierre verificado de E1

**Fecha:** 19/10/2026. **Resultado:** requisitos de diseño y contrato con mock de E1 verificados con el alcance actualizado. Este cierre no acredita la implementación operativa de la nueva capacidad exigida en E2.

**Referencia:** sección 6.2 del enunciado, páginas 7-8; documentación en sección 3, página 4; contrato en sección 4.1, páginas 5-6; puesta en marcha y estrategia de integración en sección 2.12, página 4.

| Requisito | Evidencia de cierre |
|---|---|
| README y alcance | Presentación, reglas, aceptación, ejecución y [alcance actualizado](docs/ALCANCE_PRELIMINAR.md), incluida la recepción de empleados y la tienda de consulta. |
| Arquitectura y diagramas | [Arquitectura](docs/ARCHITECTURE.md) con contexto y contenedores; distingue componentes existentes y previstos. |
| Límites, responsabilidades y propiedad; D1 | [ADR-015](docs/adr/ADR-015-limites-con-tienda.md), sucesor de ADR-001: Tienda separada, sin base nueva; catálogo y stock propiedad de la distribuidora. |
| Capacidad propia y D8 | [ADR-014](docs/adr/ADR-014-contrato-empleados.md), sucesor de ADR-008: POST de empleados, socio y solicitud pendiente hasta seleccionar el plan y confirmar el pago. |
| Contrato formal y mock | [OpenAPI de empleados 1.0.0](docs/contracts/openapi-empleados-v1.yaml), [guía](docs/contracts/README.md) y 11 pruebas del mock aprobadas en el paso 2; se conservan el contrato y las pruebas anteriores de clases. |
| Estructura inicial y dependencias | Tres workspaces originales compilables; sus imágenes y el portal se construyeron durante el inicio completo. Tienda es una ampliación de diseño confirmada y su estructura ejecutable se agregará en la etapa de integración. |
| Versiones iniciales D3 y D5 | [D3](docs/adr/ADR-003-persistencia.md) y [D5](docs/adr/ADR-005-comunicacion-entre-servicios.md) distinguen almacenamiento y comunicaciones existentes de persistencia de empleados y mensajería previstas. |
| Inicio documentado e integración | `node scripts/iniciar.mjs` comprobado desde cero en una copia aislada; estrategia acordada de PR `entrega-2` hacia `main` en [Ramas, revisión e integración](#ramas-revisión-e-integración). |

### Evidencia y corrección del inicio completo

- Se reutiliza la evidencia del paso 2: compilación de los tres servicios y **27 pruebas aprobadas**, incluidas 11 del nuevo contrato. No se repitió la suite por cambios únicamente documentales y de inicio.
- La revisión adicional del contrato comprobó YAML procesable, tres esquemas JSON Schema 2020-12, 24 referencias locales y 11 ejemplos válidos. Se usaron YAML/AJV y revisión de la estructura; no se presenta como una certificación automática completa de OpenAPI.
- El inicio se probó en una copia sin el `.env` ni los datos del usuario, con nombre de proyecto, imágenes, puerto y volúmenes exclusivos de la verificación. El único override cambió el nombre de la imagen del gateway para aislarla; el procedimiento ejecutado fue `node scripts/iniciar.mjs`.
- El primer intento encontró una cookie de RabbitMQ propiedad de root que el servidor no podía leer. Se cambió únicamente su healthcheck para ejecutar `rabbitmq-diagnostics` mediante `su-exec rabbitmq`, conservando el entrypoint de la imagen. El arranque posterior y una nueva inicialización desde volúmenes vacíos finalizaron correctamente.
- PostgreSQL, MongoDB, RabbitMQ, Socios, las dos instancias de Clases, Accesos y el gateway alcanzaron estado saludable. Los dos inicializadores finalizaron con código 0. El estado saludable de Accesos acredita su estructura HTTP, no sus reglas de negocio; el de RabbitMQ no acredita eventos de dominio implementados.
- Se verificaron HTTP 200 del gateway, las rutas de salud, el portal, sus recursos compilados y la consola. La consulta de clases devolvió 401 sin clave y 200 con la credencial temporal, sobre PostgreSQL y sin `X-Mock`.
- Se corrigió el mensaje final del inicio para identificar clases como contrato anterior y dirigir al comando del mock separado de empleados. No se agregó el POST operativo al gateway.
- Al terminar se retiraron los contenedores, volúmenes, imágenes y copia temporal de la verificación. Se conservaron los volúmenes originales del proyecto y su configuración local.

### Alcance de este cierre

El diseño y mock de E1 quedan verificados. El cierre de E2 requiere la nueva capacidad operativa, almacenamiento integrado, logs correlacionados, primera traza y sus decisiones arquitectónicas conforme a la sección 6.3. El plan conserva las correcciones del flujo existente y la implementación persistente del POST; la coordinación con pagos, el acceso personal de los socios y Tienda se completarán en sus etapas acordadas. El balanceo y la observabilidad tendrán sus propias comprobaciones. Los detalles del proveedor desconocidos permanecen pendientes sin inventarlos.

## Paso 4 - Flujo propio, arquitectura interna y acceso real

**Fecha:** 19/10/2026. **Origen:** sección 2.1, página 2 (patrones internos diferentes), sección 2.5, página 2 (comunicación y fallas), sección 2.8, página 3 (consistencia), y sección 5 (D2, D4, D5 e historia de decisiones). La documentación se mantiene actualizada conforme a la sección 3, página 4. Las políticas de alta administrativa, JWT, pago pendiente y cancelación ante caída de Socios fueron confirmadas por el equipo; no son requisitos nuevos atribuidos al enunciado.

### Implementado

- **Estructura interna:** Clases conserva Hexagonal, con puertos, casos de uso y adaptadores separados; Socios conserva Capas, con controladores, servicios y repositorio. [D2](docs/adr/ADR-002-arquitectura-interna-de-servicios.md).
- **Sesiones y altas:** JWT firmado con vencimiento, controles de ADMIN y propietario. Alta interna solo administrativa, sin membresía ni cambio de sesión. Comando local para el administrador inicial, sin cuenta administrativa predeterminada nueva ni sobrescritura de usuarios existentes. [ADR-016](docs/adr/ADR-016-autenticacion-y-altas.md).
- **Membresía:** se verifica en el momento actual y para la fecha de la clase; una renovación futura no oculta la cobertura vigente. Alta/renovación no se habilitan sin un pago real: su backend sigue pendiente y responde 501.
- **Reservas:** capacidad, duplicados, inicio y espera voluntaria se comprueban atómicamente por clase. La cancelación se acepta aunque Socios no responda; el trabajador reintenta la promoción sin perder prioridad FIFO. [D4 vigente, ADR-017](docs/adr/ADR-017-consistencia-y-recuperacion-de-espera.md), sucesor de ADR-004.
- **Interfaz:** perfil, clases y reservas provienen de sus APIs, con errores visibles. Se eliminaron sesiones y resultados ficticios; pagos, reactivación, comprobantes, QR y controles sin backend quedan identificados como pendientes.
- **Comunicación:** credencial técnica interna distinta del contrato externo; presupuesto de 3 s por verificación, incluido cuerpo/reintento. [D5](docs/adr/ADR-005-comunicacion-entre-servicios.md) y [estado real de D10](docs/adr/ADR-010-resiliencia.md).

### Verificación del paso

- `npm test`: **55 pruebas aprobadas, 0 fallidas**, tras compilar los tres servicios. Incluye los 11 casos del mock de empleados sin modificarlo, contrato anterior, JWT/permisos, membresías, reservas, concurrencia y 10 pruebas de API de la interfaz.
- `npm run frontend:build`: compilación TypeScript y producción Vite correctas.
- `npm run test:postgres`: PostgreSQL 17 exclusivo y temporal, solicitudes HTTP reales y dos instancias de Clases con pools independientes. Verifica bootstrap sin sobrescritura, permisos, alta sin membresía, unicidad de email bajo concurrencia, cobertura actual con renovación futura, último cupo y cancelación/recuperación FIFO ante caída de Socios. No carga `.env` ni utiliza las bases del grupo; retira su contenedor al terminar.
- La demostración de trazas se adaptó al login real. Sigue usando memoria e `inject`; no se presenta como una prueba entre procesos.
- La consola técnica solicita un JWT temporal para sus operaciones privadas; conserva `X-API-Key` solo en los GET históricos, separa la reserva de la elección de espera e informa una reasignación pendiente. Se comprobó la sintaxis de su JavaScript; el ensayo completo de Compose anterior a este último ajuste acreditó el portal compilado y las rutas autenticadas.
- `node scripts/iniciar.mjs` se volvió a comprobar en una copia temporal sin datos ni `.env` del grupo, con puerto, imágenes y volúmenes exclusivos. Partiendo de claves ficticias del formato anterior, agregó las dos credenciales nuevas sin cambiar las existentes; los ocho contenedores de ejecución quedaron saludables y los dos inicializadores terminaron con código 0. Gateway, portal y recurso JS respondieron 200; JWT ausente y clave técnica enviada desde afuera dieron 401; un socio consultó sus datos con 200 y los ajenos con 403.
- Se ejecutó `npm run crear-admin` en esa copia desde una terminal interactiva: ocultó ambas entradas de contraseña, creó ADMIN y permitió login y alta de SOCIO 201 sin membresía/token. El administrador conservó su identidad y el intento de activar mediante una bandera de pago devolvió 501. Se retiraron la copia y sus contenedores, imágenes y volúmenes exclusivos; se conservaron los originales.

**Pendientes de las siguientes etapas:** POST persistente de empleados (próximo paso), integración de Tienda cuando se disponga del contrato, mensajería ante cambios de membresía, backend de pagos/reactivación, consulta del listado administrativo y operaciones sin backend, y las verificaciones propias de balanceo y observabilidad. El cierre de E1 del paso 3 se conserva; este paso no declara completa E2 ni modifica el mock de empleados.

## Paso 5 - Capacidad de empleados persistente

**Fecha:** 19/10/2026. **Origen:** sección 4.1, páginas 5–6 (capacidad compartida y contrato), sección 6.3, página 8 (capacidad operativa y almacenamiento en E2), sección 5 (D3, D4 y D8), y sección 3, página 4 (documentación actualizada). Se implementan los datos y reglas confirmados por el equipo en el paso 2.

### Implementado

- `POST /api/v1/integraciones/empleados` operativo en Socios y publicado por el gateway. Recibe los cuatro campos acordados, autentica `X-API-Key` y exige `Idempotency-Key`.
- Alta de una cuenta SOCIO y una solicitud PENDIENTE; sin contraseña, JWT, plan, pago ni membresía habilitada.
- Transacción PostgreSQL que guarda socio, solicitud, referencia externa y resultado original. Los reintentos entre instancias o después de reiniciar conservan los mismos IDs. Conflictos de clave, empleado, DNI o email devuelven 409 sin sobrescribir datos; los errores revierten toda el alta.
- Configuración `EMPLEADOS_API_KEY` y `EMPLEADOS_ORIGEN_ID`, independiente de las otras credenciales. `node scripts/iniciar.mjs` completa las variables ausentes conservando las existentes; el origen predeterminado `grupo-ficticio-local` es solo para pruebas y no identifica al grupo real.
- Contrato [OpenAPI 1.0.1](docs/contracts/openapi-empleados-v1.yaml): se actualizan servidores y descripciones sin cambiar campos ni respuestas. El mock separado conserva sus 11 pruebas. Arquitectura en Capas y decisiones existentes actualizadas; no se agrega un microservicio ni un ADR para repetir la decisión aprobada.

### Verificado

- `npm test`: **62 pruebas aprobadas y 0 fallidas**, tras compilar los tres servicios; 7 casos nuevos del endpoint operativo.
- `npm run test:postgres`: HTTP real, PostgreSQL 17 efímero y dos instancias de Socios con pools independientes. Veinte solicitudes simultáneas produjeron una sola alta y respuesta; se verificaron unicidad concurrente, replay tras recrear el servidor y rollback provocado antes del último registro, seguido de reintento exitoso. Se conservan las comprobaciones del flujo de reservas del paso 4.
- `node scripts/iniciar.mjs` en una copia aislada con recursos propios: construcción con el contrato incluido, todos los contenedores de ejecución saludables y configuración anterior conservada. A través del gateway: 401 sin clave, 201 sin X-Mock, repetición 201, conflicto 409 y mismos IDs después de reiniciar Socios. La consulta PostgreSQL confirmó **1 socio, 1 solicitud y 0 membresías**; se verificaron encabezados y logs correlacionados.

La [guía del contrato](docs/contracts/README.md#ejecutar-y-probar-el-servicio-operativo) contiene el comando de inicio, configuración y ejemplo PowerShell. Se retiraron los contenedores, imágenes, volúmenes y copia exclusivos de la verificación; se conservaron `.env`, bases y volúmenes originales del grupo. Los 119 enlaces locales Markdown y el formato del diff se comprobaron sin errores.

**Pendientes:** publicación accesible y prueba conjunta con el consumidor, identificación/credenciales reales, acceso personal del empleado, tratamiento administrativo de la solicitud y pago. Continúan pendientes Tienda, mensajería de cambios de membresía y las verificaciones de balanceo/observabilidad de sus etapas. El POST completo no equivale al cierre de toda E2.

## Paso 6 - Tienda preparada; integración externa pendiente

**Fecha:** 19/10/2026. **Origen:** asignación del profesor y sección 4.1, páginas 5–6 (consumo desde el servicio responsable); D1/D9 en sección 5 y actualización documental en sección 3, página 4. El equipo confirmó que todavía no dispone del contrato, URL ni autenticación de la distribuidora.

### Qué quedó preparado

- Cuarto workspace `services/tienda`, con Fastify/TypeScript y JWT como en los servicios anteriores; reutiliza la sesión emitida por Socios para el portal. Estructura en Capas con transporte, servicio y arranque, sin un patrón adicional ni una biblioteca compartida nueva.
- Imagen, servicio Compose, salud y ruta interna en NGINX. No incorpora base, volumen, caché, broker, credenciales ni URL del proveedor.
- Pestaña **Tienda** en el portal del socio: muestra carga, integración pendiente o error de comunicación. No presenta productos ficticios, catálogo vacío como éxito ni stock en cero. El panel administrativo conserva su acceso existente al portal del socio.
- `GET /api/v1/tienda/productos` es una ruta **del gimnasio**, protegida por Bearer JWT. Actualmente devuelve `503 INTEGRACION_PENDIENTE` y un mensaje, con `Cache-Control: no-store`. No define una operación de la distribuidora ni una respuesta exitosa de productos.
- `GET /health/tienda` informa `estado: estructura`, `integracion: PENDIENTE_CONTRATO` y `persistencia: ninguna`. Una salud 200 comprueba el proceso, no una conexión al proveedor.

### Verificado

- `npm test`: **68 pruebas aprobadas, 0 fallidas**, compilando los cuatro servicios. Se agregan 4 casos de salud/autenticación/estado de Tienda y 2 de su API en la interfaz; las 62 pruebas anteriores se conservan.
- `npm run frontend:build`: TypeScript y Vite correctos.
- Inicio completo en una copia temporal con recursos exclusivos: nueve procesos saludables, incluidos Tienda y las dos instancias de Clases. Por el gateway, salud 200, 401 sin JWT y 503 de integración pendiente con la sesión real emitida por Socios; el perfil siguió respondiendo 200 y no se expusieron productos ni stock.
- Navegador: login del socio ficticio, pestaña Tienda visible y mensaje pendiente, sin catálogo inventado. No se hicieron llamadas a una API externa. La prueba no acredita consumo de la distribuidora.
- Se retiraron la pestaña, contenedores, imágenes, volúmenes y copia temporales usados en la verificación. La configuración y los volúmenes originales del grupo se conservaron. Los 123 enlaces locales de documentación y el formato del diff se comprobaron sin errores.

### Qué falta para completar el paso 6

Recibir contrato/documentación o repositorio, URL y autenticación del proveedor. Con eso se definirán rutas y parámetros reales, campos y paginación, traducción de productos/stock, errores y tiempos de comunicación; después se conectará el cliente de Tienda y se verificará la consulta conjunta. La decisión y pendientes están en [D9](docs/adr/ADR-009-consumo-del-proveedor.md). No se incluyen compras, pedidos ni reposición.

**Para verlo:** iniciar con `node scripts/iniciar.mjs`, entrar al portal del socio con una cuenta existente y abrir **Tienda**. La consulta real queda pendiente; este paso no declara completa la integración ni toda E2. El balanceador conserva su verificación específica en el paso 7.

## Paso 7 - Balanceador verificado

**Fecha:** 19/10/2026 (hora de Argentina). **Origen:** sección 2.3, página 2, del enunciado: al menos un servicio con dos o más instancias, detección de indisponibilidad y distribución/estado observables. D12 y su presentación en E2 se requieren en las secciones 5 y 6.3; la documentación se actualiza según sección 3, página 4.

### Qué se completó

- Se conserva NGINX `least_conn` y las dos réplicas de Clases ya configuradas. Las sesiones JWT y el almacenamiento PostgreSQL permiten atender el flujo sin fijarlo a una instancia.
- Los logs JSON del gateway agregan `upstream_addr`, `upstream_status` y `upstream_response_time`. Las respuestas de Clases conservan `X-Instance-ID`; Compose muestra la salud de cada contenedor.
- Se incorpora `scripts/verificar-balanceo.mjs`, ejecutable con `npm run test:balanceo`. Construye el proyecto completo en una copia temporal con claves, puerto, imágenes y volúmenes exclusivos. No carga `.env` ni modifica los contenedores o datos del grupo. Al terminar retira sus recursos, también si la verificación falla.
- [D12](docs/adr/ADR-012-balanceo-de-carga.md), [D10](docs/adr/ADR-010-resiliencia.md) y [D11](docs/adr/ADR-011-observabilidad.md) reflejan el comportamiento comprobado. Se corrigen las afirmaciones anteriores sobre detección instantánea, sonda activa de NGINX, cero errores garantizados y despliegue multizona no realizado.

### Resultado del ensayo local

La última ejecución construyó los cuatro servicios y el portal, verificó `nginx -t` y utilizó PostgreSQL real y JWT emitidos por Socios. Las instancias tenían identificadores temporales; cada ejecución genera otros.

| Fase | Resultado observado |
|---|---|
| Dos réplicas disponibles | 40/40 lecturas HTTP 200, repartidas 20 y 20. |
| Consultas mientras se enviaba la orden de parada | 24/24 HTTP 200, repartidas entre las dos instancias todavía presentes. |
| Detección tras detener una réplica | 24 consultas: 20 HTTP 200 y **4 HTTP 504**. Detección más muestreo: **3331 ms**. |
| Una réplica, estado estable | 40/40 HTTP 200, todas desde la superviviente. La reserva creada antes de la parada se conservó. |
| Réplica detenida reemplazada por un contenedor nuevo | 40/40 HTTP 200, repartidas 20 y 20 entre superviviente y nueva instancia. NGINX mantuvo el mismo contenedor y fecha de inicio. |
| Reserva del último cupo a través del gateway | 12 intentos concurrentes con JWT: **1 HTTP 201 y 11 HTTP 409**, sin sobreventa. |
| Evidencia del proxy | 170 registros de consultas de Clases con destinos de upstream identificados. No se observaron reintentos en esos registros; se verifica el resultado de detección y recuperación, no una garantía de reintento transparente. |

Los 504 ocurrieron durante intentos de conexión a la IP de la réplica detenida; después se atendió desde la restante. El ensayo distingue esa transición de la muestra estable y exige recuperación dentro de su presupuesto de 30 s. **No se promete ausencia total de errores durante la detección ni se considera esta muestra un benchmark de capacidad o un SLO.** Hay un solo gateway y bases compartidas; esta prueba no verifica tolerancia a sus caídas.

Los recursos de las tres ejecuciones de diagnóstico/verificación se retiraron automáticamente. Los volúmenes originales se conservaron. La prueba valida el código mediante las imágenes compiladas, HTTP real y PostgreSQL; la suite unitaria del paso 6 se conserva sin repetirla por estos cambios de script, logs y documentación.

### Reproducir y mostrar al profesor

```sh
npm run test:balanceo
```

Requiere Node.js 22, Git, Docker Desktop en modo Linux y Compose v2 o posterior. Muestra las fases, los conteos por instancia, los errores transitorios y el reporte JSON. El comando detiene/reemplaza únicamente una réplica de su proyecto temporal y deja el entorno del grupo como estaba.

En un entorno propio iniciado con `node scripts/iniciar.mjs`, se pueden observar sus contenedores y registros sin detener nada:

```sh
docker compose ps
docker compose logs --no-color --tail 30 gateway
```

Para comparar las instancias por PowerShell, con la clave local del contrato anterior de consultas de clases:

```powershell
$claveClases = (Select-String -LiteralPath .env -Pattern '^CAPACIDAD_API_KEY=').Line.Split('=', 2)[1]
1..10 | ForEach-Object {
    $respuesta = Invoke-WebRequest -Uri 'http://localhost:8080/api/v1/clases?sedeId=sede-demo-01' -Headers @{ 'X-API-Key' = $claveClases }
    $respuesta.Headers['X-Instance-ID']
}
```

Usar el puerto configurado si difiere de 8080. No se requiere detener una instancia del entorno del grupo para presentar la falla: el ensayo aislado ya realiza esa demostración.

**Pendientes del plan:** cierre de E2 y revisión conjunta de decisiones/evidencias en el paso 8; Tienda continúa pendiente del contrato externo y la publicación/prueba con los otros grupos sigue por coordinar. Este cierre corresponde al balanceo, no al cierre completo de E2.

## Estado rumbo a la Entrega 2: dominio propio de punta a punta

El avance existente se resume a continuación. La capacidad de empleados tiene implementación persistente local desde el paso 5. Tienda tiene estructura propia y portal desde el paso 6, pero aún no consume al proveedor. Los registros anteriores conservan sus pendientes históricos; el estado actual es el de este apartado y los pasos 5 y 6.

1. **Servicios del dominio propio:**
   - `Clases y Reservas` (`@gimnasio/clases-reservas`): operando contra PostgreSQL y calculando cupos dinámicamente. Conserva `GET /api/v1/clases` y su contrato anterior para consultas del gimnasio.
   - `Socios y Membresías` (`@gimnasio/socios-membresias`): PostgreSQL, identidad, validación de habilitación y recepción externa de empleados con alta pendiente e idempotencia persistente.
   - `Tienda` (`@gimnasio/tienda`): estructura HTTP autenticada y portal preparados; sin almacenamiento ni cliente externo mientras no esté disponible el contrato de la distribuidora.
2. **Almacenamiento integrado al flujo:**
   - **PostgreSQL 17** integrado con esquemas relacionales, transacciones ACID, restricciones de unicidad parcial para evitar reservas duplicadas y bloqueos a nivel de fila (`SELECT ... FOR UPDATE`) para evitar sobreventa de cupos.
3. **Logs estructurados y primera traza distribuida correlacionada:**
   - Logs en formato JSON estructurado estándar (Pino) con campos: `service`, `trace_id`, `span_id`, `parent_span_id`, `time`, `level`, `msg`.
   - Propagación de contexto distribuido mediante cabeceras estándar **W3C Trace Context (`traceparent`)** y `X-Correlation-ID`.
4. **Documentos de decisiones existentes, sujetos a revisión y comprobación:**
   - Decisiones nuevas: **D2, D6, D7, D9, D10, D12 y D13**.
   - Validaciones de decisiones previas: **D1, D3 y D5**.
   - Primera versión de **D11** (Observabilidad) y reemplazo de **D8** por el contrato, mock y capacidad persistente de empleados.

## Flujo principal implementado

1. El socio consulta su membresía en `Socios y Membresías` y busca clases en `Clases y Reservas`.
2. Solicita reservar mediante `POST /api/v1/reservas` antes del inicio de la clase.
3. `Clases y Reservas` llama sincrónicamente a `Socios y Membresías` (`GET /api/v1/socios/:socioId/habilitacion?fecha=...`) propagando la traza distribuida. Si la membresía está inactiva o vencida, retorna `422 MEMBRESIA_NO_HABILITADA`.
4. Mediante una transacción en PostgreSQL, se evitan duplicados (`409 RESERVA_DUPLICADA`) y se verifica el aforo. Si hay cupo, se confirma la reserva (HTTP 201). Si está llena, se ofrece ingreso voluntario a la lista de espera (HTTP 409 o ingreso a espera).
5. Ante una cancelación (`POST /api/v1/reservas/:id/cancelar`), se libera el cupo y se activa la promoción automática del siguiente socio habilitado en la lista de espera.

## Registro de Decisiones Arquitectónicas (ADRs)

| ADR | Decisión | Título | Estado |
|---|---|---|---|
| [ADR-001](docs/adr/ADR-001-limites-de-servicios.md) | **D1 anterior** | Límites de los tres servicios originales | Reemplazado por ADR-015; conservado como antecedente |
| [ADR-002](docs/adr/ADR-002-arquitectura-interna-de-servicios.md) | **D2** | Arquitectura interna de los servicios | Hexagonal y Capas implementadas en Clases/Socios; Accesos previsto |
| [ADR-003](docs/adr/ADR-003-persistencia.md) | **D3** | Persistencia relacional y documental | Validada en E2 con PostgreSQL operativo |
| [ADR-004](docs/adr/ADR-004-consistencia-y-concurrencia.md) | **D4 anterior** | Consistencia y concurrencia | Reemplazado por ADR-017; conservado como antecedente |
| [ADR-005](docs/adr/ADR-005-comunicacion-entre-servicios.md) | **D5** | Comunicación entre servicios (Síncrona/Asíncrona) | HTTP y POST externo operativos; mensajería pendiente |
| [ADR-006](docs/adr/ADR-006-busqueda.md) | **D6** | Búsqueda | FTS/GIN preparado; consulta textual pendiente; catálogo filtrado operativo |
| [ADR-007](docs/adr/ADR-007-cache.md) | **D7** | Caché | Diseño Cache-Aside; Redis pendiente; cupos sin caché |
| [ADR-008](docs/adr/ADR-008-contrato-propio.md) | **D8 anterior** | Contrato de consulta de clases | Reemplazado por ADR-014; conservado como antecedente |
| [ADR-009](docs/adr/ADR-009-consumo-del-proveedor.md) | **D9** | Consumo del proveedor | Recorrido interno preparado; contrato e integración externa pendientes |
| [ADR-010](docs/adr/ADR-010-resiliencia.md) | **D10** | Resiliencia | Timeout/reintento y recuperación verificados; otros mecanismos pendientes |
| [ADR-011](docs/adr/ADR-011-observabilidad.md) | **D11** | Observabilidad (Logs, Métricas, Trazas, SLOs) | Primera versión en E2 |
| [ADR-012](docs/adr/ADR-012-balanceo-de-carga.md) | **D12** | Balanceo de carga | Distribución y recuperación verificadas; ventana de detección documentada |
| [ADR-013](docs/adr/ADR-013-capacidad-y-costos.md) | **D13** | Capacidad y costos | Línea base local y estimación ilustrativa documentadas |
| [ADR-014](docs/adr/ADR-014-contrato-empleados.md) | **D8 vigente** | Contrato de recepción de empleados | Contrato 1.0.1, mock y POST persistente local verificados |
| [ADR-015](docs/adr/ADR-015-limites-con-tienda.md) | **D1 vigente** | Límites con Tienda separada | Estructura sin base propia; consulta externa pendiente |
| [ADR-016](docs/adr/ADR-016-autenticacion-y-altas.md) | Adicional | Identidad y altas administradas | JWT, permisos y bootstrap local implementados |
| [ADR-017](docs/adr/ADR-017-consistencia-y-recuperacion-de-espera.md) | **D4 vigente** | Consistencia y recuperación FIFO | Transacciones por clase, cancelación local y recuperación verificadas |

## Ramas, revisión e integración

**Estrategia confirmada por el equipo el 19/10/2026**, conforme a la sección 2.12 del enunciado, página 4:

1. Los cambios de esta entrega se preparan en `entrega-2`, en la carpeta local del proyecto, con código, contratos y documentación actualizados por cada paso acordado.
2. Antes de integrar se revisan el diff, las decisiones y las comprobaciones correspondientes. `npm test` verifica la suite en memoria; el inicio completo y las dependencias reales tienen evidencia separada.
3. La PR tendrá **origen `entrega-2` y destino `main`**. El equipo revisará sus cambios y resultados antes de integrarla; los pendientes de E2 deben permanecer identificados.
4. La versión final evaluable se mantendrá en `main`. La preparación por pasos no implica crear commits, publicar una PR o integrarla automáticamente.

Las credenciales locales y datos sensibles quedan fuera de Git. Las modificaciones locales preexistentes se conservan y se revisan antes de preparar los commits de la PR.

## Ejecución y Pruebas

### Requisitos

- **Node.js 22 LTS**.
- **Docker Desktop con contenedores Linux y Compose v2**, necesario para el entorno completo con PostgreSQL, MongoDB y RabbitMQ. Las pruebas y el mock separado de empleados utilizan Node.js sin iniciar Docker.

### 1. Compilación y Suite Completa de Pruebas

Para compilar los cuatro microservicios en TypeScript y ejecutar las pruebas de contrato y comportamiento existentes, que utilizan adaptadores en memoria:

```sh
npm ci --ignore-scripts
npm test
```

La suite descubre automáticamente los archivos `*.test.mjs`: 9 casos del contrato anterior, 11 del mock de empleados, 7 de su endpoint operativo, 13 de autenticación/membresías/bootstrap, 8 de reglas y recuperación de reservas, 3 de flujo, 1 de concurrencia (50 solicitudes), 4 de Tienda y 12 de API de la interfaz. Los casos se ejecutan con datos ficticios y sin dependencias externas.

La prueba de dependencias reales es separada y requiere Docker:

```sh
npm run test:postgres
```

Ese comando crea PostgreSQL efímero con nombre y puerto exclusivos, sin cargar `.env`, ejecuta el flujo HTTP con dos instancias de Clases y limpia únicamente su contenedor.

### 2. Demostración de Traza Distribuida y Logs Estructurados

Para observar en tiempo real la emisión de logs JSON correlacionados y la reconstrucción del árbol de spans distribuidos a través de los microservicios:

```sh
node scripts/demostrar-traza-distribuida.mjs
```

La demostración incluida usa repositorios en memoria y solicitudes `inject`. `npm run test:postgres` verifica además una traza con HTTP real y PostgreSQL, exige correlación y relaciones padre/hijo e imprime su evidencia; detalle en [D11](docs/adr/ADR-011-observabilidad.md).

### 3. Ejecución del Entorno Completo con Docker Compose

```sh
node scripts/iniciar.mjs
```

El inicio agrega en `.env` las credenciales ausentes `AUTH_JWT_SECRET`, `SERVICIOS_API_KEY` y `EMPLEADOS_API_KEY`, conservando las claves existentes de las bases y el broker. Completa `EMPLEADOS_ORIGEN_ID=grupo-ficticio-local` si falta; es solo un origen ficticio de prueba. Conservar origen y clave para recuperar la idempotencia. La sesión dura una hora por defecto (`AUTH_JWT_TTL_SECONDS=3600`); el trabajador de promociones se ejecuta cada 5 s (`RESERVAS_REINTENTO_MS=5000`, mínimo 100 ms).

Después de iniciar, crear el administrador elegido por el grupo:

```sh
npm run crear-admin
```

El comando entra al contenedor de Socios y solicita DNI, nombre, email, contraseña y confirmación; la contraseña no se muestra ni se pasa por argumentos. Si el DNI/email ya existe, no modifica la cuenta. Las instalaciones anteriores conservan sus usuarios. No se crea automáticamente una nueva cuenta ADMIN con contraseña de demostración. Con ese administrador se pueden dar de alta socios desde el panel; quedarán sin membresía hasta implementar y confirmar el pago real.

El portal guarda el JWT solo en memoria; al recargar o ante un 401 se debe iniciar sesión otra vez. Para desarrollar la interfaz por separado: `npm --prefix frontend ci --ignore-scripts` y `npm run frontend:dev`.

El Gateway queda expuesto en `http://localhost:8080`:

| Endpoint | Método | Descripción |
|---|---|---|
| `http://localhost:8080/` | `GET` | Portal web React (SPA) para socios y panel de administración. |
| `http://localhost:8080/consola.html` | `GET` | Consola técnica interactiva de pruebas de arquitectura y trazas W3C. |
| `http://localhost:8080/api/v1/clases` | `GET` | Consulta de clases y cupos del contrato anterior (requiere `X-API-Key`). |
| `http://localhost:8080/api/v1/clases/{id}` | `GET` | Detalle y disponibilidad de una clase real (requiere `X-API-Key`). |
| `http://localhost:8080/api/v1/auth/login` | `POST` | Login con email/DNI y contraseña; devuelve JWT. |
| `http://localhost:8080/api/v1/tienda/productos` | `GET` | Estructura autenticada con Bearer; responde 503 INTEGRACION_PENDIENTE hasta recibir el contrato. |
| `http://localhost:8080/health/tienda` | `GET` | Salud de la estructura Tienda; no acredita conexión con la distribuidora. |
| `http://localhost:8080/api/v1/integraciones/empleados` | `POST` | Alta externa con solicitud pendiente; requiere X-API-Key de EMPLEADOS_API_KEY e Idempotency-Key. |
| `http://localhost:8080/api/v1/auth/me` | `GET` | Identidad y membresía de la sesión (Bearer). |
| `http://localhost:8080/api/v1/socios` | `POST` | Alta de cuenta SOCIO sin membresía (Bearer ADMIN). |
| `http://localhost:8080/api/v1/reservas/clases` | `GET` | Catálogo y reservas/espera propias (Bearer). |
| `http://localhost:8080/api/v1/reservas` | `POST` | Reserva con validación actual y para la clase (Bearer). |
| `http://localhost:8080/api/v1/socios/{id}/habilitacion` | `GET` | Habilitación propia o ADMIN (Bearer); la clave técnica se usa directamente entre servicios. |
| `http://localhost:8080/metrics/clases` | `GET` | Métricas Prometheus de Clases y Reservas. |
| `http://localhost:8080/metrics/socios` | `GET` | Métricas Prometheus de Socios y Membresías. |
| `http://localhost:8080/health/clases` | `GET` | Estado operativo de Clases y Reservas (conectividad con PostgreSQL). |
| `http://localhost:8080/health/socios` | `GET` | Estado operativo de Socios y Membresías (conectividad con PostgreSQL). |
| `http://localhost:8080/health/accesos` | `GET` | Estado del proceso de Accesos y Ocupación. |

### Probar la consulta de clases del contrato anterior en PowerShell

```powershell
$apiKey = (Select-String -LiteralPath .env -Pattern '^CAPACIDAD_API_KEY=').Line.Split('=', 2)[1]
Invoke-RestMethod -Uri 'http://localhost:8080/api/v1/clases?sedeId=sede-demo-01' -Headers @{ 'X-API-Key' = $apiKey }
```
