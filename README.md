# Sistema integral de gestión de gimnasio

Trabajo Práctico Integrador — Arquitectura de Software 2026

## Integrantes

- Lorenzo Rossi
- Javier Baudino
- Pablo Marquez

## Dominio

Sistema integral de gestión de gimnasios orientado a membresías, pagos y comprobantes internos, reserva de clases, control de acceso y ocupación de sedes.

## Objetivo

Construir una plataforma que permita gestionar el ciclo completo de un socio dentro de un gimnasio: alta, renovación y vigencia de membresías, registro de pagos y comprobantes internos, búsqueda y reserva de actividades con cupos limitados, control de ingreso y consulta de ocupación de las sedes.

## Alcance preliminar

El sistema contemplará inicialmente:

- Gestión de socios y membresías por el administrador.
- Planes con distintos beneficios y vigencias. En la primera versión, una membresía habilitada permite reservar cualquier clase y sede.
- Registro de pagos por el administrador, con comprobantes internos y habilitación de las altas y renovaciones al confirmar el pago correspondiente.
- Búsqueda de clases por actividad, sede, profesor, día y horario.
- Reserva de clases con capacidad limitada.
- Lista de espera cuando una clase no tenga cupos disponibles.
- Cancelación de reservas y reasignación de cupos.
- Control de acceso al gimnasio según el estado de la membresía.
- Registro de ingresos y egresos por recepción desde la aplicación, sin dispositivos físicos y con validación de alternancia por socio y sede.
- Consulta de ocupación actual de cada sede.

## Flujo principal

1. El socio consulta su membresía y busca una clase.
2. Solicita reservar antes del inicio de la clase.
3. El sistema valida la habilitación actual de la membresía y su vigencia para la fecha de la clase, evita reservas confirmadas duplicadas y comprueba la disponibilidad respetando la prioridad de la lista de espera.
4. Si se cumplen las condiciones y existe cupo para ese socio, se confirma la reserva. Si la clase está llena, el socio puede elegir ingresar a la lista de espera.
5. Una cancelación anterior al inicio libera el cupo y activa la promoción automática por orden de inscripción, validando nuevamente la membresía de las personas en espera.

El caso de uso, las políticas confirmadas y los criterios de aceptación están documentados en [docs/ALCANCE_PRELIMINAR.md](docs/ALCANCE_PRELIMINAR.md#caso-de-uso-cu-01-reservar-una-clase).

## Reglas de negocio para la primera versión

- Membresías vigentes y habilitadas para reservar y acceder; las altas y renovaciones se habilitan al confirmar el pago correspondiente.
- Reservas sin duplicados ni exceso de capacidad, con cancelaciones antes del inicio y una lista de espera voluntaria con promoción automática por orden de inscripción.
- Pagos y comprobantes internos sin duplicación; accesos registrados por recepción con ingresos y egresos alternados por socio y sede.

Las reglas completas, las exclusiones y los criterios de aceptación se encuentran en [docs/ALCANCE_PRELIMINAR.md](docs/ALCANCE_PRELIMINAR.md).

La división preliminar en microservicios, sus responsabilidades, la propiedad de los datos y los diagramas se encuentran en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Su justificación está en [D1](docs/adr/ADR-001-limites-de-servicios.md).

La capacidad seleccionada para otro grupo es la **consulta de clases y cupos disponibles**. Su contrato inicial OpenAPI, versión `1.0.0`, y sus ejemplos están en [docs/contracts/README.md](docs/contracts/README.md); la decisión se registra en [D8](docs/adr/ADR-008-contrato-propio.md). Hay un mock local con datos ficticios. El consumidor todavía no fue asignado; la implementación real y su URL pública están pendientes.

Las propuestas iniciales de persistencia y comunicación están en [D3](docs/adr/ADR-003-persistencia.md) y [D5](docs/adr/ADR-005-comunicacion-entre-servicios.md), requeridas para la Entrega 1 en la sección 6.2, página 8 del enunciado.

## Necesidades arquitectónicas identificadas

El dominio fue ampliado para que los requisitos técnicos del trabajo surjan de necesidades reales del negocio:

- **Base de datos relacional:** membresías, planes, pagos, comprobantes internos, clases y reservas, donde se requieren relaciones, integridad y transacciones.
- **Base de datos no relacional:** historial de accesos y eventos de asistencia, orientado a alto volumen de registros.
- **Motor de búsqueda:** búsqueda de clases con paginación, filtros y ordenamiento.
- **Caché:** lecturas frecuentes como ocupación actual de las sedes y otros datos de consulta repetitiva.
- **Consistencia y concurrencia:** reserva del último cupo disponible y procesamiento idempotente de pagos.
- **Mensajería asíncrona:** cambios de membresía que permiten cancelar reservas futuras afectadas y reasignar sus cupos.

## Operación crítica preliminar

La reserva de una clase con cupos limitados será una de las operaciones críticas del sistema. Si dos usuarios intentan reservar el último cupo al mismo tiempo, el sistema deberá garantizar que solo uno obtenga la reserva y que nunca se supere la capacidad máxima.

## Estructura inicial y relación con el enunciado

| Archivos | Para qué sirven | Requisito |
|---|---|---|
| `services/` | Tres procesos HTTP independientes; Clases y Reservas incluye el mock. | Sección 6.2, página 8: estructura inicial de servicios y dependencias. |
| `package.json`, `package-lock.json`, `tsconfig*.json` | Declaran dependencias, fijan versiones y permiten compilar TypeScript. | Soporte de la estructura inicial; estos nombres y tecnologías son decisiones del grupo. |
| `compose.yaml`, `infra/`, `scripts/iniciar.mjs`, `.env.example`, `.dockerignore`, `.gitattributes` | Construyen los servicios, inician las dependencias, crean credenciales locales y permiten ejecutar en Windows y Linux. | Sección 6.2, página 8, y puesta en marcha automatizada del punto 2.12, página 4. |
| `services/clases-reservas/test/contract.test.mjs` | Comprueba respuestas, autenticación, filtros y errores del mock contra OpenAPI. | Verificación del hito «Diseño y contrato con mock», sección 6.2, páginas 7–8; no es un entregable adicional exigido. |

Se usa **Node.js 22 LTS, TypeScript y Fastify**. Es una elección para comenzar con una estructura pequeña y APIs tipadas; el enunciado no impone un lenguaje ni un framework. PostgreSQL, MongoDB y RabbitMQ siguen D3 y D5. NGINX dirige las consultas al servicio de Clases y Reservas y permite verificar los tres procesos desde un punto local. El gateway actualiza las direcciones de los servicios mediante DNS interno: Docker puede cambiar sus IP al recrearlos, según su [documentación de redes](https://docs.docker.com/compose/how-tos/networking/); se usa la [resolución dinámica de NGINX](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#server) para evitar conservar una dirección anterior.

```text
services/
  socios-membresias/     # Estructura HTTP; funciones de negocio pendientes
  clases-reservas/       # Estructura HTTP y mock del contrato
  accesos-ocupacion/     # Estructura HTTP; funciones de negocio pendientes
infra/
  node/                 # Dockerfile común para construir cada servicio
  postgres/             # Bases y usuarios separados
  mongo/                # Replica set local y usuario de Accesos
  gateway/              # Rutas de entrada
scripts/iniciar.mjs      # Inicio automatizado
```

## Ejecutar localmente

Requisitos: **Node.js 22 LTS** y **Docker Desktop iniciado con contenedores Linux y Docker Compose**. Desde la raíz del repositorio:

```sh
node scripts/iniciar.mjs
```

El comando genera `.env` con claves aleatorias solamente si no existe, construye los tres servicios e inicia PostgreSQL 17, MongoDB 8.0, RabbitMQ 4.1 y NGINX 1.28. La primera ejecución necesita Internet para descargar imágenes y paquetes. Los parches de las imágenes siguen las etiquetas de esas familias; las dependencias npm se fijan en `package-lock.json`.

El script conserva el `.env` existente. **Guardar ese archivo mientras se usen los mismos volúmenes**: las credenciales de las bases y del broker se establecen al inicializarlos. Si hay volúmenes previos y falta `.env`, el script pide recuperar el original y no reemplaza los datos. No subir `.env` al repositorio; `.env.example` contiene solo los nombres de las variables. Las claves generadas son hexadecimales, compatibles con las URLs de conexión.

El único puerto publicado es `localhost:8080`. Puede cambiarse con `GATEWAY_PORT` en `.env`.

| URL local | Resultado |
|---|---|
| `http://localhost:8080/api/v1/clases` | Listado del mock; exige `X-API-Key`. |
| `http://localhost:8080/api/v1/clases/clase-demo-001` | Detalle ficticio; exige `X-API-Key`. |
| `http://localhost:8080/health/socios` | Proceso de Socios y Membresías iniciado. |
| `http://localhost:8080/health/clases` | Proceso de Clases y Reservas iniciado, modo mock. |
| `http://localhost:8080/health/accesos` | Proceso de Accesos y Ocupación iniciado. |

Los endpoints de salud indican que los procesos responden; no afirman que el negocio esté implementado o que los servicios ya usen las bases. MongoDB tiene un replica set de un nodo para permitir transacciones posteriores, sin redundancia. Las bases y RabbitMQ se inician y quedan configurados; sus modelos, conexiones desde el código y flujos se implementarán en los siguientes hitos.

### Probar el mock en PowerShell

La clave local es `CAPACIDAD_API_KEY` de `.env`. Este ejemplo la utiliza sin mostrarla:

```powershell
$apiKey = (Select-String -LiteralPath .env -Pattern '^CAPACIDAD_API_KEY=').Line.Split('=', 2)[1]
Invoke-RestMethod -Uri 'http://localhost:8080/api/v1/clases?sedeId=sede-demo-01' -Headers @{ 'X-API-Key' = $apiKey }
```

El mock devuelve cuatro clases ficticias y responde con `X-Mock: true`. Permite probar ambos endpoints, filtros, paginación y errores; no crea reservas ni obtiene cupos de una base real. La documentación de integración está en [docs/contracts/README.md](docs/contracts/README.md).

Para verificar el contrato y compilar fuera de Docker:

```sh
npm ci --ignore-scripts
npm run build
npm test
```

Para consultar el estado, revisar logs y detener el entorno conservando los datos:

```sh
docker compose ps
docker compose logs
docker compose down
```

Volver a ejecutar `node scripts/iniciar.mjs` reinicia el entorno con la misma configuración y los mismos volúmenes.

## Estado

Dominio aprobado; alcance, D1, D8 y versiones iniciales de D3 y D5 documentados. Estructura de los tres servicios y mock local preparados — 07/10/2026. Entrega 1 pendiente de revisión y publicación de los cambios en el repositorio del grupo.

Verificación local de esta estructura: compilación de los tres servicios, nueve pruebas del contrato, diez comprobaciones HTTP a través del gateway, autenticación y permisos de las dependencias, y arranque/reinicio conservando `.env` y volúmenes. Estas comprobaciones verifican la estructura y el mock, no los flujos de negocio pendientes.

No hay todavía un despliegue público de la capacidad real ni integración con otros grupos. Su URL se documentará cuando exista. El frontend, los flujos de negocio y las demás decisiones corresponden a los siguientes hitos del enunciado.
