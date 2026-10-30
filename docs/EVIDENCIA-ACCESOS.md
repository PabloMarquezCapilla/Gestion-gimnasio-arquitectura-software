# Etapa 1: evidencia de Accesos y Ocupación

**Fecha:** 30/10/2026. **Base:** `7f69fa41e1030ff9d2657c3fccc43873710a23e8`. **Rama:** `feat/accesos-mongo-recepcion`.

## Resultados ejecutados en esta etapa

| Verificación | Resultado observado |
|---|---|
| Primer intento con Node del sistema | No inició: instalación Node 26 con biblioteca dinámica faltante. No se modificó el sistema para repararla. |
| Intento con runtime alternativo y dependencias anteriores | Build falló por módulos locales faltantes tras la sincronización. Se restauraron dependencias desde lockfiles, sin cambiar tests para ocultarlo. |
| Referencia antes de implementar, Node 22.23.3 y `npm ci --ignore-scripts` | `npm test`: **173 aprobadas, 0 fallidas, 0 omitidas**. Son ejecuciones actuales, no se reutilizó el resultado histórico del README. |
| Dependencias frontend | `npm --prefix frontend ci --ignore-scripts`, completado; lockfile frontend no modificado. |
| Regresión final | `npm test`: **187 aprobadas, 0 fallidas, 0 omitidas**. Compila los cuatro servicios e incluye reglas/autenticación/reservas/Car Cruds y 14 pruebas nuevas (10 backend/gateway y 4 cliente frontend). |
| Build frontend | `npm run frontend:build`: TypeScript + Vite, completado. |
| MongoDB real sin navegador | `ACCESOS_TEST_MODE=native MONGOD_BIN=/ruta/mongod npm run test:accesos`: **14 aprobadas, 0 fallidas, 0 omitidas** (13 escenarios y contenedor lógico de tests). |
| MongoDB + Chrome + NGINX reales, versión final | Mismo comando con herramientas opcionales indicadas debajo: **15 aprobadas, 0 fallidas, 0 omitidas** (14 escenarios y contenedor lógico). |
| Revisión de diff | `git diff --check`, sin errores de espacios. |

Entorno ejecutado: macOS ARM64, Node **22.23.3**, MongoDB **8.0.28** nativo, NGINX **1.28.0** compilado exclusivamente en `/tmp`, Google Chrome existente y Playwright del runtime de herramientas, sin agregar Playwright a dependencias del proyecto. MongoDB se inició con bind `127.0.0.1`, puerto libre y dbpath exclusivo. No se cargó `.env` ni se usaron bases/volúmenes del grupo.

La primera verificación nativa de NGINX requirió ajustar su herramienta de prueba: la compilación inicial omitía el módulo rewrite que usa `return`; se recompiló con PCRE2 estático fuera del repositorio. La copia temporal de configuración adapta puertos, nombres DNS de contenedores, raíz estática y mime.types; en macOS aumenta solo las zonas temporales por páginas de 16 KiB. Las rutas, autorización de servicio y ausencia de reintento del POST corresponden a la configuración del proyecto. No se afirma haber ejecutado la imagen NGINX Linux ni su descubrimiento DNS Docker.

## Escenarios comprobados

1. Ingreso habilitado: movimiento y presencia persistidos, correlación devuelta.
2. Membresía suspendida/vencida, socio inexistente e ingreso abierto: rechazo conservado sin cambiar ocupación.
3. **20 ingresos concurrentes**, dos clientes/pools y dos instancias HTTP: uno aceptado y 19 conflictos.
4. **20 egresos concurrentes**: uno aceptado, 19 conflictos; otra salida se rechaza sin negativos.
5. **12 replays simultáneos**: mismo ID/resultado, una operación durable. Repetir un ingreso antiguo después de egresar no reabre la presencia.
6. Misma clave simultánea con cuerpos distintos: solo uno se aplica; el otro recibe conflicto.
7. Ocupación por sede igual al conteo real de presencias abiertas.
8. Fallo provocado mediante validador en la colección de idempotencia **de la base temporal**: rollback de movimiento y apertura; al retirar ese validador temporal, misma clave puede confirmar.
9. Historial por sede/socio/página; sede inexistente, 401 y 403.
10. Reinicio de **proceso real** `server.js` en modo producción: conserva ocupación y replay.
11. Socios HTTP detenido: no ingresa, egreso y replay siguen funcionando.
12. Cliente Mongo cerrado: errores 503 y salud sin filtrar URI.
13. **Motor MongoDB detenido y reiniciado realmente**: durante caída no se confirma movimiento; después conserva historial y ocupación y admite reintentar. El modo Docker utiliza pausa/reanudación para conservar su tmpfs.
14. Navegador a través de NGINX: login ADMIN, selección de sede, ingreso, respuesta perdida después de commit, recarga/login, replay, duplicado, egreso, rechazo por membresía suspendida e historial. Sin excepciones JavaScript de página.

El esquema de respuestas de movimientos se valida contra el OpenAPI interno durante la integración. Los unitarios también verifican entradas inválidas/inyección de operadores, identidad, JWT vencido/futuro/alterado, presupuesto HTTP con cuerpo abierto, reintento GET transitorio, errores sin detalles privados y configuración del gateway.

**Dependencia Socios:** se ejecuta su aplicación HTTP real con JWT y lógica reales, usando su adaptador en memoria exclusivamente para datos ficticios de la prueba. La persistencia principal de Accesos siempre es MongoDB real. Esta prueba no acredita integración PostgreSQL.

## Reproducción

Requisitos generales: Node 22 y dependencias locales del lockfile. Para ruta Docker, daemon disponible y contenedores Linux:

```sh
npm ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm test
npm run frontend:build
npm run test:accesos
```

Alternativa con mongod local instalado, sin daemon Docker:

```sh
ACCESOS_TEST_MODE=native MONGOD_BIN=/ruta/al/mongod npm run test:accesos
```

La prueba de navegador es opcional para ejecutar la suite MongoDB. Para incluirla, construir primero el frontend y configurar explícitamente herramientas existentes:

```sh
ACCESOS_TEST_MODE=native \
MONGOD_BIN=/ruta/al/mongod \
NGINX_BIN=/ruta/al/nginx \
NGINX_MIME_TYPES=/ruta/al/mime.types \
ACCESOS_PLAYWRIGHT_MODULE=/ruta/a/playwright/index.mjs \
ACCESOS_CHROME_BIN=/ruta/al/chrome \
npm run test:accesos
```

`ACCESOS_SCREENSHOT=/ruta/fuera/del/repositorio/captura.png` conserva una captura si se desea. En la ejecución de esta etapa se revisó visualmente esa captura con datos ficticios.

El runner crea y limpia únicamente recursos propios: dbpath temporal con marcador, proceso hijo y, en modo Docker, contenedor con etiqueta única verificada antes de eliminarlo. No hay `down -v`, uso de volúmenes existentes ni reinicialización de datos ajenos. No pasar una URL existente como destino; el runner genera su propia URL.

## Límites y verificaciones pendientes

- Docker no estaba ejecutándose. No se ejecutaron `test:postgres`, `test:balanceo` ni el Compose completo; no se presentan como aprobados.
- Se probó el flujo web real, no todo el producto ni todas las combinaciones visuales/responsive.
- JWT ADMIN se valida localmente hasta vencimiento, como Clases/Tienda; revocación inmediata no está implementada. No se inventa un rol RECEPCION.
- No se implementan caché, envío de uso a Car Cruds, pagos, mensajería, tablero o alertas en esta etapa.
- El PDF original temporal dejó de estar disponible. Las referencias al enunciado provienen de la lectura verificada en la auditoría anterior; en esta etapa se contrastó alcance/ADR/código vigentes.
- Concurrencia probada en los escenarios indicados; no demuestra capacidad máxima, tolerancia multizona ni ausencia de toda falla posible.

## Criterios de aceptación

CA-G05, CA-G06 y CA-G07 tienen respaldo de API, MongoDB real, concurrencia y recorrido web. La integración completa de las imágenes/Compose en Linux queda **no verificable en este entorno**, y debe ensayarse antes de presentar. El resto de las capacidades de esta etapa está implementado y verificado con los límites anteriores.
