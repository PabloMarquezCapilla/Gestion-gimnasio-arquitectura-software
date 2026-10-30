# Autenticación y altas administradas

**Extensión 30/10/2026:** [ADR-021](ADR-021-planes-pagos-membresias.md) implementa pagos manuales sólo ADMIN y habilitación transaccional. La exclusión de pagos siguiente describe el alcance histórico; la ruta antigua de activación directa permanece rechazada. No cambian JWT, altas ni propiedad de datos.

**Estado:** aceptada e implementada, 19/10/2026.

## Origen y contexto

Decisión adicional para sostener los roles y la propiedad de datos del alcance, confirmada por el equipo. No es un entregable nuevo exigido literalmente: se registra conforme a la sección 5, páginas 6–7; documentación actualizada en sección 3, página 4, y ausencia de secretos en el repositorio en sección 2.12, página 4.

El registro público permitía crear usuarios y habilitar membresías sin confirmar pagos. La interfaz podía simular una sesión o una operación exitosa ante errores del servidor.

## Decisión

- Socios emite JWT firmados con HS256, emisor `gimnasio`, audiencia `gimnasio-web`, identidad `sub`, rol `rol` y vencimiento. Socios, Clases y Tienda verifican firma, campos y vigencia. Duración configurable con `AUTH_JWT_TTL_SECONDS`, por defecto 3600 segundos; secreto `AUTH_JWT_SECRET` de al menos 32 caracteres.
- Socios comprueba además que la cuenta persista activa y toma su rol actual del almacenamiento. Clases valida el token y exige identidad propia o ADMIN en las operaciones personales; su consulta administrativa de reservas exige ADMIN.
- El alta HTTP requiere ADMIN y siempre crea SOCIO. Rechaza campos adicionales como rol, hash o plan; devuelve socio sin contraseña ni token y `membresia: null`. La cuenta administrativa que ejecuta el alta conserva su sesión.
- El primer administrador se crea mediante `npm run crear-admin`, con datos solicitados localmente y contraseña oculta. No hay registro HTTP de administradores ni administrador predeterminado nuevo. Un DNI/email existente se rechaza sin sobrescribir cuentas; las cuentas que ya estaban persistidas se conservan.
- La validación técnica de membresías utiliza `X-Service-Key`, con `SERVICIOS_API_KEY`. Esa clave solo autoriza la consulta de habilitación; no crea usuarios ni sesiones y es distinta de `X-API-Key` del contrato externo. El gateway elimina `X-Service-Key` entrante para impedir su uso desde el portal.
- El navegador mantiene el JWT en memoria; al recargar se inicia sesión nuevamente. Una respuesta 401 invalida esa sesión. No se recuperan identidades de demostración desde localStorage.
- Pagos y reactivación siguen pendientes por decisión del equipo. El backend rechaza el alta/renovación de membresías con 501 `PAGOS_NO_IMPLEMENTADOS`; no acepta una bandera del cliente como prueba de pago. La interfaz identifica las acciones sin backend, sin comprobantes ni movimientos simulados.

## Alternativas y consecuencias

Se descartaron tokens sin firma, confiar en un rol guardado en el navegador y una contraseña administrativa automática. JWT permite validar identidad en ambos servicios sin consultar Socios por cada ruta de Clases. La contrapartida es que un token aceptado por Clases o Tienda sigue siendo válido hasta su vencimiento; no se implementan revocación inmediata, refresh tokens ni una administración de credenciales de empleados externos en la implementación actual.

`scripts/iniciar.mjs` genera únicamente las claves nuevas ausentes y conserva las credenciales existentes de las bases y el broker. Las pruebas emplean datos ficticios y no cargan el `.env` del grupo.

## Evidencia

`test/auth.test.mjs` comprueba sesiones, permisos, altas, bootstrap y membresías; `frontend/src/services/api.test.mjs` comprueba que los errores no producen resultados ficticios. La integración PostgreSQL/HTTP se reproduce con `npm run test:postgres`; la reproducción se documenta en README.
