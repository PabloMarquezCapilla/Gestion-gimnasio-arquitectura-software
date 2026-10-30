// Recursos exclusivos para mediciones/pruebas. Nunca lee .env ni admite una URL de datos existentes.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { MongoClient } from 'mongodb';

export async function puertoLibre() {
  const s = createServer(); await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
export async function detener(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try { await ended; } finally { clearTimeout(timer); }
}
export function docker(args) {
  const r = spawnSync('docker', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Falló Docker temporal: ' + (r.error?.message ?? r.stderr));
  return r.stdout.trim();
}
export async function entornoMongo() {
  const id = 'pulse-cache-test-' + randomUUID();
  const dir = await mkdtemp(join(tmpdir(), id + '-')); await writeFile(join(dir, 'propietario'), id);
  const dbpath = join(dir, 'mongo'); await mkdir(dbpath);
  const port = await puertoLibre(); const mode = process.env.CACHE_TEST_MODE ?? 'docker';
  const uri = `mongodb://127.0.0.1:${port}/cache_prueba?directConnection=true&replicaSet=rs0`;
  let child;
  const client = new MongoClient(uri, { monitorCommands: true, serverSelectionTimeoutMS: 500, timeoutMS: 10000 });
  const close = async () => {
    await client.close(); await detener(child);
    if (mode === 'docker') {
      const r = spawnSync('docker', ['inspect', '--format', '{{index .Config.Labels "pulse.cache.test"}}', id], { encoding: 'utf8' });
      if (r.status === 0) { if (r.stdout.trim() !== id) throw new Error('Identidad Docker inesperada.'); docker(['rm', '--force', id]); }
    }
    if (await readFile(join(dir, 'propietario'), 'utf8') !== id) throw new Error('Identidad temporal inesperada.');
    await rm(dir, { recursive: true });
  };
  try {
    if (mode === 'native') {
      child = spawn(process.env.MONGOD_BIN ?? 'mongod', ['--dbpath', dbpath, '--port', String(port), '--bind_ip', '127.0.0.1', '--replSet', 'rs0', '--logpath', join(dir, 'mongo.log')], { stdio: 'ignore' });
      child.on('error', () => {});
    } else if (mode === 'docker') docker(['run', '--detach', '--name', id, '--label', 'pulse.cache.test=' + id,
      '--tmpfs', '/data/db', '--publish', `127.0.0.1:${port}:27017`, 'mongo:8.0', '--replSet', 'rs0', '--bind_ip_all']);
    else throw new Error('CACHE_TEST_MODE debe ser native o docker.');
    let connected = false;
    for (let n = 0; n < 80; n++) { try { await client.connect(); connected = true; break; } catch { await pause(100); } }
    if (!connected) throw new Error('MongoDB temporal no inició.');
    await client.db('admin').command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:' + (mode === 'native' ? port : 27017) }] } });
    let primary = false;
    for (let n = 0; n < 100; n++) { if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) { primary = true; break; } await pause(100); }
    if (!primary) throw new Error('MongoDB temporal no eligió primario.');
    return { client, uri, dir, id, mode, close };
  } catch (error) { await close(); throw error; }
}
