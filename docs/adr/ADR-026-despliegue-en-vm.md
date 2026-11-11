# Despliegue en la nube en una VM con Docker Compose y Caddy

**Estado:** implementada y desplegada en Azure. Portal y Grafana públicos por HTTPS; recorrido principal de FAV verificado y conexión con Car Cruds confirmada por el equipo. [URLs y procedimiento](../DEPLOY.md).
**Fecha:** 09/11/2026.
**Complementa:** [D13](ADR-013-capacidad-y-costos.md), con la medición local de capacidad, la estimación histórica de infraestructura y el cómputo Azure confirmado por el equipo. La VM elegida es Standard B2s v2, 2 vCPU y 8 GiB, con una estimación de 84,68 USD/mes de cómputo. El total requiere disco, IP y consumo adicional.
**Enunciado:** §4.1 (capacidad en un entorno accesible) y presentación grupal, páginas 8–9 (capacidad propia desplegada en la nube con URL pública).

## Decisión

Una VM Linux ejecuta el mismo Compose del desarrollo local, más `compose.prod.yaml`:
- **Caddy** en los puertos 80 y 443, con HTTPS automático de Let's Encrypt, delante del gateway NGINX y de Grafana;
- reinicio automático (`unless-stopped`) de todos los servicios.

El dominio es `gimnasio.<ip-con-guiones>.sslip.io`: DNS gratuito, sin comprar dominio y compatible con Let's Encrypt. `scripts/desplegar-vm.sh` instala Docker y Node 22, calcula el dominio, ejecuta el procedimiento único `npm run iniciar` con el override y verifica la URL pública. Guía en [DEPLOY.md](../DEPLOY.md).

## Alternativas

- **PaaS por servicio (Render o Railway):** habría que reemplazar PostgreSQL, MongoDB con replica set, RabbitMQ y Redis por servicios gestionados, y configurar cada servicio por separado. Mayor costo y riesgo a pocos días de la presentación.
- **Túnel desde una PC (Cloudflare Tunnel):** solo funciona mientras esa PC esté prendida, y no es un despliegue en la nube.

## Consecuencias

- Una sola máquina es un punto único de falla, sin alta disponibilidad entre zonas. Ya figuraba como limitación en ARCHITECTURE.
- Solo 80 y 443 quedan públicos. Prometheus y las bases se acceden por túnel SSH.
- No hay backups automáticos; DEPLOY.md documenta el procedimiento manual.
- La URL depende de la IP: si la IP cambia, cambia el dominio. Por eso se usa una IP estática.
