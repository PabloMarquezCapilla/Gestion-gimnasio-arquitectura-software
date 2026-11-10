// Lanzador explícito de carga k6 contra el gateway del compose en marcha (npm run iniciar).
// El resumen queda en docs/evidence/carga-k6/resumen.json para el análisis de D13.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const proyecto = process.env.COMPOSE_PROJECT_NAME?.trim() || 'gimnasio-e2';
const resultado = spawnSync('docker', [
  'run', '--rm', '--network', `${proyecto}_default`,
  '-v', `${resolve(root, 'tests/carga')}:/scripts:ro`,
  '-v', `${resolve(root, 'docs/evidence/carga-k6')}:/resultados`,
  '-e', 'BASE_URL=http://gateway',
  // npm run test:carga -- estres  → perfil de saturación.
  '-e', `PERFIL=${process.argv[2] === 'estres' ? 'estres' : 'normal'}`,
  // npm run test:carga -- tasa 300  → tasa fija de 300 recorridos/s.
  '-e', `TASA=${process.argv[2] === 'tasa' ? process.argv[3] ?? '' : ''}`,
  'grafana/k6:0.55.0', 'run', '/scripts/flujo-principal.k6.js',
], { stdio: 'inherit', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
if (resultado.error) {
  console.error('No se pudo ejecutar Docker. Iniciar el sistema con npm run iniciar antes del test de carga.');
}
process.exit(resultado.status ?? 1);
