# Despliegue en la nube (VM con Docker)

**Decisión:** una VM Linux con el mismo Docker Compose que se usa localmente. Se agrega Caddy para HTTPS y la URL pública sale de [sslip.io](https://sslip.io), un DNS gratuito que resuelve `<ip-con-guiones>.sslip.io` a esa IP. Así no hace falta comprar dominio y Let's Encrypt emite el certificado igual.
**Por qué:** es el sistema completo, idéntico al que se probó: dos réplicas de Clases, PostgreSQL, MongoDB, RabbitMQ, Redis, Prometheus y Grafana. Un PaaS por servicio obligaría a reemplazar las bases por servicios gestionados y a separar la configuración de cada servicio. El costo está estimado en [D13](adr/ADR-013-capacidad-y-costos.md).

```
Internet ──443──► Caddy (TLS) ──► Gateway NGINX (JWT, rate limiting, ruteo) ──► servicios
                        └──► grafana.<dominio> ──► Grafana
```

Solo se abren los puertos 80 y 443. Gateway, bases, broker y Prometheus siguen escuchando solo dentro de la VM.

## 1. Crear la VM (lo hace un integrante con su cuenta)

Cualquiera de estas sirve:

| Proveedor | Tamaño recomendado | Nota |
|---|---|---|
| Azure for Students | B2ms (2 vCPU, 8 GiB), Ubuntu 24.04 | Crédito educativo sin tarjeta. |
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

Es idempotente: para actualizar después de un push a `main`, volver a ejecutarlo. `.env` y los volúmenes se conservan.

Después del primer despliegue:

```bash
npm run crear-admin
```

## 3. Configurar las integraciones (por canal privado, nunca en el repositorio)

Editar `.env` en la VM y volver a ejecutar el script:

| Variable | Dato | Quién lo entrega |
|---|---|---|
| `FAV_CATALOGO_BASE_URL`, `FAV_CATALOGO_API_KEY` | URL pública y clave del catálogo de FAV | FAV |
| `CAR_CRUDS_BASE_URL`, `CAR_CRUDS_TOKEN` | URL pública y token `gym` de Car Cruds | Car Cruds |
| `FAV_API_KEY` | Clave que **nosotros** le damos a FAV para consignaciones (generada por el inicio) | Nosotros → FAV |

## 4. URLs a publicar

**Despliegue activo al 10/11/2026.** VM en Azure Chile Central con Ubuntu 24.04, 2 vCPU y 8 GiB de RAM. El NSG `vm-gimnasio-nsg` permite TCP 80 y 443 para Caddy. Desde fuera de la VM se verificaron `200` en el portal, `/health` y el estado de Grafana. La consulta de consignaciones sin credencial respondió `401`.

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

**Backups:** `docker compose exec -T postgres pg_dumpall -U postgres > backup.sql`, y para MongoDB, `mongodump` desde su contenedor. No hay backups automáticos; es una limitación aceptada para la evaluación.

**Verificado localmente (09/11/2026):** el override de producción valida con `docker compose config`. Caddy sirvió por HTTPS el portal, `/health`, Grafana y la API de consignaciones con la clave de FAV, usando un dominio `.localhost`, que Caddy firma con su CA interna. En la VM, el certificado lo emite Let's Encrypt.

## Verificación de FAV

1. Configurar `FAV_CATALOGO_BASE_URL=https://fav-ucc.chilecentral.cloudapp.azure.com` y `FAV_CATALOGO_TIMEOUT_MS=3000`. Cargar en privado `FAV_CATALOGO_API_KEY` con la clave entregada por FAV. Compose pasa las tres variables a Tienda. `FAV_API_KEY` corresponde a la API de consignaciones del gimnasio.
2. Con Node 22, ejecutar `npm ci`, `npm run build` y `node scripts/verificar-fav-real.mjs` con `FAV_CATALOGO_API_KEY` exportada en el entorno del proceso. El verificador consulta por HTTPS el catálogo y la disponibilidad de hasta diez variantes y valida ambas respuestas con OpenAPI 1.2.0. El equipo verificó HTTP 200 para 5 productos, 19 variantes y disponibilidad de 10 variantes. En Azure, la consulta autenticada de consignaciones devolvió `200` con la clave de la VM. [Prueba conjunta](EVIDENCIA-TIENDA.md#prueba-conjunta-en-azure-del-10112026).
3. En un Compose aislado de pruebas con base y credenciales propias, levantar la versión con `npm run iniciar`. Comparar los `varianteId` obtenidos del catálogo con los `productoCodigo` de `GET /api/v1/consignaciones/stock?proveedorId=fav`, usando la clave de consignaciones de ese entorno. La Tienda solo muestra coincidencias con stock local positivo. La disponibilidad online del verificador es informativa.
4. Si el entorno aislado carece de stock, llamar a `POST /api/v1/consignaciones/reposiciones` **del gimnasio de pruebas**, con `X-API-Key` igual a su `FAV_API_KEY`, una `Idempotency-Key` única y JSON con `proveedorId: "fav"`, `productoCodigo` igual a un `varianteId` real, `unidades: 2` y una `referencia` de prueba única. Desde el portal, comprar una unidad como socio de prueba. Verificar confirmación, historial y saldo de una unidad. Repetir el POST de compra del gimnasio con el mismo cuerpo y la misma clave de idempotencia y comprobar que conserva el ID de compra y el saldo.

## Prueba conjunta con Car Cruds

1. Pedir a Car Cruds el token privado con rol `gym`, el commit desplegado, el `employeeId` ficticio y el período acordado. La [especificación 0.4.0 fijada](contracts/car-cruds-employees-0.4.0.openapi.json) es la referencia.
2. En la raíz del checkout, tanto localmente como en la VM, editar el `.env` privado. Configurar `CAR_CRUDS_BASE_URL=https://57-156-56-201.sslip.io`, `CAR_CRUDS_TIMEOUT_MS=3000` y guardar el valor del token de aplicación en `CAR_CRUDS_TOKEN`, sin el prefijo Bearer. Con Node 22, ejecutar `npm ci`, `npm run build` y `node --env-file=.env scripts/verificar-car-cruds-real.mjs "<employeeId-ficticio>"`. El verificador hace solo GET, valida ambos esquemas y omite nombres, identificadores y credenciales de su salida.
3. Aplicar la configuración en el Compose local con `docker compose up -d --build --wait socios-membresias`. En la VM, cuando se autorice aplicar la rama, usar `docker compose -f compose.yaml -f compose.prod.yaml up -d --build --wait socios-membresias` desde el checkout aprobado. Ingresar como ADMIN, abrir **Empleados Car Cruds**, seleccionar el empleado acordado, buscar el socio ficticio por DNI o email, guardar el vínculo y revisar el historial. El estado laboral es informativo.
4. Elegir el mes, preparar la fotografía y revisar el contenido persistido. Verificar `member` contra las observaciones de vigencia, `used` contra ingresos aceptados y los importes contra el contrato y los pagos confirmados del gimnasio. Los datos desconocidos son `null`; un mes parcial o un reparto que requiera redondeo no determina un costo imputable. Las reglas y acuerdos abiertos figuran en [ADR-018](adr/ADR-018-integracion-car-cruds.md).
5. Con autorización de la prueba externa, confirmar el envío y pedir que Car Cruds compruebe el informe con su cuenta autorizada. Ante un resultado incierto, reintentar la misma fotografía desde el panel. Para una prueba conjunta de repetición tras un recibo confirmado, coordinar con Car Cruds un replay controlado del mismo cuerpo, referencia, versión y emisor. La UI conserva el recibo y no vuelve a emitir una fotografía ya confirmada. Comparar los totales antes y después del replay y registrar únicamente resultados técnicos sin datos personales.
