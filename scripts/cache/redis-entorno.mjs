import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { createClient } from 'redis';
import { detener, docker, puertoLibre } from './entorno.mjs';

export async function entornoRedis() {
  const id = 'pulse-redis-test-' + randomUUID(); const dir = await mkdtemp(join(tmpdir(), id + '-'));
  await writeFile(join(dir, 'propietario'), id);
  const mode = process.env.CACHE_TEST_MODE ?? 'docker'; const port = await puertoLibre();
  const url = 'redis://127.0.0.1:' + port; let child; let paused = false;
  const admin = createClient({ url, socket: { connectTimeout: 500, reconnectStrategy: false } }); admin.on('error', () => {});
  const start = async () => {
    if (mode === 'native') {
      child = spawn(process.env.REDIS_SERVER_BIN ?? 'redis-server', ['--bind', '127.0.0.1', '--port', String(port), '--dir', dir,
        '--save', '', '--appendonly', 'no', '--logfile', join(dir, 'redis.log')], { stdio: 'ignore' }); child.on('error', () => {});
    } else if (mode === 'docker') docker(['run', '--detach', '--name', id, '--label', 'pulse.cache.test=' + id,
      '--publish', `127.0.0.1:${port}:6379`, 'redis:8.2.11-alpine', 'redis-server', '--save', '', '--appendonly', 'no']);
    else throw new Error('Modo Redis de prueba inválido.');
    // Sonda independiente: el cliente administrativo se conserva para detener/reiniciar.
    for (let n = 0; n < 80; n++) {
      const probe = createClient({ url, socket: { connectTimeout: 100, reconnectStrategy: false } }); probe.on('error', () => {});
      try { await probe.connect(); await probe.ping(); return; } catch { await pause(100); }
      finally { if (probe.isOpen) probe.destroy(); }
    }
    throw new Error('Redis temporal no inició.');
  };
  const resume = () => {
    if (!paused) return;
    if (mode === 'native') child.kill('SIGCONT'); else docker(['unpause', id]); paused = false;
  };
  const halt = async () => {
    resume();
    if (mode === 'native') await detener(child);
    else docker(['stop', '--time', '3', id]);
  };
  const restart = async () => {
    if (admin.isOpen) admin.destroy();
    await halt();
    if (mode === 'docker') docker(['rm', id]);
    await start();
    await admin.connect();
  };
  const close = async () => {
    resume(); if (admin.isOpen) admin.destroy(); await detener(child);
    if (mode === 'docker') {
      const r = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "pulse.cache.test"}}', id], { encoding: 'utf8' });
      if (r.status === 0) { if (r.stdout.trim() !== id) throw new Error('Identidad Redis inesperada.'); docker(['rm', '--force', id]); }
    }
    if (await readFile(join(dir, 'propietario'), 'utf8') !== id) throw new Error('Directorio Redis no pertenece a esta prueba.');
    await rm(dir, { recursive: true });
  };
  try {
    await start(); await admin.connect();
    return { url, admin, dir, id, mode, halt, restart,
      pause: () => { if (mode === 'native') child.kill('SIGSTOP'); else docker(['pause', id]); paused = true; }, resume, close };
  } catch (error) { await close(); throw error; }
}
