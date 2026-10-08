# Capacidad compartida: consulta de clases y cupos

**Servicio propietario:** Clases y Reservas.  
**Contrato vigente de diseño:** [openapi-v1.yaml](openapi-v1.yaml), versión `1.0.0`, formato [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html).  
**Estado:** capacidad seleccionada y mock local preparado para la Entrega 1; implementación real y URL pública pendientes. El grupo consumidor todavía no fue asignado por la cátedra.

El contrato y este documento cumplen la documentación de integración solicitada en las secciones 3 y 4.1 del enunciado. Su justificación está en [D8](../adr/ADR-008-contrato-propio.md).

## Qué ofrece y cómo integrarla

Permite consultar clases publicadas y los cupos que tienen libres. El microservicio responsable del flujo del grupo consumidor llamará a nuestra URL de proveedor; nuestro API Gateway dirigirá las consultas a Clases y Reservas.

El uso dentro de un flujo importante del consumidor deberá acordarse cuando se asigne el grupo. Esta documentación no presupone su dominio ni afirma que la integración ya esté validada.

## Mock de la Entrega 1

Se inicia siguiendo el [README principal](../../README.md#ejecutar-localmente), con `node scripts/iniciar.mjs`. La base local es `http://localhost:8080` y las rutas son las del contrato. `CAPACIDAD_API_KEY` del `.env` generado se envía en `X-API-Key`; no se publica ninguna clave real.

El mock se ejecuta dentro de Clases y Reservas con cuatro clases ficticias en memoria: una con cupos, una llena, una de otra sede y una ya iniciada. `consultadoEn` se genera en cada consulta. Las respuestas exitosas llevan `Cache-Control: no-store` y el encabezado adicional `X-Mock: true` para identificar esos datos. No consulta la base, no valida membresías ni modifica reservas.

Las pruebas de `npm test` verifican esquemas y encabezados del contrato, autenticación, filtros, intervalos, paginación, orden y errores. El hito se llama «Diseño y contrato con mock» en la sección 6.2, página 7; la estructura inicial se solicita en página 8.

Esta URL sirve en la máquina donde se levanta el entorno. La URL pública de la implementación real se documentará al desplegarla; no se presenta localhost como un despliegue accesible al otro grupo.

## Operaciones

| Operación | Resultado |
|---|---|
| `GET /api/v1/clases` | Listado paginado de clases con su disponibilidad. Filtros opcionales: `sedeId`, `desde` y `hasta`. |
| `GET /api/v1/clases/{claseId}` | Datos y cupos de una clase publicada concreta. |

El listado se ordena por inicio ascendente y, en caso de empate, por `claseId` ascendente. `pagina` empieza en 1; `tamanio` vale 20 por defecto y admite de 1 a 100. Los filtros temporales se aplican al inicio de la clase: `desde` es inclusivo y `hasta` exclusivo. Las fechas llevan zona horaria; si se proporcionan ambos límites, `desde` debe ser anterior a `hasta`. Sin esos filtros también pueden aparecer clases iniciadas.

Los identificadores son valores opacos; el consumidor no debe deducir significado de su formato. No se publican datos personales de socios, membresías o pagos.

## Significado de la disponibilidad

- `cuposDisponibles` corresponde a capacidad menos reservas confirmadas; debe estar entre cero y la capacidad.
- Se calcula con datos del almacenamiento propietario al producir la respuesta, evitando presentar el índice de búsqueda como disponibilidad actual.
- Las respuestas exitosas enviarán `Cache-Control: no-store` para evitar su reutilización desde cachés HTTP, conforme a [RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2.5).
- `consultadoEn` indica el instante de consulta de esos datos. La disponibilidad puede cambiar después o entre dos consultas.
- Consultar no retiene un cupo ni valida la membresía de un socio. Una eventual reserva debe aplicar las reglas de membresía, inicio y prioridad de la lista de espera del gimnasio.
- Una clase llena devuelve `200` con cero cupos. Una clase iniciada sigue siendo consultable si existe, aunque no admita nuevas reservas.
- Las páginas se consultan por separado; los cambios concurrentes pueden modificar los resultados entre páginas.

## Autenticación, idempotencia y errores

La propuesta inicial utiliza una clave del grupo consumidor enviada en `X-API-Key`. En el entorno operativo se utilizará HTTPS. La clave real se entregará fuera del repositorio y se configurará como secreto del entorno. No se exige una cuenta de socio para estas consultas.

Las respuestas `401` incluirán `WWW-Authenticate: ApiKey realm="clases"`, según el requisito de desafío de autenticación de [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.2).

Las dos operaciones son lecturas idempotentes: repetirlas no modifica registros ni crea reservas. No requieren una clave de idempotencia; sus resultados pueden cambiar con el estado del gimnasio.

| HTTP | Código del cuerpo | Interpretación |
|---|---|---|
| `400` | `PARAMETROS_INVALIDOS` | Corregir filtros, intervalo o paginación del listado. |
| `401` | `NO_AUTENTICADO` | Revisar la clave, ausente o inválida. |
| `404` | `CLASE_NO_ENCONTRADA` | El detalle solicitado no corresponde a una clase publicada. |
| `500` | `ERROR_INTERNO` | No se pudo completar la consulta. |
| `503` | `SERVICIO_NO_DISPONIBLE` | Servicio o almacenamiento temporalmente indisponible. |

Un listado sin coincidencias devuelve `200` con `items: []`. Ante fallas HTTP, tiempo de espera agotado o falta de respuesta, el consumidor debe tratar la disponibilidad como desconocida; no equivale a cero cupos. Sus tiempos de espera y reintentos se definirán en la integración correspondiente.

## Ejemplos

Todos los identificadores, actividades y fechas de los ejemplos son ficticios. `<host-del-proveedor>` y `<clave-del-consumidor>` son marcadores que deberán reemplazarse cuando se publique el entorno.

```http
GET /api/v1/clases?sedeId=sede-demo-01&pagina=1&tamanio=20 HTTP/1.1
Host: <host-del-proveedor>
X-API-Key: <clave-del-consumidor>
Accept: application/json
```

Respuesta `200`:

```json
{
  "items": [
    {
      "claseId": "clase-demo-001",
      "nombre": "Yoga",
      "sedeId": "sede-demo-01",
      "inicio": "2026-11-12T18:00:00-03:00",
      "capacidad": 20,
      "cuposDisponibles": 3,
      "consultadoEn": "2026-11-12T17:30:00-03:00"
    }
  ],
  "pagina": 1,
  "tamanio": 20,
  "total": 1
}
```

```http
GET /api/v1/clases/clase-demo-001 HTTP/1.1
Host: <host-del-proveedor>
X-API-Key: <clave-del-consumidor>
Accept: application/json
```

El detalle devuelve el objeto de la clase mostrado dentro de `items`. El contrato incluye además ejemplos de clase llena, listado vacío y errores. Ejemplo de `404`:

```json
{"codigo": "CLASE_NO_ENCONTRADA", "mensaje": "No se encontró la clase solicitada."}
```

## Versionado y publicación

- La versión inicial del contrato es `1.0.0`; las rutas identifican la versión mayor con `/api/v1`.
- Se conservará el contrato de cada versión mayor. Un cambio incompatible, como eliminar campos u operaciones o modificar su significado, requerirá una nueva versión mayor y coordinación con el consumidor.
- Los cambios compatibles, como agregar campos opcionales, incrementarán la versión menor. El consumidor debe tolerar campos nuevos y no depender del texto de los mensajes de error.
- Las correcciones documentales que mantengan el comportamiento incrementarán la versión de parche. Todo cambio se documentará junto al contrato.
- El mock local utiliza el contrato inicial `1.0.0`; su base es `http://localhost:8080`. La URL operativa pública se registrará aquí cuando exista.
- El contrato quedará junto al código en el repositorio público. La capacidad real deberá desplegarse y mantenerse accesible durante la evaluación, según el enunciado.
