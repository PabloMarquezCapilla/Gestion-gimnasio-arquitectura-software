#!/usr/bin/env bash
# Despliegue del sistema completo en una VM Ubuntu 22.04/24.04 con IP pública.
# Ejecutar EN LA VM, desde la raíz del repositorio clonado:
#   bash scripts/desplegar-vm.sh
# Es idempotente: volver a ejecutarlo actualiza el código y reinicia lo que cambió,
# conservando .env, volúmenes y datos.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/5 Dependencias del sistema (Docker y Node.js 22)"
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
fi
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != "22" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
# El grupo docker recién agregado no aplica a esta sesión: usar sudo si hace falta.
DOCKER="docker"; docker info >/dev/null 2>&1 || DOCKER="sudo docker"

echo "== 2/5 Código actualizado"
git pull --ff-only || echo "(sin cambios remotos o repositorio sin upstream)"

echo "== 3/5 Dominio público"
IP="$(curl -fsS https://api.ipify.org)"
if [ ! -f .env ] || ! grep -q '^DOMINIO=.\+' .env; then
  # sslip.io resuelve <ip-con-guiones>.sslip.io a esa IP: DNS gratis, válido para Let's Encrypt.
  DOMINIO="gimnasio.${IP//./-}.sslip.io"
  touch .env
  sed -i '/^DOMINIO=/d' .env
  echo "DOMINIO=${DOMINIO}" >> .env
fi
DOMINIO="$(grep '^DOMINIO=' .env | cut -d= -f2-)"
echo "Dominio: ${DOMINIO} (IP ${IP})"

echo "== 4/5 Secretos, construcción e inicio (npm run iniciar con el override de producción)"
# iniciar genera las claves que falten en .env y levanta todo con --wait.
if [ "$DOCKER" = "docker" ]; then
  COMPOSE_FILE=compose.yaml:compose.prod.yaml node scripts/iniciar.mjs
else
  sudo env COMPOSE_FILE=compose.yaml:compose.prod.yaml PATH="$PATH" node scripts/iniciar.mjs
fi

echo "== 5/5 Verificación pública"
for _ in $(seq 1 30); do
  if curl -fsS "https://${DOMINIO}/health" >/dev/null 2>&1; then break; fi
  sleep 5
done
curl -fsS "https://${DOMINIO}/health" && echo
cat <<EOF

Despliegue listo:
  Portal y API:   https://${DOMINIO}
  Tablero:        https://grafana.${DOMINIO}
  Para FAV:       https://${DOMINIO}/api/v1/consignaciones/stock?proveedorId=fav  (X-API-Key = FAV_API_KEY de .env)
  Prometheus:     ssh -L 9090:localhost:9090 <usuario>@${IP}  y abrir http://localhost:9090/alerts

Compartir FAV_API_KEY con FAV solo por canal privado. Crear el administrador con: npm run crear-admin
EOF
