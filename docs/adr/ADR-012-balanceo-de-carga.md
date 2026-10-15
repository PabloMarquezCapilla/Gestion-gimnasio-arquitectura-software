# D12 - Balanceo de carga

**Estado:** decidida para la Entrega 2.  
**Fecha:** 12/10/2026.

## Contexto

El sistema expone múltiples servicios de backend que deben escalar horizontalmente para atender la concurrencia de socios, recepcionistas y consumidores externos. Se requiere un punto de entrada centralizado que distribuya el tráfico eficientemente, supervise la disponibilidad de las instancias de backend y asegure alta disponibilidad sin interrupción del servicio ante la falla o recreación de un contenedor.

## Decisión

Se adopta **NGINX 1.28** configurado como **API Gateway y Balanceador de Carga de Capa 7 (HTTP/Reverse Proxy)**, utilizando el algoritmo **Least Connections (`least_conn`)** y verificación activa y pasiva de disponibilidad.

### 1. Servicio seleccionado y justificación

- **Tecnología:** NGINX 1.28 Alpine.
- **Motivos de selección:**
  - Extremadamente ligero y con un consumo de recursos mínimo (< 20 MB RAM en el contenedor).
  - Arquitectura orientada a eventos basada en sockets no bloqueantes (`epoll`), capaz de sostener decenas de miles de conexiones concurrentes con mínima latencia.
  - Soporte nativo para resolución dinámica de nombres DNS en Docker (`resolver 127.0.0.11 valid=5s`), vital para entornos donde Docker puede recrear contenedores con nuevas direcciones IP sin reiniciar el balanceador.
  - Capacidad de enrutar selectivamente por prefijo de ruta (`/api/v1/clases`, `/api/v1/reservas`, `/api/v1/socios`, `/health`).

### 2. Estrategia de distribución de carga

Para los grupos de upstream de los microservicios:

```nginx
upstream clases_backend {
    zone clases_backend 64k;
    least_conn;
    server clases-reservas:3000 max_fails=3 fail_timeout=10s resolve;
}

upstream socios_backend {
    zone socios_backend 64k;
    least_conn;
    server socios-membresias:3000 max_fails=3 fail_timeout=10s resolve;
}
```

- **Algoritmo seleccionado: Least Connections (`least_conn`):**
  - *Funcionamiento:* Dirige cada nueva solicitud HTTP a la instancia que mantiene la menor cantidad de conexiones activas en ese instante.
  - *Justificación frente a Round Robin:* Una consulta paginada de búsqueda o una transacción de reserva con validación remota toma más tiempo que una comprobación simple de salud. Round Robin distribuye ciegamente en turnos fijos, lo que puede sobrecargar una instancia que esté procesando transacciones pesadas. `least_conn` equilibra la carga según el trabajo real en curso.

### 3. Verificación de disponibilidad (Health Checks)

Se implementa una estrategia dual:

1. **Monitoreo Pasivo continuo:**
   - Parámetros `max_fails=3 fail_timeout=10s` en cada backend.
   - Si una instancia falla 3 peticiones consecutivas (por error de conexión, timeout o respuestas 5xx del sistema operativo), NGINX la marca automáticamente como no disponible y la excluye de la rotación durante 10 segundos.
2. **Monitoreo Activo:**
   - Endpoints dedicados de salud expuestos por cada microservicio (`/health` en cada proceso y mapeados a `/health/clases`, `/health/socios`, `/health/accesos` en el Gateway).
   - Docker Compose y los orquestadores externos sondean estos endpoints cada 5 segundos para verificar no solo que el puerto responda, sino que el estado interno y la conexión a PostgreSQL estén operativos.

### 4. Comportamiento ante la caída de una instancia (Failover transparente)

Para evitar que los usuarios o consumidores externos experimenten errores cuando una réplica cae o se reinicia:

```nginx
proxy_next_upstream error timeout invalid_header http_502 http_503 http_504;
proxy_next_upstream_tries 3;
proxy_next_upstream_timeout 5s;
```

- **Reintento transparente en otra réplica:** Si la solicitud enviada a una instancia falla por error de conexión (`error`), expiración de tiempo (`timeout`) o respuesta del servidor `502/503`, NGINX reenvía automáticamente e inmediatamente la solicitud a otra instancia sana disponible en el pool upstream antes de responder al cliente.
- **Impacto para el usuario:** Cero errores 502 visibles ante reinicios controlados de instancias de backend.

## Consecuencias

- **Escalabilidad Horizontal Transparente:** Es posible ejecutar `docker compose up --scale clases-reservas=3` y NGINX distribuirá el tráfico entre las tres réplicas inmediatamente sin requerir cambios de configuración.
- **Punto único de falla mitigado:** En entornos de producción en la nube (AWS/GCP), NGINX se despliega detrás de un balanceador de carga gestionado (AWS ALB o Google Cloud Load Balancing) distribuido en múltiples zonas de disponibilidad (Multi-AZ).
