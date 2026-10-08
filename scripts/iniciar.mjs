import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const projectName = process.env.COMPOSE_PROJECT_NAME?.trim() || 'gimnasio-e1';
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

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 22) {
  stop(`Se necesita Node.js 22 LTS; se detectó ${process.version}. Activar Node.js 22 y volver a ejecutar node scripts/iniciar.mjs.`);
}
const dockerInfo = run(['info', '--format', '{{.ServerVersion}}|{{.OSType}}'], true);
if (dockerInfo.status !== 0) {
  stop('Docker no está disponible. Iniciar Docker Desktop con contenedores Linux y volver a ejecutar este comando.');
}
const [, dockerOs] = dockerInfo.stdout.trim().split('|');
if (dockerOs !== 'linux') {
  stop('Docker debe estar configurado para utilizar contenedores Linux. Cambiar el modo de Docker Desktop y volver a intentar.');
}
const composeVersion = run(['compose', 'version', '--short'], true);
if (composeVersion.status !== 0) {
  stop('Se necesita Docker Compose v2 o posterior, incluido en Docker Desktop.');
}
const composeMajor = Number(composeVersion.stdout.trim().replace(/^v/, '').split('.')[0]);
if (!Number.isInteger(composeMajor) || composeMajor < 2) {
  stop(`Se necesita Docker Compose v2 o posterior; se detectó ${composeVersion.stdout.trim() || 'una versión desconocida'}.`);
}

if (!existsSync(envPath)) {
  const volumes = run(['volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName}`, '--format', '{{.Name}}'], true);
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
  console.error('\nEstado de los contenedores:');
  run(['compose', 'ps', '--all']);
  console.error('\nÚltimos registros de inicialización:');
  run(['compose', 'logs', '--no-color', '--tail', '80',
    'postgres', 'postgres-init', 'mongodb', 'mongo-init', 'rabbitmq']);
  stop('El inicio no se completó. Los datos y volúmenes se conservaron; revisar los mensajes anteriores antes de volver a intentar.');
}
console.log(`Entorno listo. Abrir http://localhost:${port}`);
console.log(`Mock: http://localhost:${port}/api/v1/clases`);
console.log('La clave X-API-Key está en CAPACIDAD_API_KEY dentro de .env. Los datos son ficticios.');
