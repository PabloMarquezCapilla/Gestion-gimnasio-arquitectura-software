import { Pool } from 'pg';
import { BuscadorClases, BusquedaClasesError, ClaseEncontrada, ConsultaClases } from './application/busqueda-clases.service';

// Exportada para ensayar EXPLAIN sobre la misma consulta que usa el adaptador.
export function consultaBusquedaSql(consulta: ConsultaClases, consultadoEn: string) {
  const values: unknown[] = [consultadoEn];
  const conditions = ['c.publicada=TRUE','c.inicio>$1::timestamptz'];
  let ranking = '0::real';
  if (consulta.texto) {
    values.push(consulta.texto);
    const tsquery = `plainto_tsquery('spanish',$${values.length})`;
    conditions.push(`c.documento_busqueda @@ ${tsquery}`);
    ranking = `ts_rank_cd(c.documento_busqueda,${tsquery})`;
  }
  if (consulta.sedeId !== undefined) {
    values.push(consulta.sedeId);
    conditions.push(`c.sede_id=$${values.length}`);
  }
  if (consulta.profesor !== undefined) {
    values.push(consulta.profesor);
    conditions.push(`lower(c.profesor)=lower($${values.length})`);
  }
  if (consulta.desde) {
    values.push(consulta.desde);
    conditions.push(`c.inicio>=$${values.length}::timestamptz`);
  }
  if (consulta.hasta) {
    values.push(consulta.hasta);
    conditions.push(`c.inicio<$${values.length}::timestamptz`);
  }
  const ordenes = {
    inicio_asc: 'inicio ASC,clase_id COLLATE "C" ASC',
    inicio_desc: 'inicio DESC,clase_id COLLATE "C" ASC',
    relevancia: 'relevancia DESC,inicio ASC,clase_id COLLATE "C" ASC',
  };
  const orden = ordenes[consulta.orden];
  values.push(consulta.tamanio,(consulta.pagina-1)*consulta.tamanio);
  return {
    values,
    text: `WITH coincidencias AS MATERIALIZED (
      SELECT c.clase_id,c.nombre,c.actividad,c.profesor,c.sede_id,c.inicio,c.fin,c.capacidad,${ranking} AS relevancia
      FROM clases c WHERE ${conditions.join(' AND ')}
    ), disponibles AS MATERIALIZED (
      SELECT c.*,GREATEST(0,c.capacidad-(SELECT count(*) FROM reservas r
        WHERE r.clase_id=c.clase_id AND r.estado='CONFIRMADA'))::int AS cupos,
        EXISTS(SELECT 1 FROM lista_espera e WHERE e.clase_id=c.clase_id AND e.estado='PENDIENTE') AS espera
      FROM coincidencias c
    ), filtradas AS MATERIALIZED (
      SELECT *,cupos>0 AND NOT espera AS directa FROM disponibles
      ${consulta.soloConCupo ? 'WHERE cupos>0 AND NOT espera' : ''}
    ), pagina AS (
      SELECT * FROM filtradas ORDER BY ${orden} LIMIT $${values.length-1} OFFSET $${values.length}
    ) SELECT (SELECT count(*)::int FROM filtradas) AS total,
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'claseId',clase_id,'nombre',nombre,'actividad',actividad,'profesor',profesor,'sedeId',sede_id,
        'inicio',inicio,'fin',fin,'capacidad',capacidad,'cuposDisponibles',cupos,'reservaDirectaDisponible',directa
      ) ORDER BY ${orden}) FROM pagina),'[]'::jsonb) AS items`,
  };
}

export class PostgresBuscadorClases implements BuscadorClases {
  constructor(private pool: Pool) {}
  async buscar(consulta: ConsultaClases, consultadoEn: string) {
    try {
      const result = await this.pool.query(consultaBusquedaSql(consulta,consultadoEn));
      const row = result.rows[0] as {total:number;items:ClaseEncontrada[]};
      return {
        total: row.total,
        items: row.items.map(item => ({
          ...item,
          inicio: new Date(item.inicio).toISOString(),
          fin: new Date(item.fin).toISOString(),
        })),
      };
    } catch {
      throw new BusquedaClasesError(503,'BUSQUEDA_NO_DISPONIBLE','No se pudo consultar el catálogo. Volvé a intentar.');
    }
  }
}
