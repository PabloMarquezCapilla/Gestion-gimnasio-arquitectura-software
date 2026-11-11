# Despliegue en la nube (VM con Docker)

**Decisión:** una VM Linux con el mismo Docker Compose que se usa localmente. Se agrega Caddy para HTTPS y la URL pública sale de [sslip.io](https://sslip.io), un DNS gratuito que resuelve `<ip-con-guiones>.sslip.io` a esa IP. Así no hace falta comprar dominio y Let's Encrypt emite el certificado igual.
**Por qué:** es el sistema completo, idéntico al que se probó: dos réplicas de Clases, PostgreSQL, MongoDB, RabbitMQ, Redis, Prometheus y Grafana. Un PaaS por servicio obligaría a reemplazar las bases por servicios gestionados y a separar la configuración de cada servicio. [D13](adr/ADR-013-capacidad-y-costos.md) registra 84,68 USD/mes de cómputo para la VM Azure elegida, según la estimación del portal confirmada por el equipo. El presupuesto total requiere disco, IP y consumo adicional.

```
Internet ──443──► Caddy (TLS) ──► Gateway NGINX (JWT, rate limiting, ruteo) ──► servicios
                        └──► grafana.<dominio> ──► Grafana
```

Solo se abren los puertos 80 y 443. Gateway, bases, broker y Prometheus siguen escuchando solo dentro de la VM.

## 1. Crear la VM (lo hace un integrante con su cuenta)

Cualquiera de estas sirve:

| Proveedor | Tamaño recomendado | Nota |
|---|---|---|
| Azure for Students | Standard B2s v2 (2 vCPU, 8 GiB), Ubuntu 24.04 | Tamaño desplegado; cómputo estimado en 84,68 USD/mes según el portal compartido por el equipo. |
| AWS | t3.large (2 vCPU, 8 GiB), Ubuntu 24.04 | Calculado en D13 (~67 USD/mes). |
| Google Cloud | e2-standard-2 (2 vCPU, 8 GiB) | Crédito inicial. |
| Oracle Cloud Free | Ampere A1 (4 OCPU, 24 GiB, ARM) | Gratis; las imágenes son multiarquitectura. |

Requisitos:
- 30 GB de disco e IP pública fija (estática o elástica).
- En el firewall o grupo de seguridad: **entrada TCP 22, 80 y 443** (y UDP 443, opcional).
- Acceso por SSH con clave.

## 2. Desplegar

En la VM:

```bash
git clone https://github.com/PabloMarquezCapilla/Gestion-gimnasio-arquitectura-software.git
```

```bash
cd Gestion-gimnasio-arquitectura-software && bash scripts/desplegar-vm.sh
```

El script ([`scripts/desplegar-vm.sh`](../scripts/desplegar-vm.sh)):
1. instala Docker y Node 22 si faltan;
2. usa el dominio guardado o calcula `DOMINIO=gimnasio.<ip>.sslip.io`;
3. pasa el dominio al inicializador con `COMPOSE_FILE=compose.yaml:compose.prod.yaml`. En una instalación nueva, el inicializador escribe el dominio y las credenciales juntos en `.env` antes de levantar los servicios;
4. verifica `https://<dominio>/health`.

Para actualizar `main` después de publicar una revisión, seguir [Actualizar la VM existente](#actualizar-la-vm-existente). El script conserva `.env` y los volúmenes. Conviene comprobar el commit resultante porque el script permite continuar aunque falle su `git pull` interno.

Después del primer despliegue:

```bash
npm run crear-admin
```

## 3. Configurar las integraciones (por canal privado, nunca en el repositorio)

El inicio operativo usa `CARGAR_DATOS_DEMO=false` por defecto. Para una demostración se puede habilitar `true` en el entorno elegido. La limpieza de cuentas, clases o reservas de demostración existentes se revisa con su historial antes de ejecutarla.

Accesos utiliza Córdoba, San Francisco y Hernando cuando `ACCESOS_SEDES_JSON` está vacío. Una lista configurada en `.env` tiene prioridad. El arranque actualiza los nombres por su identificador e incorpora sedes nuevas. El equipo confirmó conservar el historial de las pruebas compartidas de FAV y Car Cruds al revisar la limpieza de demostración.

Editar `.env` en la VM y volver a ejecutar el script:

| Variable | Dato | Quién lo entrega |
|---|---|---|
| `FAV_CATALOGO_BASE_URL`, `FAV_CATALOGO_API_KEY` | URL pública y clave del catálogo de FAV | FAV |
| `CAR_CRUDS_BASE_URL`, `CAR_CRUDS_TOKEN` | URL pública y token `gym` de Car Cruds | Car Cruds |
| `FAV_API_KEY` | Clave que **nosotros** le damos a FAV para consignaciones (generada por el inicio) | Nosotros → FAV |

## 4. URLs a publicar

**Despliegue activo al 10/11/2026.** VM en Azure Chile Central con Ubuntu 24.04, 2 vCPU y 8 GiB de RAM. El NSG `vm-gimnasio-nsg` permite TCP 80 y 443 para Caddy. Desde fuera de la VM se verificaron `200` en el portal, `/health` y el estado de Grafana. La consulta de consignaciones sin credencial respondió `401`.

El 11/11/2026 el equipo confirmó el tamaño **Standard B2s v2 (`Standard_B2s_v2`)** y la estimación de **84,68 USD/mes de cómputo**. Los costos de disco, IP y consumo adicional se completarán en D13 con los datos de la suscripción.

| Para quién | URL |
|---|---|
| Socios y la cátedra | [Portal del gimnasio](https://gimnasio.68-211-88-90.sslip.io/) |
| FAV, capacidad publicada | [URL base del gimnasio](https://gimnasio.68-211-88-90.sslip.io/) y [contrato de consignaciones](contracts/openapi-fav-v1.yaml) |
| Tablero de la presentación | [Grafana](https://grafana.gimnasio.68-211-88-90.sslip.io/) |
| Alertas (Prometheus) | Túnel SSH: `ssh -L 9090:localhost:9090 usuario@<ip>`, luego `http://localhost:9090/alerts` |

Si cambia el dominio, actualizar la URL pública en el README y los contratos que la publican.

## 5. Operación

```bash
docker compose -f compose.yaml -f compose.prod.yaml ps
```

```bash
docker compose -f compose.yaml -f compose.prod.yaml logs --since 10m gateway tienda
```

Los respaldos de PostgreSQL y MongoDB se realizan manualmente antes de actualizar o limpiar datos. Los comandos están en el procedimiento siguiente. La automatización de respaldos queda pendiente.

**Verificado localmente (09/11/2026):** el override de producción valida con `docker compose config`. Caddy sirvió por HTTPS el portal, `/health`, Grafana y la API de consignaciones con la clave de FAV, usando un dominio `.localhost`, que Caddy firma con su CA interna. En la VM, el certificado lo emite Let's Encrypt.

## Actualizar la VM existente

**Revisión del 11/11/2026 pendiente de despliegue.** Las correcciones están en `fix/datos-demostracion`, con 288 pruebas de regresión y 7 pruebas de reportes HTTP/PostgreSQL aprobadas, más compilación del frontend. El registro de esos ensayos y de los cambios está en el [plan de cierre](PLAN-ENTREGA-3.md#límites-y-dependencias). Este apartado describe la próxima actualización de Azure.

### Respaldo y versión instalada

Ejecutar desde el checkout de la VM. Las copias quedan en una carpeta privada dentro del home de su usuario. PostgreSQL y MongoDB se respaldan por separado.

```bash
umask 077
respaldo="$HOME/respaldos-gimnasio/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$respaldo"
cp .env "$respaldo/entorno.env"
git rev-parse HEAD > "$respaldo/version.txt"
docker compose -f compose.yaml -f compose.prod.yaml exec -T postgres pg_dumpall -U postgres > "$respaldo/postgres.sql"
docker compose -f compose.yaml -f compose.prod.yaml exec -T mongodb sh -c 'exec mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --db accesos --archive --gzip' > "$respaldo/accesos.archive.gz"
test -s "$respaldo/entorno.env"
test -s "$respaldo/postgres.sql"
gzip -t "$respaldo/accesos.archive.gz"
```

Comprobar que los comandos de copia finalizaron correctamente. El respaldo de configuración conserva las credenciales de las bases y las integraciones correspondientes a esos datos.

### Aplicar la versión publicada

Estos comandos actualizan `main` una vez integrada la revisión. Revisar `git status --short` y conservar cualquier cambio local antes de cambiar de rama.

```bash
git status --short
git switch main
git pull --ff-only origin main
git rev-parse --short HEAD
nano .env
```

En `.env`, establecer `CARGAR_DATOS_DEMO=false`. Para usar las sedes acordadas, dejar `ACCESOS_SEDES_JSON` vacío o configurar explícitamente los mismos identificadores y nombres definidos en [D3](adr/ADR-003-persistencia.md). Córdoba utiliza `sede-demo-01`, San Francisco `sede-demo-02` y Hernando `sede-hernando`. Accesos actualiza los nombres al iniciar y agrega Hernando cuando falta. Conservar las credenciales, el dominio y las URLs de integración existentes.

```bash
bash scripts/desplegar-vm.sh
docker compose -f compose.yaml -f compose.prod.yaml ps
curl --fail --show-error https://gimnasio.68-211-88-90.sslip.io/health
```

El despliegue reconstruye la interfaz y los servicios y aplica la configuración a los contenedores. El inicio con `CARGAR_DATOS_DEMO=false` conserva los registros ya persistidos.

### Limpieza de la demostración existente

El equipo acordó conservar el historial compartido con FAV y Car Cruds. La revisión detectó una compra y un vínculo de `socio-demo-01`, además de clases y reservas sintéticas. La limpieza debe identificar las relaciones actuales y conservar la cuenta vinculada, compras, pagos, membresías e historial de integración asociados a las pruebas compartidas. Los nombres de sedes cambian manteniendo los identificadores referenciados por clases y accesos.

La eliminación selectiva de la demostración restante se ejecutará después de revisar ese inventario y el respaldo, mediante transacciones en cada servicio propietario. Se registrarán los identificadores y cantidades afectados y los totales conservados. Su ejecución en Azure está pendiente.

### Comprobaciones posteriores

- Registrar el commit instalado y comprobar que los servicios están saludables y Clases conserva sus dos réplicas.
- Ingresar como ADMIN y consultar Córdoba, San Francisco y Hernando. Comprobar que los movimientos históricos siguen asociados a su sede.
- Revisar Panel principal, Caja y Reportes. Los resúmenes incluyen todos los registros, días y meses argentinos e importes por moneda. La ventana mensual abarca el mes actual y los cinco anteriores; los rankings son históricos. Una consulta fallida muestra un error. [Contratos vigentes](contracts/README.md#resúmenes-administrativos).
- Comprobar catálogo y stock de FAV, compras conservadas y vínculo/historial de Car Cruds. La limpieza de demostración mantiene los hechos de las pruebas compartidas.
- Revisar el tablero de Grafana y las métricas de las instancias. Registrar por separado cualquier prueba de escritura externa coordinada con los grupos.

La verificación visual de esta revisión y los resultados posteriores a la limpieza se incorporarán al registro de despliegue al ejecutarlos.

## Verificación de FAV

1. Configurar `FAV_CATALOGO_BASE_URL=https://fav-ucc.chilecentral.cloudapp.azure.com` y `FAV_CATALOGO_TIMEOUT_MS=3000`. Cargar en privado `FAV_CATALOGO_API_KEY` con la clave entregada por FAV. Compose pasa las tres variables a Tienda. `FAV_API_KEY` corresponde a la API de consignaciones del gimnasio.
2. Con Node 22, ejecutar `npm ci`, `npm run build` y `node scripts/verificar-fav-real.mjs` con `FAV_CATALOGO_API_KEY` exportada en el entorno del proceso. El verificador consulta por HTTPS el catálogo y la disponibilidad de hasta diez variantes y valida ambas respuestas con OpenAPI 1.2.0. El equipo verificó HTTP 200 para 5 productos, 19 variantes y disponibilidad de 10 variantes. En Azure, la consulta autenticada de consignaciones devolvió `200` con la clave de la VM. [Prueba conjunta](EVIDENCIA-TIENDA.md#prueba-conjunta-en-azure-del-10112026).
3. En un Compose aislado de pruebas con base y credenciales propias, levantar la versión con `npm run iniciar`. Comparar los `varianteId` obtenidos del catálogo con los `productoCodigo` de `GET /api/v1/consignaciones/stock?proveedorId=fav`, usando la clave de consignaciones de ese entorno. La Tienda solo muestra coincidencias con stock local positivo. La disponibilidad online del verificador es informativa.
4. Si el entorno aislado carece de stock, llamar a `POST /api/v1/consignaciones/reposiciones` **del gimnasio de pruebas**, con `X-API-Key` igual a su `FAV_API_KEY`, una `Idempotency-Key` única y JSON con `proveedorId: "fav"`, `productoCodigo` igual a un `varianteId` real, `unidades: 2` y una `referencia` de prueba única. Desde el portal, comprar una unidad como socio de prueba. Verificar confirmación, historial y saldo de una unidad. Repetir el POST de compra del gimnasio con el mismo cuerpo y la misma clave de idempotencia y comprobar que conserva el ID de compra y el saldo.

## Prueba conjunta con Car Cruds

**Estado confirmado por el equipo.** El gimnasio desplegado en Azure tiene conexión con Car Cruds. La versión del gimnasio es `49d2992`, con Socios saludable y contrato externo de referencia 0.4.0. El [registro de la integración](contracts/README.md#estado-de-la-conexión-en-azure) indica el alcance de la confirmación. Los pasos siguientes permiten reproducir las consultas y coordinar ensayos adicionales con empleados ficticios.

1. Pedir a Car Cruds el token privado con rol `gym`, el commit desplegado, el `employeeId` ficticio y el período acordado. La [especificación 0.4.0 fijada](contracts/car-cruds-employees-0.4.0.openapi.json) es la referencia.
2. En la raíz del checkout, tanto localmente como en la VM, editar el `.env` privado. Configurar `CAR_CRUDS_BASE_URL=https://57-156-56-201.sslip.io`, `CAR_CRUDS_TIMEOUT_MS=3000` y guardar el valor del token de aplicación en `CAR_CRUDS_TOKEN`, sin el prefijo Bearer. Con Node 22, ejecutar `npm ci`, `npm run build` y `node --env-file=.env scripts/verificar-car-cruds-real.mjs "<employeeId-ficticio>"`. El verificador hace solo GET, valida ambos esquemas y omite nombres, identificadores y credenciales de su salida.
3. Aplicar la configuración en el Compose local con `docker compose up -d --build --wait socios-membresias`. En la VM, usar `docker compose -f compose.yaml -f compose.prod.yaml up -d --build --wait socios-membresias` desde el checkout de la versión a desplegar. Ingresar como ADMIN, abrir **Empleados Car Cruds**, seleccionar el empleado acordado, buscar el socio ficticio por DNI o email, guardar el vínculo y revisar el historial. El estado laboral es informativo.
4. Elegir el mes, preparar la fotografía y revisar el contenido persistido. Verificar `member` contra las observaciones de vigencia, `used` contra ingresos aceptados y los importes contra el contrato y los pagos confirmados del gimnasio. Los datos desconocidos son `null`; un mes parcial o un reparto que requiera redondeo no determina un costo imputable. Las reglas y acuerdos abiertos figuran en [ADR-018](adr/ADR-018-integracion-car-cruds.md).
5. Con autorización de la prueba externa, confirmar el envío y pedir que Car Cruds compruebe el informe con su cuenta autorizada. Ante un resultado incierto, reintentar la misma fotografía desde el panel. Para una prueba conjunta de repetición tras un recibo confirmado, coordinar con Car Cruds un replay controlado del mismo cuerpo, referencia, versión y emisor. La UI conserva el recibo y no vuelve a emitir una fotografía ya confirmada. Comparar los totales antes y después del replay y registrar únicamente resultados técnicos sin datos personales.
