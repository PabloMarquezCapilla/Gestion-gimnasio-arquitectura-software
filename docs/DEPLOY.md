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
2. calcula `DOMINIO=gimnasio.<ip>.sslip.io` y lo guarda en `.env`;
3. ejecuta `npm run iniciar` con `COMPOSE_FILE=compose.yaml:compose.prod.yaml`, que genera los secretos que falten en `.env` y levanta todo con reinicio automático;
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

| Para quién | URL |
|---|---|
| Socios y la cátedra | `https://<dominio>` (portal) |
| FAV, capacidad publicada (contrato [openapi-fav-v1.yaml](contracts/openapi-fav-v1.yaml)) | `https://<dominio>/api/v1/consignaciones/stock?proveedorId=fav` y `POST https://<dominio>/api/v1/consignaciones/reposiciones` |
| Tablero de la presentación | `https://grafana.<dominio>` |
| Alertas (Prometheus) | Túnel SSH: `ssh -L 9090:localhost:9090 usuario@<ip>`, luego `http://localhost:9090/alerts` |

Al tener la URL definitiva, reemplazarla en el campo `servers` de los contratos de `docs/contracts/` y en el README.

## 5. Operación

```bash
docker compose -f compose.yaml -f compose.prod.yaml ps
```

```bash
docker compose -f compose.yaml -f compose.prod.yaml logs --since 10m gateway tienda
```

**Backups:** `docker compose exec -T postgres pg_dumpall -U postgres > backup.sql`, y para MongoDB, `mongodump` desde su contenedor. No hay backups automáticos; es una limitación aceptada para la evaluación.

**Verificado localmente (09/11/2026):** el override de producción valida con `docker compose config`. Caddy sirvió por HTTPS el portal, `/health`, Grafana y la API de consignaciones con la clave de FAV, usando un dominio `.localhost`, que Caddy firma con su CA interna. En la VM, el certificado lo emite Let's Encrypt.
