# Suspensión de membresías y eventos

**Enunciado.** §2.5, página 2 y presentación grupal, página 9 requieren publicación y consumo reales de eventos. RN-R08/CA-R09 del alcance requieren cancelar reservas futuras afectadas. [D5](../adr/ADR-005-comunicacion-entre-servicios.md) concreta el diseño existente.

## Uso desde el portal

ADMIN entra a **Planes, pagos y membresías**, selecciona un socio y revisa sus membresías con fechas e ID. El botón **Suspender membresía** pide confirmación. Suspende inmediatamente la membresía elegida y conserva fechas, pagos y comprobantes. La aplicación confirma el guardado local y avisa que las cancelaciones se procesan mediante eventos. **Actualizar membresías** consulta el estado real. Reactivación sigue pendiente de definición.

Una respuesta perdida conserva operación y clave en sessionStorage por administrador. Reintentar recupera el mismo resultado. El token continúa sólo en memoria. Una respuesta tardía de un panel cerrado no retira una operación diferente. Un conflicto requiere revisión y conserva la operación incierta.

Las consultas y escrituras de gestión tienen un plazo técnico de 15 segundos, incluida la lectura de la respuesta. Al agotarse, el panel informa el error y conserva la operación para reintentar. El aviso de recuperación recibe el foco al terminar un intento incierto o al recuperar la operación después de ingresar nuevamente. «Reintentar la misma operación de membresía» utiliza la clave y los datos originales. La selección de socios y la consulta de membresías siguen disponibles con una operación pendiente. Las nuevas escrituras se habilitan al recuperar su resultado.

## API propia

[OpenAPI de membresías 1.1.0](openapi-membresias-v1.yaml) añade dos operaciones compatibles con 1.0.0.

| Operación | Autorización y resultado |
|---|---|
| `GET /api/v1/socios/{socioId}/membresias` | JWT ADMIN o propietario. Devuelve `items` con todos los períodos registrados, incluidos futuros. |
| `POST /api/v1/membresias/{id}/suspender` | JWT ADMIN activo, `Idempotency-Key` de 8–128 caracteres alfanuméricos/guion y cuerpo `{}`. Devuelve 200 con membresía, socio, estado `SUSPENDIDA`, fechas conservadas, `eventId` y `suspendidaEn`. |

Misma clave y operación recupera el resultado original. Otra clave para la misma membresía suspendida conserva el evento original. Una suspensión histórica previa sin evento genera el aviso durable al ejecutar este comando. Una membresía registrada como `VENCIDA` produce conflicto de transición. Errores 400 por datos/clave, 401 autenticación, 403 permisos, 404 inexistencia y 409 transición o clave reutilizada. Ante 5xx/red conservar clave y cuerpo. Las respuestas son `no-store`. El 200 acredita el commit local, y el consumo es posterior.

## Contrato del evento

**Contrato formal del canal:** [AsyncAPI 3.0, versión 1.0.0](asyncapi-membresias-v1.yaml). Describe exchange, routing key, cola, DLQ, operaciones de publicación y consumo, headers de reintento y ejemplo. Validado con `@asyncapi/cli validate`.

[JSON Schema 1.0.0](membresia-actualizada-v1.schema.json) define `MembresiaActualizada`, `schemaVersion=1` y cambio `SUSPENSION`. Incluye ID único, socio/membresía/actor, instante y vigencia. El alcance actual produce avisos de suspensión. Una futura reactivación exige evolución compatible/versionada y cambio del consumidor.

Socios posee `membresias_outbox`. Clases posee `membresias_inbox` y `membresias_suspendidas`. Las migraciones son aditivas. El consumidor conserva reservas históricas y bloquea escrituras posteriores al evento con evaluaciones antiguas. Las promociones siguen usando la espera FIFO existente. El período de suspensión no amplía fechas ni modifica cobros.

## Operación y diagnóstico

`RABBITMQ_URL` ya se configura en Compose para ambos servicios. Producción exige esa variable. El arranque conecta en segundo plano, con reconexión automática. Broker caído conserva suspensión y Outbox pendientes. Su recuperación publica y consume sin repetir la cancelación. Con dos réplicas de Clases, ambas comparten la misma cola y cada entrega se confirma después de la transacción local.

En PowerShell, desde la raíz del proyecto, consultar logs y colas.

```powershell
docker compose logs --since 10m socios-membresias clases-reservas
docker compose exec -T rabbitmq su-exec rabbitmq rabbitmqctl list_queues -p gimnasio name messages_ready messages_unacknowledged
```

Para seguir una suspensión, buscar su `eventId` en logs. Las tablas de diagnóstico se consultan con el procedimiento del [README](../../README.md#consultar-las-bases-de-datos). `publicado_en IS NULL` indica publicación pendiente. La presencia en Inbox acredita procesamiento, y `canceladas` registra su efecto original.

Después de tres reintentos de 1, 5 y 15 segundos, los mensajes no procesables se conservan en `clases.membresias.v1.dlq` con causa técnica. Los inválidos van directamente allí. Antes de volver a publicar uno, revisar la causa y reparar el consumidor o la dependencia. Conservar evento e ID al repetirlo, y confirmar la republicación antes de retirarlo de la DLQ. No hay borrado ni reenvío automático de esa cola.

`npm run test:eventos` usa PostgreSQL y RabbitMQ efímeros con datos ficticios. [Evidencia y límites](../EVIDENCIA-EVENTOS-MEMBRESIA.md).
