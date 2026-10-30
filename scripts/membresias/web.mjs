import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn,spawnSync } from 'node:child_process';
import { puertoLibre,detener } from '../cache/entorno.mjs';
import { setTimeout as pause } from 'node:timers/promises';
export async function verificarMembresiasWeb({sociosUrl,clasesUrl,adminEmail,adminPassword,claseId}) {
 const dir=await mkdtemp(join(tmpdir(),'pulse-membresias-web-')),marker=randomUUID();await writeFile(join(dir,'propietario'),marker);await mkdir(join(dir,'logs'));
 let nginx,browser;
 try{
  const {chromium}=await import(pathToFileURL(process.env.MEMBRESIAS_PLAYWRIGHT_MODULE).href),port=await puertoLibre();
  let conf=await readFile(resolve('infra/gateway/nginx.conf'),'utf8');
  conf=conf.replace('include /etc/nginx/mime.types;','include '+JSON.stringify(resolve(process.env.NGINX_MIME_TYPES))+';').replace('listen 80;','listen '+port+';')
   .replace('root /usr/share/nginx/html;','root '+JSON.stringify(resolve('frontend/dist'))+';').replace(/resolver 127\.0\.0\.11[^;]+;/,'').replace(/resolver_timeout 2s;/,'')
   .replace(/socios-membresias:3000/g,new URL(sociosUrl).host).replace(/clases-reservas:3000/g,new URL(clasesUrl).host).replace(/accesos-ocupacion:3000|tienda:3000/g,'127.0.0.1:9').replace(/ resolve;/g,';');
  if(process.platform==='darwin')conf=conf.replace(/(zone \w+ )64k;/g,(_m,p)=>p+'256k;');
  await writeFile(join(dir,'nginx.conf'),conf);const args=['-p',dir+'/','-c',join(dir,'nginx.conf')];
  const check=spawnSync(process.env.NGINX_BIN,[...args,'-t'],{encoding:'utf8'});assert.equal(check.status,0,check.stderr);
  nginx=spawn(process.env.NGINX_BIN,[...args,'-g','daemon off;'],{stdio:'ignore'});const base='http://127.0.0.1:'+port;
  for(let n=0;n<60;n++){try{if((await fetch(base+'/health')).ok)break;}catch{}await pause(100);}
  browser=await chromium.launch({headless:true,executablePath:process.env.MEMBRESIAS_CHROME_BIN});const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(12000);
  const login=async(email,password)=>{await page.goto(base);await page.getByRole('button',{name:/Iniciar Sesión/}).first().click();await page.getByPlaceholder('Email o DNI registrado').fill(email);await page.locator('input[type=password]').fill(password);await page.getByRole('button',{name:'Ingresar al Club'}).click();};
  await login(adminEmail,adminPassword);await page.getByRole('heading',{name:'Planes, pagos y membresías'}).waitFor();
  await page.getByRole('button',{name:'Alta de Socio',exact:true}).click();
  const email='web-'+randomUUID()+'@example.invalid',nombre='Persona navegador';
  await page.getByPlaceholder('Martín Rossi').fill(nombre);await page.getByPlaceholder('39.812.900').fill('990'+String(Date.now()).slice(-9));await page.getByPlaceholder('martin@correo.com').fill(email);await page.locator('input[type=password]').fill('clave-navegador');
  const altaResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/auth/registro')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Crear Socio sin Membresía'}).click();const alta=await (await altaResponse).json();assert.equal(alta.membresia,null);
  await page.getByRole('button',{name:'Actualizar gestión'}).click();
  const planNombre='Plan navegador '+randomUUID().slice(0,8);
  await page.getByLabel('Nombre del plan',{exact:true}).fill(planNombre);await page.getByLabel('Importe en unidad mínima',{exact:true}).fill('23456');await page.getByLabel('Moneda',{exact:true}).fill('ARS');
  const planResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/planes')&&r.request().method()==='POST');await page.getByRole('button',{name:'Crear plan',exact:true}).click();const plan=await(await planResponse).json();
  await page.getByLabel('Socio de la solicitud').selectOption(alta.socio.socioId);await page.getByLabel('Plan de la solicitud').selectOption(plan.planId);
  const local=value=>{const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  await page.getByLabel('Inicio de vigencia',{exact:true}).fill(local(Date.now()-86400000));await page.getByLabel('Fin de vigencia',{exact:true}).fill(local(Date.now()+10*86400000));
  const solicitudResponse=page.waitForResponse(r=>r.url().endsWith('/solicitudes')&&r.request().method()==='POST');await page.getByRole('button',{name:'Crear solicitud',exact:true}).click();const sol=await(await solicitudResponse).json();assert.equal(sol.estado,'PENDIENTE');
  const section=page.locator('div').filter({has:page.getByRole('heading',{name:'Operar solicitud '+sol.solicitudId,exact:true})}).last();
  await page.getByLabel('Referencia '+sol.solicitudId,{exact:true}).fill('web-'+randomUUID());
  const pagoResponse=page.waitForResponse(r=>r.url().endsWith('/'+sol.solicitudId+'/pagos')&&r.request().method()==='POST');
  await section.getByRole('button',{name:'Registrar pago pendiente',exact:true}).click();const registrado=await(await pagoResponse).json();assert.equal(registrado.pago.estado,'PENDIENTE');assert.equal(registrado.comprobante,null);
  // Pérdida real de respuesta después de que backend confirma. La UI conserva clave/cuerpo tras recarga.
  let lost=false;await page.route('**/api/v1/pagos/'+registrado.pago.pagoId+'/confirmar',async route=>{if(!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await section.getByRole('checkbox').check();await section.getByRole('button',{name:'Confirmar pago verificado'}).click();
  await page.getByRole('button',{name:'Reintentar la misma operación de membresía'}).waitFor();await page.reload();
  await page.getByRole('button',{name:/Iniciar Sesión/}).first().click();await page.getByPlaceholder('Email o DNI registrado').fill(adminEmail);await page.locator('input[type=password]').fill(adminPassword);await page.getByRole('button',{name:'Ingresar al Club'}).click();
  await page.getByRole('button',{name:'Reintentar la misma operación de membresía'}).click();await page.getByText(/Comprobante interno comp-/).first().waitFor();
  await page.getByTitle('Cerrar sesión',{exact:true}).click();await login(email,'clave-navegador');
  await page.getByRole('button',{name:'Membresía y Pagos',exact:false}).click();await page.getByText(/Comprobante interno comp-/).waitFor();
  await page.getByRole('button',{name:'Clases y Reservas',exact:false}).click();
  const card=page.locator('div').filter({has:page.getByRole('heading',{name:claseId,exact:true})}).filter({has:page.getByRole('button',{name:'Reservar Lugar'})}).last();
  const reservaResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/reservas')&&r.request().method()==='POST');await card.getByRole('button',{name:'Reservar Lugar'}).click();assert.equal((await reservaResponse).status(),201);
  assert.deepEqual(errors,[]);if(process.env.MEMBRESIAS_SCREENSHOT)await page.screenshot({path:process.env.MEMBRESIAS_SCREENSHOT,fullPage:true});
  console.log('Chrome + NGINX + PostgreSQL: alta web sin membresía, configuración de plan, solicitud, registro pendiente, confirmación con respuesta perdida, recarga/replay, comprobante del socio y reserva real verificados.');
 }finally{await browser?.close();await detener(nginx);if(await readFile(join(dir,'propietario'),'utf8')!==marker)throw new Error('Fixture web inesperado');await rm(dir,{recursive:true});}
}
