# Etapa 3 — Planes, pagos manuales y membresías

**Fecha:** 30/10/2026. **Base:** `db13cee1bc4d4f75e2b94ed5f5b8ba25dd66938b` (merge de PR #5). **Rama:** `feat/planes-pagos-membresias`.

La implementación, contrato y pruebas se conservan en el commit local `3ccbbaa`. Los logs corresponden al mismo código verificado antes de confirmar; el posterior cambio del título de un escenario sólo aclara que no confirma ni activa un período superpuesto.

## Fuentes, base y decisiones

Se verificó que PR #5 ya estaba fusionada y origin/main contenía los cinco commits de Accesos/MongoDB/Redis. La rama parte de ese merge; main local no se actualizó ni se modificó. `server 2.ts` se conservó sin editar, agregar o copiar al Compose de prueba. `.env` se comprobó por hash antes/después; no se muestran sus valores.

Se revisaron alcance RF-01–03/RN-G01–04/CA-G01–03 y CU-01, arquitectura, D2/D3/D4/D5/ADR-016/017/018, OpenAPI actuales, implementación de Socios/Clases, autenticación, repositorios, gateway, frontend y pruebas. El PDF original de WhatsApp sigue ausente y no apareció una copia con ese nombre en la búsqueda local; no se afirma nueva lectura ni verificación literal del PDF. Referencias del enunciado conservadas por el proyecto: persistencia §2.4, comunicación §2.5, consistencia §2.8 y decisiones §5. El alcance aprobado describe el dominio concreto y define confirmación **manual ADMIN** y comprobantes internos, sin pasarela ni factura fiscal.

| Tema | Fuente/regla documentada | Antes de etapa 3 | Resultado / decisión pendiente |
|---|---|---|---|
| Alta de cuenta | ADMIN, sin membresía; ADR-016 | Implementada | Reutilizada por web, sin habilitación automática |
| Listado administrativo | RF-01/CA-G03 | Placeholder vacío | PostgreSQL, permisos, paginación y datos públicos de socio |
| Planes | ADMIN los gestiona, RF-02 | Sin catálogo real | Creación/configuración sin tarifas demo, consulta y disponibilidad |
| Importe/moneda | No hay tarifas numéricas aprobadas | Sin backend | ADMIN configura importe exacto en unidad mínima y código reconocido; no valor ni conversión deducidos |
| Solicitud | Plan y pago necesarios para alta/renovación | Solicitud externa PENDIENTE sin plan | Solicitud administrativa separada con snapshot de plan y fechas; la anterior se conserva |
| Vigencia | Registrada y validada ahora/al inicio de clase | Evaluador e historial existentes | Fechas explícitas; no se calcula un mes ni se sustituye período vigente por uno futuro |
| Registro y confirmación | ADMIN registra/confirma, RF-03/RN-G02 | 501 activación directa | Pago PENDIENTE; comando explícito de confirmar cobro verificado |
| Comprobante | Interno, no fiscal, RN-G04 | Sin implementación | Identificador/fecha/pago/membresía/actor en PostgreSQL; importe/moneda en solicitud inmutable asociada |
| Reintento/concurrencia | RN-G03/CA-G02 | Sin operación económica | Transacción, bloqueos, unicidad y respuesta durable; igualdad de contenido por actor/clave |
| Rechazo | Ausencia de confirmación no habilita | Sin flujo | Rechazo terminal administrativo, sin membresía ni devolución implícita |
| Renovación | Nuevo pago habilita según vigencia | Sólo fixtures históricos | Nuevo período explícito no superpuesto, sin alterar historia anterior |
| Superposición/reactivación | Política no definida | Sin resolución | Bloqueo para revisión, no acumulación/sustitución/reactivación inventada |
| Suspensión posterior | RN-R08/CA-R09, D5 | Evento no implementado | Sigue pendiente de RabbitMQ; no se implementó en esta etapa |
| Clases | RN-R01–04 y FIFO | Operativo | Reconoce nuevas membresías por HTTP; no se accede a tablas ajenas |
| Car Cruds | Contrato 0.3.0/ADR-018 | Operativo con hechos desconocidos | Sin cambios de API/cálculo; no se infiere imputación mensual desde nuevos pagos |

No se considera terminado todo el ciclo comercial: cuotas, devoluciones, conciliación, prorrateos, acumulación/reactivación y condiciones de superposición requieren definición. El flujo definido de alta, pago manual completo, habilitación y reserva sí se recorre sin utilizar una membresía demo.

## Implementación y garantías

[ADR-021](adr/ADR-021-planes-pagos-membresias.md) detalla decisiones y límites. [OpenAPI propio](contracts/openapi-membresias-v1.yaml) contiene rutas, cuerpos, permisos, estados y errores. Las APIs externas no se alteraron.

- `membresias.gestion.ts`: validación estricta y normalización; importe entero seguro, código de moneda reconocido por Intl/ICU, fechas con zona y orden, claves y paginación.
- `membresias.http.ts`: JWT e identidad actual de Socios, ADMIN para escrituras/listado, propietario para consultas, no-store, métricas y logs correlacionados.
- `membresias.postgres.ts`: DDL aditivo y transacciones. Actor/clave serializados; fila de socio bloqueada; relectura posterior al bloqueo. Plan disponible se comprueba dentro de la transacción. Confirmación de pago, solicitud, membresía, comprobante y respuesta idempotente son atómicos.
- `MembresiasPanel`: reemplaza la maqueta administrativa sin registros por consultas y formularios reales. Incluye actualización, estado pendiente/rechazado, fechas explícitas, verificación manual, errores y replay de operación incierta por actor. No hay confirmación optimista.
- `UserPanel`: consulta perfil real al cambiar de pestaña y permite ver solicitudes/comprobantes propios; reserva con APIs existentes.

Precio/moneda se copian del plan a la solicitud y no se editan durante pago. El registro de un pago no habilita. Referencia única exacta, un pago por solicitud y un comprobante por pago evitan duplicación del identificador conocido. No se comprueba si un operador representa el mismo cobro físico con otra referencia: no hay conciliación bancaria ni pasarela. Ninguna prueba mueve dinero real ni acredita una factura fiscal.

Los resultados exitosos se conservan por actor/clave sin expiración automática. Un replay conserva la respuesta original aunque el estado posterior haya cambiado; la interfaz consulta el estado después. Cambiar comando/ruta/cuerpo con una clave ya confirmada devuelve 409. Una operación fallida con rollback no reserva la clave ni deja efecto económico/activación parcial. Ante pérdida de respuesta después del commit, el replay devuelve el resultado durable. SessionStorage no contiene JWT; contiene ruta/cuerpo/clave de una sola operación por administrador y persiste durante la pestaña, no sustituye el almacenamiento durable de PostgreSQL.

## Persistencia y actualización

Cinco tablas nuevas en la base de Socios:

| Tabla | Responsabilidad y restricciones |
|---|---|
| planes_membresia | Plan configurado, importe exacto y estado de disponibilidad; sin precios seed |
| solicitudes_planes | Socio, plan y snapshot económico/vigencia; único parcial por socio PENDIENTE |
| pagos_membresia | Registro manual, referencia global única y una solicitud por pago |
| comprobantes_membresia | Comprobante interno único por pago y membresía; fecha/administrador de confirmación |
| operaciones_membresia | Resultado exitoso por actor/clave, contenido normalizado y respuesta JSONB |

No se modifica la tabla de solicitudes externas anterior, ni las de Clases/Car Cruds/Accesos. Los índices/FK mantienen asociaciones. La membresía sigue usando el modelo existente y un registro por período. Las fechas de los períodos confirmados no se reescriben. Un período futuro no oculta uno actual y una suspensión existente no se reactiva por superposición.

Procedimiento: desplegar la nueva versión y ejecutar el inicializador habitual de Socios durante su arranque con permisos DDL; CREATE IF NOT EXISTS bajo bloqueo consultivo y transacción. Hacer respaldo por el procedimiento operativo del despliegue antes de aplicar cambios en entornos reales. **Esta ejecución sólo migró bases sintéticas exclusivas.** No usar down -v, truncados o recreación de una base existente para actualizar. El esquema es aditivo y puede coexistir con el código previo, pero una versión previa no administra los nuevos registros.

El ensayo de actualización crea el DDL real extraído de `db13cee`, inserta socio, membresía histórica y solicitud externa sintéticos, aplica dos veces el inicializador y comprueba preservación exacta del socio y existencia de membresía/solicitud. No se restauró una copia de una base real ni se ensayaron todos los esquemas personalizados posibles. La inicialización histórica de cuentas demo no se cambió; el recorrido nuevo utiliza cuentas creadas durante el ensayo.

## Verificaciones realmente ejecutadas

Entorno: macOS ARM64, Node 22.23.3; Docker Desktop 29.7.2 pudo iniciarse sin alterar servicios existentes. PostgreSQL **17.11**, MongoDB y Redis reales en contenedores exclusivos. Chrome instalado y NGINX 1.28.0 temporal para navegador. Datos, importes, monedas y cuentas de prueba son explícitamente sintéticos; no son tarifas propuestas para despliegue.

| Verificación | Resultado nuevo de esta etapa |
|---|---|
| Referencia previa `npm test` | 190 aprobadas, 0 fallos |
| Referencia previa `node scripts/verificar-postgres.mjs` | Aprobada con PostgreSQL real, dos pools, Car Cruds controlado y FIFO |
| Regresión final `npm test` | 196 aprobadas, 0 fallos; compila todos los servicios |
| `npm run frontend:build` | Aprobado con TypeScript y Vite |
| `test:membresias` + herramientas de navegador | 21 aprobadas, 0 fallos; 20 escenarios y contenedor lógico |
| `node scripts/verificar-postgres.mjs` posterior | Aprobado: reservas, autenticación, Car Cruds, concurrencia y recuperación existentes |
| `node --test scripts/verificar-cache-ocupacion.mjs` | 11 aprobadas, 0 fallos; Redis/Mongo reales en Docker, pausa, reinicio y fallback |
| `node --test scripts/verificar-accesos.mjs` + navegador/caché | 15 aprobadas, 0 fallos; Mongo en Docker y frontend real |
| `node scripts/verificar-balanceo.mjs` | Compose completo aislado, NGINX, PostgreSQL compartido, dos réplicas y reemplazo sin reiniciar gateway; aprobado |
| `docker compose config --quiet` y `git diff --check` | Aprobados |

Las cantidades son suites separadas: no deben sumarse como si fueran pruebas todas independientes. El benchmark de caché anterior no se reejecutó ni se presenta como medición nueva de esta etapa. Los fixtures de proveedor Car Cruds son servidores controlados: no acreditan la conexión con el grupo externo. El broker configurado en Compose no acredita eventos de membresía implementados.

### Escenarios nuevos

1. Base sin planes nuevos: no se inventa catálogo/precio. Alta administrativa crea cuenta sin membresía.
2. ADMIN/SOCIO/propietario/no autenticado y rechazo de comandos económicos no autorizados; consultas sin hashes ni credenciales.
3. Plan explícito, clave repetida entre instancias y contenido incompatible; importes fraccionarios/negativos/no seguros, moneda desconocida y campos adicionales rechazados.
4. Plan inexistente, inactivo, fechas inválidas y fin de vigencia pasado.
5. Dos solicitudes con claves distintas dejan sólo una pendiente.
6. Registro manual exacto sin habilitación; importe/moneda incompatibles bloqueados; referencia reutilizada en otro socio rechazada.
7. Reserva antes de confirmar rechazada, después aceptada; duplicada y fuera de cobertura rechazadas.
8. Trigger exclusivo de la base efímera falla al insertar comprobante: revierte pago, solicitud, membresía, comprobante y clave. Al retirar el trigger se reintenta la misma clave.
9. Primera confirmación concurrente con 12 peticiones a dos instancias (claves iguales y diferentes): una membresía y un comprobante, misma respuesta de confirmación.
10. Rechazo, confirmación de rechazado y rechazo de confirmado; solicitud vencida no habilita.
11. Período futuro explícito no superpuesto y cobertura actual conservada; superposición bloqueada sin confirmar el pago.
12. Plan desactivado entre solicitud y confirmación impide habilitación.
13. Reconstrucción de aplicación conserva registros en PostgreSQL; logs/métricas distinguen replay y fallos con correlación, sin importes/credenciales ni etiquetas personales.
14. Actualización desde el DDL anterior y repetición sin pérdida de datos sintéticos.
15. Navegador: alta real, creación de plan, solicitud, pago pendiente, verificación explícita, respuesta de confirmación perdida después del commit, recarga/login/replay, comprobante propio y reserva de clase real. No se sustituye el backend por respuestas ficticias.
16. Socios detenido: Clases rechaza de manera segura, sin asumir habilitación.

Las respuestas de las rutas nuevas se validan durante la integración contra los esquemas de OpenAPI (incluyendo errores). La aceptación de fechas y su relación con Clases usa los evaluadores existentes; no se modifica FIFO.

### Fallos encontrados y corregidos

- Build local inicial: tipos ambientales `node 2`, ajenos al proyecto. Se limitan tipos frontend a React/React DOM/Vite, manteniendo strict/noUnused; no se modifica ni elimina la carpeta ajena.
- Primer navegador: selector refería a un nombre de pestaña inexistente. Se corrigió al nombre real y se repitió todo el flujo, sin omitir pasos.
- Nueva prueba de respuesta financiera inválida: el helper genérico conservaba status 200 al fallar JSON. La capa de gestión ahora informa 502 y mantiene la operación incierta; no limpia su clave ni muestra éxito.
- MongoDB de los primeros intentos Docker de Accesos/caché no inició por incompatibilidad con kernel >=6.19. Compose ya declaraba `GLIBC_TUNABLES=glibc.pthread.rseq=1`; se aplicó la misma configuración sólo a sus fixtures de prueba y se repitieron los escenarios completos. El primer ajuste no alcanzó la línea partida del script de Accesos; la repetición volvió a detectar el arranque fallido y se corrigió también esa llamada. No se modificó Docker Desktop, el kernel ni contenedores del grupo.

En los logs conservados se normalizaron la ruta absoluta del checkout a `<REPO>` y espacios finales de una línea vacía para no publicar una ruta personal; los resultados no se alteraron. Logs finales y fallos iniciales de infraestructura/navegador están en [evidencia](evidence/membresias/). No se deshabilitaron pruebas ni se fabricaron resultados.

## Reproducción

```sh
# Node 22 y Docker disponibles; no usar DATABASE_URL del usuario para estas pruebas.
npm run build
npm test
npm run test:membresias
npm run frontend:build
npm run test:postgres
npm run test:cache
npm run test:accesos
npm run test:balanceo
```

Para navegador de membresías, construir frontend y configurar rutas locales explícitas: `MEMBRESIAS_PLAYWRIGHT_MODULE`, `MEMBRESIAS_CHROME_BIN`, `NGINX_BIN` y `NGINX_MIME_TYPES`; ejecutar `npm run test:membresias`. `MEMBRESIAS_SCREENSHOT` es opcional. Sin Playwright configurado, los escenarios backend se ejecutan pero el opcional de navegador no se agrega: no confundir ese resultado con cobertura web. No se instala navegador en el sistema. Los scripts generan nombre/etiqueta, puerto loopback y credenciales aleatorias de su recurso; su limpieza comprueba propiedad y retira únicamente lo creado por ellos. El script de balanceo excluye explícitamente `server 2.ts`.

## Cumplimiento y pendientes

Se acreditan localmente RF-01–03/RN-G01–04/CA-G01–03 para el flujo administrativo manual y nuevos períodos explícitos no superpuestos; RF-05 para consulta propia y RN-R01–04 con nuevas membresías. Se conserva propiedad de datos, PostgreSQL transaccional, autenticación, observabilidad existente y decisiones D3/D4. Accesos/Redis/Car Cruds y FIFO pasan sus regresiones.

Pendientes concretos: políticas de superposición/reactivación, acumulación/prorrateo, cuotas, devoluciones, vencimiento administrativo de solicitudes, conciliación y la imputación de pagos al intercambio mensual Car Cruds. Tarifas reales deben ser configuradas por el administrador responsable. La cancelación de reservas tras suspensión depende de RabbitMQ (otra etapa). El PDF original y los acuerdos externos operativos siguen ausentes; no se declara completado el proyecto general ni la validación en producción. No se implementó Tienda/FAV, broker de eventos ni tablero global. No hubo push ni merge.
