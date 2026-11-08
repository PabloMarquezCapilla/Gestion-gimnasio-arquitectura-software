# Verificación de suspensiones y mensajería

**Estado al 07/11/2026.** Implementación y verificación local aprobadas, consolidadas en `feat/membresias-eventos`. La PR #7 de Tienda quedó integrada en `main` durante el trabajo y esta rama avanzó a esa base, `837df58`. Publicación de la rama de eventos pendiente. PostgreSQL 17.11, RabbitMQ 4.1.8 y Node 22.18.0. Las verificaciones no acreditan despliegue público.

## Alcance y decisiones

El equipo confirmó suspensión inmediata por membresía elegida, manteniendo fechas y sin devolución ni extensión. Primero se completan suspensión y eventos. Reactivación conserva su pendiente. [D5](adr/ADR-005-comunicacion-entre-servicios.md), [guía y contrato](contracts/membresias-eventos.md).

## Verificaciones realizadas

- `npm test` aprobó **213 pruebas**, sin fallos ni omitidas, compilando los cuatro servicios. Incluye 42 verificaciones del cliente web y dos del esquema/consumidor de eventos.
- `npm run frontend:build` compiló TypeScript y **36 módulos** React/Vite. El panel incorpora historial y suspensión explícita, con manejo de respuestas inciertas. No se ejecutó un recorrido manual nuevo del panel en navegador en esta etapa.
- `npm run test:eventos` aprobó **12 pruebas** con PostgreSQL/RabbitMQ reales y efímeros. Estado/evento/resultado y cancelación/Inbox/proyección revierten juntos ante fallos forzados. Ocho carreras reales entre evento y reserva/promoción no dejaron reservas suspendidas confirmadas. Un período futuro canceló sólo su reserva afectada y conservó la cercana y el historial iniciado. Se comprobaron reentrega, dos consumidores, mensajes inválidos, reintentos, DLQ y parada/reinicio del broker.
- `node --test scripts/verificar-membresias.mjs` aprobó **20 pruebas** existentes de planes, cobros, comprobantes, permisos, concurrencia, migración y rollback con PostgreSQL.
- `node scripts/verificar-postgres.mjs` aprobó la regresión HTTP/PostgreSQL de reservas/FIFO, autenticación, empleados y Car Cruds, incluyendo recuperación y rollback. Sus 300 lecturas directas con concurrencia 10 terminaron sin errores, como ensayo local breve.
- `node scripts/verificar-balanceo.mjs` aprobó Compose/NGINX y los servidores de producción. El ADMIN suspendió y repitió la solicitud por gateway, RabbitMQ entregó el evento, Clases canceló una reserva y promovió al primero de espera. El historial administrativo confirmó una cancelación y una reserva nueva, y la lista del socio confirmó sus reservas activas. También conservó stock/ventas de Tienda y último cupo. Dos réplicas se distribuyeron lecturas y se reemplazó una sin reiniciar NGINX. En este ensayo hubo cuatro reintentos del proxy y las muestras terminaron en 200, sin prometer ausencia de errores en otras ejecuciones.
- OpenAPI Membresías **1.1.0**, 11 rutas y 114 referencias internas resueltas. Evento JSON Schema **1.0.0** validado contra el contenido real guardado en Outbox.
- Revisión documental de 35 archivos Markdown y 248 enlaces locales, sin destinos faltantes. `git diff --check` aprobado. Comprobación final de limpieza sin contenedores ni volúmenes de estos ensayos pendientes.

## Reproducción y limpieza

Con Docker operativo y dependencias instaladas, ejecutar `npm run test:eventos`. Usa datos ficticios, nombres/etiquetas únicos y bases separadas de las del equipo. El puerto temporal del broker se fija durante el ensayo para conservar la URL tras reiniciar su contenedor. Los mensajes DLQ se identifican por ID para distinguir reentregas permitidas. Compose verifica su proyecto exclusivo antes de retirar contenedores, volúmenes e imágenes. Los ensayos finalizaron con limpieza y conservaron `.env` y datos del equipo.

## Límites

Consistencia eventual entre servicios, entrega al menos una vez y deduplicación local. Instancias únicas de RabbitMQ/PostgreSQL. `/health` no acredita consumo al día. Tablero, alerta por antigüedad, despliegue y prueba conjunta siguen pendientes. El esquema implementa suspensión y sus fechas. Reactivación requiere adaptar evento/proyección antes de introducir ese comando. La auditoría de dependencias informó dos paquetes con avisos previos, Fastify y fast-uri, sin avisos para amqplib. Su actualización queda registrada para la revisión final de dependencias.
