#!/usr/bin/env bash
set -Eeuo pipefail

: "${SOCIOS_DB_PASSWORD:?Falta la clave de Socios}"
: "${CLASES_DB_PASSWORD:?Falta la clave de Clases}"

# La imagen ejecuta este archivo solamente al inicializar un volumen vacío.
# Las consultas también admiten bases/usuarios existentes sin cambiar sus claves.
# Se oculta la salida SQL para evitar registrar claves ante un error de creación.
if ! PGOPTIONS='-c log_statement=none -c log_min_error_statement=panic' \
  psql --no-psqlrc --username "$POSTGRES_USER" --dbname postgres \
  --set ON_ERROR_STOP=1 > /dev/null 2>&1 <<'SQL'
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
  printf '%s\n' 'No se pudieron inicializar las bases y usuarios de los servicios.' >&2
  exit 1
fi

printf '%s\n' 'Bases y permisos de Socios y Clases inicializados.'
