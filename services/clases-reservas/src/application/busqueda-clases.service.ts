import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export type OrdenClases = 'inicio_asc' | 'inicio_desc' | 'relevancia';
export interface ConsultaClases {
  texto?: string;
  sedeId?: string;
  profesor?: string;
  desde?: string;
  hasta?: string;
  soloConCupo: boolean;
  orden: OrdenClases;
  pagina: number;
  tamanio: number;
}
export interface ClaseEncontrada {
  claseId: string;
  nombre: string;
  actividad: string | null;
  profesor: string | null;
  sedeId: string;
  inicio: string;
  fin: string;
  capacidad: number;
  cuposDisponibles: number;
  reservaDirectaDisponible: boolean;
}
export interface ResultadoBusquedaClases {
  items: ClaseEncontrada[];
  total: number;
}
export interface BuscadorClases {
  buscar(consulta: ConsultaClases, consultadoEn: string): Promise<ResultadoBusquedaClases>;
}
export class BusquedaClasesError extends Error {
  constructor(public statusCode: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

const ajv = new Ajv();
addFormats(ajv,{mode:'full'});
const fechaValida = ajv.compile({type:'string',format:'date-time'});
const claves = new Set(['texto','sedeId','profesor','desde','hasta','soloConCupo','orden','pagina','tamanio']);
const invalida = () => new BusquedaClasesError(400,'PARAMETROS_INVALIDOS','Filtros, fechas, orden o paginación inválidos.');

function cadena(value: unknown, maximo: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim() || Array.from(value).length > maximo || /[\u0000-\u001f\u007f]/.test(value)) throw invalida();
  return value;
}
function numero(value: unknown, defecto: number, maximo: number): number {
  if (value === undefined) return defecto;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) throw invalida();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximo) throw invalida();
  return parsed;
}
function fecha(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 64 || !fechaValida(value)) throw invalida();
  return new Date(value).toISOString();
}

export function consultaClases(value: unknown): ConsultaClases {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalida();
  const q = value as Record<string,unknown>;
  if (Object.keys(q).some(key => !claves.has(key))) throw invalida();
  const texto = cadena(q.texto,200)?.trim();
  const profesor = cadena(q.profesor,100)?.trim();
  const sedeId = cadena(q.sedeId,50);
  const desde = fecha(q.desde);
  const hasta = fecha(q.hasta);
  if (desde && hasta && Date.parse(desde) >= Date.parse(hasta)) throw invalida();
  if (q.soloConCupo !== undefined && q.soloConCupo !== 'true' && q.soloConCupo !== 'false') throw invalida();
  const orden = q.orden ?? 'inicio_asc';
  if (!['inicio_asc','inicio_desc','relevancia'].includes(orden as string) || (orden === 'relevancia' && !texto)) throw invalida();
  return {
    texto, profesor, sedeId, desde, hasta,
    soloConCupo: q.soloConCupo === 'true',
    orden: orden as OrdenClases,
    pagina: numero(q.pagina, 1, 1000000),
    tamanio: numero(q.tamanio, 20, 100),
  };
}

export class BusquedaClasesService {
  constructor(private buscador: BuscadorClases | undefined, private clock: () => Date) {}
  async buscar(query: unknown) {
    const consulta = consultaClases(query);
    if (!this.buscador) throw new BusquedaClasesError(503,'BUSQUEDA_NO_DISPONIBLE','La búsqueda requiere PostgreSQL configurado.');
    const consultadoEn = this.clock().toISOString();
    const resultado = await this.buscador.buscar(consulta,consultadoEn);
    return {...resultado,pagina:consulta.pagina,tamanio:consulta.tamanio,consultadoEn};
  }
}
