# Verificación de suspensiones y mensajería

**Estado al 08/11/2026.** Implementación y cierre funcional del paso 4 verificados localmente en `feat/membresias-eventos`, con pruebas automáticas y recorrido manual aportado por el equipo. Las capturas comprueban reasignaciones y estado final del panel. El reintento con la misma clave se verifica automáticamente. La PR #7 de Tienda quedó integrada en `main` durante el trabajo y esta rama avanzó a esa base, `837df58`. Apertura de PR de esta rama pendiente por decisión del equipo. PostgreSQL 17.11, RabbitMQ 4.1.8 y Node 22.18.0. Las verificaciones corresponden al entorno local.

## Alcance y decisiones

El equipo confirmó suspensión inmediata por membresía elegida, manteniendo fechas y sin devolución ni extensión. Primero se completan suspensión y eventos. Reactivación conserva su pendiente. [D5](adr/ADR-005-comunicacion-entre-servicios.md), [guía y contrato](contracts/membresias-eventos.md).

## Verificaciones del 07/11/2026

- `npm test` aprobó **213 pruebas**, sin fallos ni omitidas, compilando los cuatro servicios. Incluye 42 verificaciones del cliente web y dos del esquema/consumidor de eventos.
- `npm run frontend:build` compiló TypeScript y **36 módulos** React/Vite. El panel incorpora historial y suspensión explícita, con manejo de respuestas inciertas. No se ejecutó un recorrido manual nuevo del panel en navegador en esta etapa.
- `npm run test:eventos` aprobó **12 pruebas** con PostgreSQL/RabbitMQ reales y efímeros. Estado/evento/resultado y cancelación/Inbox/proyección revierten juntos ante fallos forzados. Ocho carreras reales entre evento y reserva/promoción no dejaron reservas suspendidas confirmadas. Un período futuro canceló sólo su reserva afectada y conservó la cercana y el historial iniciado. Se comprobaron reentrega, dos consumidores, mensajes inválidos, reintentos, DLQ y parada/reinicio del broker.
- `node --test scripts/verificar-membresias.mjs` aprobó **20 pruebas** existentes de planes, cobros, comprobantes, permisos, concurrencia, migración y rollback con PostgreSQL.
- `node scripts/verificar-postgres.mjs` aprobó la regresión HTTP/PostgreSQL de reservas/FIFO, autenticación, empleados y Car Cruds, incluyendo recuperación y rollback. Sus 300 lecturas directas con concurrencia 10 terminaron sin errores, como ensayo local breve.
- `node scripts/verificar-balanceo.mjs` aprobó Compose/NGINX y los servidores de producción. El ADMIN suspendió y repitió la solicitud por gateway, RabbitMQ entregó el evento, Clases canceló una reserva y promovió al primero de espera. El historial administrativo confirmó una cancelación y una reserva nueva, y la lista del socio confirmó sus reservas activas. También conservó stock/ventas de Tienda y último cupo. Dos réplicas se distribuyeron lecturas y se reemplazó una sin reiniciar NGINX. En este ensayo hubo cuatro reintentos del proxy y las muestras terminaron en 200, sin prometer ausencia de errores en otras ejecuciones.
- OpenAPI Membresías **1.1.0**, 11 rutas y 114 referencias internas resueltas. Evento JSON Schema **1.0.0** validado contra el contenido real guardado en Outbox.
- Revisión documental de 35 archivos Markdown y 248 enlaces locales, sin destinos faltantes. `git diff --check` aprobado. Comprobación final de limpieza sin contenedores ni volúmenes de estos ensayos pendientes.

## Revisión del panel y recuperación, 08/11/2026

El equipo comprobó manualmente la suspensión normal y reportó que, ante la respuesta perdida de «Suspensión incierta», los controles quedaban bloqueados después de recargar e ingresar, sin encontrar el botón de recuperación. La revisión encontró consultas sin plazo máximo y un bloqueo de selección/historial compartido con las escrituras pendientes. Se incorporó un plazo técnico de 15 segundos, incluido el cuerpo de respuesta, y se habilitaron las consultas cuando hay una operación pendiente. El aviso de recuperación recibe el foco y explica cómo reutilizar la operación original.

Dos pruebas nuevas del cliente reproducen una consulta sin respuesta y una suspensión con cuerpo interrumpido. Verifican vencimiento y recuperación con la misma ruta, cuerpo, clave y sesión. Una prueba de renderizado React del panel, con una operación de suspensión guardada, verifica aviso y reintento habilitado, selección de socio disponible y nuevas escrituras restringidas. Este renderizado comprueba el estado recuperado y sus controles. El recorrido manual posterior se registra a continuación.

El fixture `scripts/membresias/suspension-web.mjs` permite repetir el recorrido con PostgreSQL y RabbitMQ temporales, APIs reales, Outbox/Inbox y el trabajador FIFO. Prepara tres socios ficticios, pagos confirmados por API y dos clases con espera. Interrumpe una respuesta de suspensión después del commit. El intento automatizado de navegador de esta revisión quedó detenido en la confirmación nativa antes de enviar el POST. El estado del fixture confirmó cero suspensiones enviadas y se retiraron sus recursos al terminar. La suspensión normal validada por el equipo y las pruebas de eventos se conservan como evidencias separadas.

Para repetirlo, ejecutar `npm run build`, `npm run frontend:build` y `node scripts/membresias/suspension-web.mjs`. Abrir la URL temporal y usar las cuentas ficticias impresas por el script. ADMIN selecciona «Suspensión normal» para comprobar estado, fechas y recarga. «Suspensión incierta» provoca la respuesta perdida y permite recuperar el resultado con la misma operación, incluso después de recargar e ingresar nuevamente. Los dos socios afectados deben perder sus reservas futuras y «Espera habilitada» debe recibir ambos cupos. Ctrl+C cierra el fixture y retira exclusivamente sus recursos. Si el fixture ya está abierto, reconstruir el frontend y recargar la página carga los nuevos archivos y conserva la operación pendiente de esa pestaña.

Esta corrección corresponde al manejo de fallas de §2.5 y al recorrido de frontend de la página 8. Las 12 pruebas de PostgreSQL/RabbitMQ y la compilación de servicios/frontend aprobaron en la preparación de este recorrido.

Después de la corrección, `npm test` aprobó 242 pruebas, incluidas 57 de frontend, y `npm run frontend:build` compiló 37 módulos. `npm run test:frontend` incluye ahora el renderizado del panel junto con las pruebas de la capa HTTP. `git diff --check` aprobó. La ejecución de regresión requirió acceso a los servidores HTTP locales que levantan sus fixtures.

### Resultados manuales aportados por el equipo

- El equipo confirmó que «Suspensión normal» funcionó según lo esperado.
- Una primera captura de «Espera habilitada» mostró «Suspensión respuesta incierta» confirmada y «Suspensión panel» todavía en espera. La captura posterior mostró ambas como reservas confirmadas. Se comprobó el resultado de las dos reasignaciones en el portal.
- Al volver al panel administrativo, el equipo confirmó que «Suspensión incierta» seguía suspendida. La captura mostró el panel sin aviso de operación pendiente y con los controles habilitados.

Estas comprobaciones cierran la revisión funcional local del paso 4 junto con las pruebas automáticas de suspensión, idempotencia, mensajería y recuperación. La comprobación de ruta, cuerpo y clave conservados al reintentar corresponde a las pruebas automáticas. Las capturas manuales acreditan los estados y controles finales. Reactivación, observabilidad y despliegue mantienen sus etapas del plan.

## Reproducción y limpieza

Con Docker operativo y dependencias instaladas, ejecutar `npm run test:eventos`. Usa datos ficticios, nombres/etiquetas únicos y bases separadas de las del equipo. El puerto temporal del broker se fija durante el ensayo para conservar la URL tras reiniciar su contenedor. Los mensajes DLQ se identifican por ID para distinguir reentregas permitidas. Compose verifica su proyecto exclusivo antes de retirar contenedores, volúmenes e imágenes. Los ensayos finalizaron con limpieza y conservaron `.env` y datos del equipo.

## Límites

Consistencia eventual entre servicios, entrega al menos una vez y deduplicación local. Instancias únicas de RabbitMQ/PostgreSQL. `/health` no acredita consumo al día. Tablero, alerta por antigüedad, despliegue y prueba conjunta siguen pendientes. El esquema implementa suspensión y sus fechas. Reactivación requiere adaptar evento/proyección antes de introducir ese comando. La auditoría de dependencias informó dos paquetes con avisos previos, Fastify y fast-uri, sin avisos para amqplib. Su actualización queda registrada para la revisión final de dependencias.
