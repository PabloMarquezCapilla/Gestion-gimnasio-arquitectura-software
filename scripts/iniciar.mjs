import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const keys = [
  'POSTGRES_ADMIN_PASSWORD', 'SOCIOS_DB_PASSWORD', 'CLASES_DB_PASSWORD',
  'MONGO_ROOT_PASSWORD', 'ACCESOS_DB_PASSWORD', 'MONGO_KEYFILE',
  'RABBITMQ_PASSWORD', 'CAPACIDAD_API_KEY',
];

function run(args, capture = false) {
  return spawnSync('docker', args, {
    cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
  });
}

function stop(message) {
  console.error(message);
  process.exit(1);
}

if (Number(process.versions.node.split('.')[0]) !== 22) {
  stop('Usar Node.js 22 LTS para este entorno.');
}
if (run(['info', '--format', '{{.ServerVersion}}'], true).status !== 0) {
  stop('Docker no está disponible. Iniciar Docker Desktop con contenedores Linux y volver a ejecutar este comando.');
}
if (run(['compose', 'version'], true).status !== 0) {
  stop('Se necesita Docker Compose v2 o posterior, incluido en Docker Desktop.');
}

if (!existsSync(envPath)) {
  const volumes = run(['volume', 'ls', '--filter', 'label=com.docker.compose.project=gimnasio-e1', '--format', '{{.Name}}'], true);
  if (volumes.status !== 0) stop('No se pudieron consultar los volúmenes del proyecto.');
  if (volumes.stdout.trim()) {
    stop('Existen datos de este proyecto pero falta .env. Recuperar el .env original para conservar sus credenciales; el inicio no reemplaza ni borra datos.');
  }
  const content = [
    '# Generado para el entorno local. No subir al repositorio.',
    '# Conservar junto a los volúmenes; no cambiar claves de bases ya inicializadas.',
    'GATEWAY_PORT=8080',
    ...keys.map(key => `${key}=${randomBytes(32).toString('hex')}`),
    '',
  ].join('\n');
  writeFileSync(envPath, content, { flag: 'wx', mode: 0o600 });
  console.log('Configuración local creada en .env con claves aleatorias.');
}

process.loadEnvFile(envPath);
if (keys.some(key => !/^[A-Za-z0-9_-]+$/.test(process.env[key] ?? ''))) {
  stop('Falta una clave en .env o contiene caracteres incompatibles con las URLs de conexión. Usar claves alfanuméricas, guion o guion bajo.');
}
if (!/^[A-Za-z0-9+/]{6,1024}={0,2}$/.test(process.env.MONGO_KEYFILE ?? '')) {
  stop('MONGO_KEYFILE debe contener entre 6 y 1024 caracteres válidos de base64.');
}
const port = Number(process.env.GATEWAY_PORT ?? 8080);
if (!Number.isInteger(port) || port < 1 || port > 65535) stop('GATEWAY_PORT debe ser un puerto entre 1 y 65535.');
if (run(['compose', 'config', '--quiet']).status !== 0) stop('La configuración de Docker Compose no es válida.');

console.log('Construyendo servicios e iniciando sus dependencias...');
if (run(['compose', 'up', '--build', '--detach', '--wait', '--wait-timeout', '180']).status !== 0) {
  stop('El inicio no se completó. Revisar docker compose ps y docker compose logs para identificar el servicio que falló.');
}
console.log(`Entorno listo. Mock: http://localhost:${port}/api/v1/clases`);
console.log('La clave X-API-Key está en CAPACIDAD_API_KEY dentro de .env. Los datos son ficticios.');
