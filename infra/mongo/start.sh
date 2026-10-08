#!/usr/bin/env bash
set -Eeuo pipefail

: "${MONGO_KEYFILE:?Falta la clave interna del replica set}"

# La clave se crea dentro del contenedor, sin depender de permisos del host.
umask 077
printf '%s' "$MONGO_KEYFILE" > /run/mongo-keyfile
chown mongodb:mongodb /run/mongo-keyfile
chmod 400 /run/mongo-keyfile

exec /usr/local/bin/docker-entrypoint.sh mongod \
  --replSet rs0 --bind_ip_all --keyFile /run/mongo-keyfile
