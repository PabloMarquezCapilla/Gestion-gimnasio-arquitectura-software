# D9 - Consumo del proveedor

**Estado:** diseño de adaptador conservado y estructura Tienda preparada; integración externa pendiente.
**Fecha inicial:** 12/10/2026. **Alcance confirmado:** 19/10/2026.
**Enunciado:** §4.1, páginas 5–6; §5 D9, página 7; §6.3, página 8.

## Contexto

La asignación comunicada por el equipo requiere consultar productos y stock de una distribuidora. La capacidad es conocida, pero faltan identificación operativa del proveedor, contrato, URL y autenticación. El alcance es solo consulta, sin compras ni reposición.

## Decisión

**Tienda** iniciará la llamada externa y adaptará el contrato al modelo del gimnasio mediante un cliente dedicado (Adapter / capa de adaptación). Se mantiene la política de aislar tipos, errores y versiones del proveedor. El navegador llama a Tienda por nuestro gateway; la salida al proveedor parte directamente del microservicio.

El catálogo y las existencias pertenecen a la distribuidora. No se incorpora base, copia local ni caché en Tienda. Una consulta fallida representa información desconocida y no permite mostrar stock cero o un catálogo vacío como resultado válido. [D1](ADR-015-limites-con-tienda.md).

### Parte propia implementada

- Workspace `services/tienda`, imagen/Compose y estructura en Capas: `app.ts` → `services.ts`, composición en `server.ts`.
- `GET /api/v1/tienda/productos` es una ruta del gimnasio con JWT. Responde `503` y `INTEGRACION_PENDIENTE`; no contiene productos ni invoca una API ficticia.
- `/health/tienda` acredita el proceso con `estado: estructura`, `integracion: PENDIENTE_CONTRATO`, `persistencia: ninguna`.
- La pantalla distingue carga, integración pendiente y error de comunicación; un 503 conserva la sesión y un 401 la invalida.

### Adaptación y resiliencia pendientes

Al recibir el contrato se fijarán rutas, campos, filtros/paginación, validación de respuestas, traducción de errores, autenticación y test de contrato capaz de detectar incompatibilidades. Se conserva el diseño general de timeout, reintentos de lecturas seguras, circuit breaker y degradación controlada; sus valores dependen del contrato y todavía no están implementados para Tienda.

Los ejemplos anteriores de otros dominios (pagos, clima o biometría) eran hipótesis previas a la asignación; no pertenecen al alcance vigente. Los parámetros numéricos orientativos de esa propuesta no se presentan como políticas acordadas con la distribuidora.

La integración real debe incorporarse al flujo de consulta del socio y demostrar consecuencias de negocio según §4.1. Una pantalla de estado o llamada aislada no acredita ese requisito. La aceptación del flujo y el comportamiento ante caída del proveedor se verificarán con el contrato y en la prueba conjunta.

## Alternativas y consecuencias

Consumir desde el navegador expondría la integración al cliente y contradice §4.1; hacerlo desde nuestro gateway desplazaría una responsabilidad de negocio. Duplicar stock convertiría al gimnasio en otro propietario de datos que solo debe consultar.

El adaptador concentra cambios del proveedor, pero un cambio incompatible aún puede exigir revisar tipos y comportamiento propios; no se garantiza que baste con cambiar una URL. La estructura se verifica con `npm test` y el arranque de Compose; no hay consumo externo, test de contrato del proveedor ni ensayo de su caída mientras no se disponga del contrato.
