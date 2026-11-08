import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';

// Recursos exclusivos de la prueba: no lee .env ni reutiliza los volúmenes del grupo.
export async function postgresTiendaPrueba() {
  const id = 'pulse-tienda-' + randomUUID();
  const label = 'pulse.tienda.test';
  const password = randomBytes(24).toString('hex');
  const pools = [];
  let created = false;
  let port;

  function docker(args, extraEnv = {}) {
    const result = spawnSync('docker', args, {
      encoding: 'utf8', windowsHide: true, timeout: 60000,
      env: { ...process.env, ...extraEnv },
    });
    if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'Falló Docker de prueba.');
    return result.stdout.trim();
  }

  function pool(database = 'tienda') {
    const result = new pg.Pool({
      host: '127.0.0.1', port, user: 'postgres', password, database,
      max: 12, connectionTimeoutMillis: 2000, statement_timeout: 5000,
      lock_timeout: 3000, query_timeout: 7000,
    });
    // La última prueba detiene deliberadamente este PostgreSQL.
    result.on('error', () => {});
    pools.push(result);
    return result;
  }

  function assertOwned() {
    if (!created || docker(['inspect', '--format', '{{index .Config.Labels "' + label + '"}}', id]) !== id) {
      throw new Error('El recurso no pertenece a esta prueba de Tienda.');
    }
  }

  async function close() {
    await Promise.all(pools.map(value => value.end()));
    if (created) {
      assertOwned();
      docker(['rm', '--force', id]);
      created = false;
    }
  }

  try {
    docker([
      'run', '--detach', '--name', id, '--label', label + '=' + id,
      '--tmpfs', '/var/lib/postgresql/data', '--publish', '127.0.0.1::5432',
      '--env', 'POSTGRES_PASSWORD', 'postgres:17-alpine',
    ], { POSTGRES_PASSWORD: password });
    created = true;
    port = Number(docker(['port', id, '5432/tcp']).split(':').at(-1));
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Puerto temporal inválido.');
    const admin = pool('postgres');
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try { await admin.query('SELECT 1'); ready = true; break; }
      catch { await pause(250); }
    }
    if (!ready) throw new Error('PostgreSQL temporal de Tienda no inició.');
    await admin.query('CREATE DATABASE tienda');
    return {
      id, pool, close,
      version: (await admin.query('SHOW server_version')).rows[0].server_version,
      stop() { assertOwned(); docker(['stop', '--time', '1', id]); },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
