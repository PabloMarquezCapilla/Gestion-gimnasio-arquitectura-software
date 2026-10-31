import { randomUUID, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import pg from 'pg';
export async function postgresPrueba() {
 const id='pulse-membresias-'+randomUUID(),password=randomBytes(24).toString('hex');let created=false;const pools=[];
 const docker=(args,env={})=>{const r=spawnSync('docker',args,{encoding:'utf8',env:{...process.env,...env}});if(r.status!==0)throw new Error(r.stderr||r.error?.message||'Docker falló');return r.stdout.trim();};
 const pool=database=>{const p=new pg.Pool({host:'127.0.0.1',port,user:'postgres',password,database,connectionTimeoutMillis:2000,statement_timeout:5000,lock_timeout:3000});pools.push(p);return p;};
 let port;
 const close=async()=>{await Promise.all(pools.map(p=>p.end()));if(created){if(docker(['inspect','--format','{{index .Config.Labels "pulse.membresias.test"}}',id])!==id)throw new Error('Identidad del recurso de prueba inesperada');docker(['rm','--force',id]);}};
 try {
  docker(['run','--detach','--name',id,'--label','pulse.membresias.test='+id,'--tmpfs','/var/lib/postgresql/data','--publish','127.0.0.1::5432','--env','POSTGRES_PASSWORD','postgres:17-alpine'],{POSTGRES_PASSWORD:password});created=true;
  port=Number(docker(['port',id,'5432/tcp']).split(':').at(-1));const admin=pool('postgres');let ready=false;
  for(let n=0;n<60;n++){try{await admin.query('SELECT 1');ready=true;break;}catch{await pause(250);}}
  if(!ready)throw new Error('PostgreSQL de prueba no inició');
  for(const name of ['socios','clases','actualizacion'])await admin.query('CREATE DATABASE '+name);
  return { pool,close,id,version:(await admin.query('SHOW server_version')).rows[0].server_version };
 }catch(e){await close();throw e;}
}
