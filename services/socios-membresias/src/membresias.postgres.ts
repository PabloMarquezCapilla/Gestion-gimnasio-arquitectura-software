import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { ComandoGestion, GestionRepository, PlanGestion, SolicitudGestion, falloGestion } from './membresias.gestion';

// Migración aditiva: no altera solicitudes_membresia del contrato externo histórico.
export const GESTION_MEMBRESIAS_DDL = `
CREATE TABLE IF NOT EXISTS planes_membresia (
 plan_id VARCHAR(50) PRIMARY KEY, nombre VARCHAR(50) NOT NULL,
 importe_minor BIGINT NOT NULL CHECK(importe_minor BETWEEN 0 AND 9007199254740991), moneda VARCHAR(3) NOT NULL CHECK(moneda ~ '^[A-Z]{3}$'),
 estado TEXT NOT NULL CHECK(estado IN ('ACTIVO','INACTIVO')), creado_por VARCHAR(50) NOT NULL REFERENCES socios(socio_id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS solicitudes_planes (
 solicitud_id VARCHAR(50) PRIMARY KEY, socio_id VARCHAR(50) NOT NULL REFERENCES socios(socio_id), plan_id VARCHAR(50) NOT NULL REFERENCES planes_membresia(plan_id),
 nombre_plan VARCHAR(50) NOT NULL, importe_minor BIGINT NOT NULL CHECK(importe_minor BETWEEN 0 AND 9007199254740991), moneda VARCHAR(3) NOT NULL CHECK(moneda ~ '^[A-Z]{3}$'),
 fecha_inicio TIMESTAMPTZ NOT NULL, fecha_fin TIMESTAMPTZ NOT NULL CHECK(fecha_fin >= fecha_inicio),
 estado TEXT NOT NULL CHECK(estado IN ('PENDIENTE','CONFIRMADA','RECHAZADA')), creado_por VARCHAR(50) NOT NULL REFERENCES socios(socio_id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitud_plan_pendiente ON solicitudes_planes(socio_id) WHERE estado='PENDIENTE';
CREATE INDEX IF NOT EXISTS idx_solicitudes_planes_socio ON solicitudes_planes(socio_id,created_at,solicitud_id);
CREATE TABLE IF NOT EXISTS pagos_membresia (
 pago_id VARCHAR(50) PRIMARY KEY, solicitud_id VARCHAR(50) NOT NULL UNIQUE REFERENCES solicitudes_planes(solicitud_id), referencia VARCHAR(100) NOT NULL UNIQUE,
 estado TEXT NOT NULL CHECK(estado IN ('PENDIENTE','CONFIRMADO','RECHAZADO')), registrado_por VARCHAR(50) NOT NULL REFERENCES socios(socio_id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comprobantes_membresia (
 comprobante_id VARCHAR(50) PRIMARY KEY, pago_id VARCHAR(50) NOT NULL UNIQUE REFERENCES pagos_membresia(pago_id),
 membresia_id VARCHAR(50) NOT NULL UNIQUE REFERENCES membresias(membresia_id), confirmado_por VARCHAR(50) NOT NULL REFERENCES socios(socio_id), confirmado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operaciones_membresia (
 actor_id VARCHAR(50) NOT NULL REFERENCES socios(socio_id), clave VARCHAR(128) NOT NULL, contenido TEXT NOT NULL, respuesta JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,clave)
);
`;
const planSelect = `SELECT plan_id AS "planId",nombre,importe_minor::text AS "importeMinor",moneda,estado FROM planes_membresia`;
const solicitudSelect = `SELECT s.solicitud_id AS "solicitudId",s.socio_id AS "socioId",s.plan_id AS "planId",s.nombre_plan AS "nombrePlan",
 s.importe_minor::text AS "importeMinor",s.moneda,s.fecha_inicio AS "fechaInicio",s.fecha_fin AS "fechaFin",s.estado,s.created_at AS "createdAt",
 CASE WHEN p.pago_id IS NOT NULL THEN jsonb_build_object('pagoId',p.pago_id,'referencia',p.referencia,'estado',p.estado) END AS pago,
 CASE WHEN c.comprobante_id IS NOT NULL THEN jsonb_build_object('comprobanteId',c.comprobante_id,'pagoId',c.pago_id,'membresiaId',c.membresia_id,'confirmadoPor',c.confirmado_por,'confirmadoEn',c.confirmado_en) END AS comprobante
 FROM solicitudes_planes s LEFT JOIN pagos_membresia p USING(solicitud_id) LEFT JOIN comprobantes_membresia c USING(pago_id)`;
function solicitudFila(r: Record<string, unknown>): SolicitudGestion {
 return { ...r, importeMinor: Number(r.importeMinor), fechaInicio: new Date(r.fechaInicio as string).toISOString(), fechaFin: new Date(r.fechaFin as string).toISOString(), createdAt: new Date(r.createdAt as string).toISOString() } as unknown as SolicitudGestion;
}
const nuevo = (prefix: string) => prefix + randomUUID();
export class PostgresGestionMembresias implements GestionRepository {
 constructor(private pool: Pool) {}
 async planes() { return (await this.pool.query(planSelect + ' ORDER BY nombre,plan_id')).rows.map(r => ({ ...r, importeMinor: Number(r.importeMinor) })) as PlanGestion[]; }
 async socios(pagina: number, tamanio: number) { return (await this.pool.query('SELECT socio_id AS "socioId",dni,nombre,email,estado FROM socios ORDER BY socio_id LIMIT $1 OFFSET $2', [tamanio, (pagina - 1) * tamanio])).rows; }
 async solicitudes(socioId: string | undefined, pagina: number, tamanio: number) {
  return (await this.pool.query(solicitudSelect + ' WHERE ($1::text IS NULL OR s.socio_id=$1) ORDER BY s.created_at DESC,s.solicitud_id LIMIT $2 OFFSET $3', [socioId ?? null,tamanio,(pagina-1)*tamanio])).rows.map(solicitudFila);
 }
 async solicitud(id: string, client?: PoolClient): Promise<SolicitudGestion> {
  const r = await (client ?? this.pool).query(solicitudSelect + ' WHERE s.solicitud_id=$1', [id]);
  if (!r.rows[0]) throw falloGestion('SOLICITUD_NO_ENCONTRADA','No se encontró la solicitud.',404);
  return solicitudFila(r.rows[0]);
 }
 async ejecutar(actor: string, clave: string, comando: ComandoGestion, datos: Record<string, unknown>, alRepetir?: () => void): Promise<unknown> {
  const client = await this.pool.connect(); const contenido = JSON.stringify({ comando, datos });
  try {
   await client.query('BEGIN');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[JSON.stringify(['gestion-membresias',actor,clave])]);
   const administrador = await client.query("SELECT 1 FROM socios WHERE socio_id=$1 AND rol='ADMIN' AND estado='ACTIVO'",[actor]);
   if (!administrador.rowCount) throw falloGestion('ACCESO_DENEGADO','Se requiere un administrador activo.',403);
   const prev = (await client.query('SELECT contenido,respuesta FROM operaciones_membresia WHERE actor_id=$1 AND clave=$2',[actor,clave])).rows[0];
   if (prev) {
    if (prev.contenido !== contenido) throw falloGestion('IDEMPOTENCIA_EN_CONFLICTO','La clave ya fue usada con otro contenido u operación.');
    await client.query('COMMIT'); alRepetir?.(); return prev.respuesta;
   }
   const result = await this.aplicar(client,actor,comando,datos);
   await client.query('INSERT INTO operaciones_membresia(actor_id,clave,contenido,respuesta) VALUES($1,$2,$3,$4)',[actor,clave,contenido,JSON.stringify(result)]);
   await client.query('COMMIT'); return result;
  } catch (e) {
   await client.query('ROLLBACK');
   if ((e as { code?: string }).code === '23505') throw falloGestion('OPERACION_DUPLICADA','La solicitud pendiente o referencia de pago ya existe. Consultá su estado antes de reintentar.');
   throw e;
  } finally { client.release(); }
 }
 private async aplicar(c: PoolClient, actor: string, op: ComandoGestion, d: Record<string, unknown>): Promise<unknown> {
  if (op === 'crearPlan') {
   const id = nuevo('plan-'); await c.query("INSERT INTO planes_membresia(plan_id,nombre,importe_minor,moneda,estado,creado_por) VALUES($1,$2,$3,$4,'ACTIVO',$5)",[id,d.nombre,d.importeMinor,d.moneda,actor]);
   return (await c.query(planSelect + ' WHERE plan_id=$1',[id])).rows.map(r=>({...r,importeMinor:Number(r.importeMinor)}))[0];
  }
  if (op === 'estadoPlan') {
   if (!(await c.query('UPDATE planes_membresia SET estado=$1 WHERE plan_id=$2 RETURNING plan_id',[d.estado,d.id])).rowCount) throw falloGestion('PLAN_NO_ENCONTRADO','No se encontró el plan.',404);
   return (await c.query(planSelect+' WHERE plan_id=$1',[d.id])).rows.map(r=>({...r,importeMinor:Number(r.importeMinor)}))[0];
  }
  let s: SolicitudGestion | undefined;
  let socioId = d.socioId as string;
  if (op !== 'solicitar') {
   if (op === 'confirmarPago') {
    const p = (await c.query('SELECT solicitud_id FROM pagos_membresia WHERE pago_id=$1',[d.id])).rows[0];
    if (!p) throw falloGestion('PAGO_NO_ENCONTRADO','No se encontró el pago.',404);
    s = await this.solicitud(p.solicitud_id,c);
   } else s = await this.solicitud(d.id as string,c);
   socioId = s.socioId;
  }
  const socio = (await c.query('SELECT estado FROM socios WHERE socio_id=$1 FOR UPDATE',[socioId])).rows[0];
  if (!socio) throw falloGestion('SOCIO_NO_ENCONTRADO','No se encontró el socio.',404);
  if (s) s = await this.solicitud(s.solicitudId,c); // Releer después de serializar por socio.
  if (op === 'rechazarSolicitud') {
   if (s!.estado === 'CONFIRMADA') throw falloGestion('TRANSICION_INVALIDA','No se puede rechazar una solicitud confirmada. No implementa devolución.');
   await c.query("UPDATE solicitudes_planes SET estado='RECHAZADA' WHERE solicitud_id=$1",[s!.solicitudId]);
   await c.query("UPDATE pagos_membresia SET estado='RECHAZADO' WHERE solicitud_id=$1",[s!.solicitudId]);
   return this.solicitud(s!.solicitudId,c);
  }
  if (op === 'confirmarPago' && s!.estado === 'CONFIRMADA') return s; // Misma confirmación, sin segunda habilitación.
  if (s && s.estado !== 'PENDIENTE') throw falloGestion('TRANSICION_INVALIDA','La solicitud no está pendiente.');
  if (socio.estado !== 'ACTIVO') throw falloGestion('SOCIO_INACTIVO','La cuenta debe estar activa.',422);
  const planId = s?.planId ?? d.planId;
  const plan = (await c.query(planSelect + ' WHERE plan_id=$1 FOR SHARE',[planId])).rows[0];
  if (!plan) throw falloGestion('PLAN_NO_ENCONTRADO','No se encontró el plan.',404);
  if (plan.estado !== 'ACTIVO') throw falloGestion('PLAN_NO_DISPONIBLE','El plan no está disponible.',422);
  const fin = s?.fechaFin ?? d.fechaFin;
  if (Date.parse(fin as string) < Date.now()) throw falloGestion('SOLICITUD_VENCIDA','La vigencia solicitada ya finalizó.',422);
  if (op === 'solicitar') {
   const id = nuevo('sol-');
   await c.query("INSERT INTO solicitudes_planes(solicitud_id,socio_id,plan_id,nombre_plan,importe_minor,moneda,fecha_inicio,fecha_fin,estado,creado_por) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'PENDIENTE',$9)",[id,socioId,planId,plan.nombre,plan.importeMinor,plan.moneda,d.fechaInicio,d.fechaFin,actor]);
   return this.solicitud(id,c);
  }
  if (op === 'registrarPago') {
   if (d.importeMinor !== s!.importeMinor || d.moneda !== s!.moneda) throw falloGestion('IMPORTE_NO_COINCIDE','El importe y moneda deben coincidir exactamente con la solicitud.',422);
   await c.query("INSERT INTO pagos_membresia(pago_id,solicitud_id,referencia,estado,registrado_por) VALUES($1,$2,$3,'PENDIENTE',$4)",[nuevo('pago-'),s!.solicitudId,d.referencia,actor]);
   return this.solicitud(s!.solicitudId,c);
  }
  const overlap = await c.query('SELECT 1 FROM membresias WHERE socio_id=$1 AND fecha_inicio <= $3 AND fecha_fin >= $2 LIMIT 1',[socioId,s!.fechaInicio,s!.fechaFin]);
  if (overlap.rowCount) throw falloGestion('VIGENCIA_REQUIERE_REVISION','El período se superpone con una membresía registrada. No se definió acumulación, sustitución ni reactivación.',422);
  const memId = nuevo('mem-');
  await c.query("INSERT INTO membresias(membresia_id,socio_id,tipo_plan,fecha_inicio,fecha_fin,estado) VALUES($1,$2,$3,$4,$5,'HABILITADA')",[memId,socioId,s!.nombrePlan,s!.fechaInicio,s!.fechaFin]);
  await c.query("UPDATE pagos_membresia SET estado='CONFIRMADO' WHERE pago_id=$1",[d.id]);
  await c.query("UPDATE solicitudes_planes SET estado='CONFIRMADA' WHERE solicitud_id=$1",[s!.solicitudId]);
  await c.query('INSERT INTO comprobantes_membresia(comprobante_id,pago_id,membresia_id,confirmado_por) VALUES($1,$2,$3,$4)',[nuevo('comp-'),d.id,memId,actor]);
  return this.solicitud(s!.solicitudId,c);
 }
}
