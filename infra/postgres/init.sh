#!/usr/bin/env bash
set -Eeuo pipefail

: "${SOCIOS_DB_PASSWORD:?Falta la clave de Socios}"
: "${CLASES_DB_PASSWORD:?Falta la clave de Clases}"
: "${PGHOST:?Falta el host de PostgreSQL}"
: "${PGUSER:?Falta el usuario administrador de PostgreSQL}"
: "${PGDATABASE:?Falta la base administrativa de PostgreSQL}"
: "${PGPASSWORD:?Falta la clave administradora de PostgreSQL}"

# Este paso se ejecuta después del healthcheck y es idempotente: inicializa un
# volumen nuevo y también completa uno cuya inicialización anterior se interrumpió.
# La prueba separada permite informar credenciales antiguas sin imprimirlas.
if ! PGOPTIONS='-c log_statement=none -c log_min_error_statement=panic' \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --command 'SELECT 1' > /dev/null 2>&1
then
  printf '%s\n' 'PostgreSQL no acepta las credenciales administradoras de .env. Conservar y usar el .env asociado a estos volúmenes.' >&2
  exit 1
fi

# Se ocultan las consultas porque contienen las claves de los usuarios de servicio.
if ! PGOPTIONS='-c log_statement=none -c log_min_error_statement=panic' \
  psql --no-psqlrc --set ON_ERROR_STOP=1 > /dev/null 2>&1 <<'SQL'
\getenv socios_password SOCIOS_DB_PASSWORD
\getenv clases_password CLASES_DB_PASSWORD

SELECT format('CREATE ROLE socios LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'socios_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'socios')
\gexec

SELECT format('CREATE ROLE clases LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'clases_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'clases')
\gexec

SELECT 'CREATE DATABASE socios OWNER socios'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'socios')
\gexec

SELECT 'CREATE DATABASE clases OWNER clases'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'clases')
\gexec

ALTER DATABASE socios OWNER TO socios;
ALTER DATABASE clases OWNER TO clases;

REVOKE ALL PRIVILEGES ON DATABASE socios FROM PUBLIC;
REVOKE ALL PRIVILEGES ON DATABASE clases FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE socios TO socios;
GRANT CONNECT, TEMPORARY ON DATABASE clases TO clases;

\connect socios
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO socios;

\connect clases
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO clases;
SQL
then
  printf '%s\n' 'No se pudieron crear o verificar las bases, usuarios y permisos de los servicios de PostgreSQL.' >&2
  exit 1
fi

if ! PGUSER=socios PGPASSWORD="$SOCIOS_DB_PASSWORD" PGDATABASE=socios \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --command 'SELECT 1' > /dev/null 2>&1
then
  printf '%s\n' 'La clave de Socios no coincide con la almacenada; conservar y usar el .env original.' >&2
  exit 1
fi

if ! PGUSER=clases PGPASSWORD="$CLASES_DB_PASSWORD" PGDATABASE=clases \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --command 'SELECT 1' > /dev/null 2>&1
then
  printf '%s\n' 'La clave de Clases no coincide con la almacenada; conservar y usar el .env original.' >&2
  exit 1
fi

printf '%s\n' 'Bases, usuarios y permisos de Socios y Clases disponibles.'
