# Autenticación y control de tráfico en el gateway

**Estado:** aceptada e implementada; verificada con el stack completo el 09/11/2026.
**Fecha:** 09/11/2026.
**Complementa:** [ADR-016](ADR-016-autenticacion-y-altas.md), donde la autenticación quedaba en cada servicio, y [D10](ADR-010-resiliencia.md).
**Enunciado:** presentación grupal, páginas 8–9, "punto de entrada único con autenticación, direccionamiento y control de tráfico".

## Contexto

El gateway NGINX solo enrutaba. Cada servicio validaba el JWT por su cuenta, así que una solicitud sin sesión llegaba igual hasta el servicio, y no había ningún límite de tráfico: ni por cliente, ni contra fuerza bruta en el login.

## Decisión

1. **JWT validado en el gateway con njs** (`infra/gateway/auth.js`, el módulo JavaScript oficial de la imagen de NGINX).
   - Verifica firma HS256, `iss`, `aud`, `sub`, `rol` y vigencia con el mismo secreto (`AUTH_JWT_SECRET`) que los servicios.
   - Se aplica a las rutas que solo aceptan la sesión del portal (`requiere-jwt.conf`). Sin sesión válida responde `401 NO_AUTENTICADO` sin tocar el servicio.
   - Las rutas con otras credenciales no pasan por esta validación: consignaciones de FAV y empleados (`X-API-Key`), `/api/v1/clases` (clave de capacidad) y login/registro.
   - **Los servicios siguen validando sesión y rol** (defensa en profundidad). El gateway no decide permisos por rol.
2. **Rate limiting con `limit_req`:**
   - general por IP del cliente: 30 solicitudes/s, ráfaga de 60;
   - login: 10 por minuto por IP, ráfaga de 5, contra fuerza bruta de contraseñas;
   - consumidores externos: 10 solicitudes/s por `X-API-Key`, además del límite por IP.
   - Al excederse responde `429 LIMITE_EXCEDIDO` con `Retry-After`.
3. **IP real del cliente:** el gateway toma `X-Forwarded-For` solo desde redes privadas (Caddy en el despliegue, la red de Docker). Así el límite es por cliente y no por proxy.
4. **Capacidad del gateway:** `worker_connections 4096` y `keepalive 32` hacia cada servicio. El test de carga mostró que el valor por defecto (512) producía 500 al saturarse ([EVIDENCIA-CARGA](../EVIDENCIA-CARGA.md)).

## Alternativas descartadas

- **`auth_request` hacia Socios:** cada solicitud dependería de Socios. Si Socios cae, también fallarían reservas o accesos que hoy validan el JWT localmente, y se perdería una propiedad de resiliencia existente.
- **Kong o Traefik con plugins:** obligaba a reemplazar el gateway ya verificado (balanceo y logs) a días de la presentación.

## Consecuencias

- El secreto JWT también está en el gateway. Rotarlo exige reiniciar gateway y servicios a la vez, igual que antes entre servicios.
- La comparación de firmas en njs no es de tiempo constante. Es aceptable porque el atacante no puede medir diferencias tan chicas a través de la red y del rate limiting; los servicios usan comparación segura.
- Verificado:
  - sin token y con firma alterada, 401 en el gateway;
  - token de socio en ruta ADMIN, 403 del servicio;
  - API keys de FAV y Clases, 200;
  - el sexto login fallido seguido, 429;
  - `npm run test:balanceo` sigue aprobado.
