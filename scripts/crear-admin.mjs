import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const result = spawnSync('docker', [
  'compose', 'exec', 'socios-membresias',
  'node', 'services/socios-membresias/dist/crear-admin.js',
], { cwd: root, stdio: 'inherit', windowsHide: true });

if (result.error) {
  console.error('No se pudo abrir el alta local de administrador. Iniciar Docker y el entorno del proyecto.');
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
