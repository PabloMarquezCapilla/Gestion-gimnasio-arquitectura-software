import Ajv from 'ajv';
import addFormats from 'ajv-formats';

export interface EventoSuspension {
  eventId: string; tipo: 'MembresiaActualizada'; schemaVersion: 1; cambio: 'SUSPENSION';
  ocurridoEn: string; socioId: string; membresiaId: string; estado: 'SUSPENDIDA';
  fechaInicio: string; fechaFin: string; actorId: string; traceparent?: string;
}

export class EventoInvalido extends Error {}
export interface MembresiasEventosRepository {
  aplicarSuspension(evento: EventoSuspension): Promise<{ repetido: boolean; canceladas: number }>;
}
const ajv = new Ajv(); addFormats(ajv);
const id = { type: 'string', minLength: 1, maxLength: 50 };
const fecha = { type: 'string', format: 'date-time' };
const validar = ajv.compile({
  type: 'object', additionalProperties: false,
  required: ['eventId','tipo','schemaVersion','cambio','ocurridoEn','socioId','membresiaId','estado','fechaInicio','fechaFin','actorId'],
  properties: {
    eventId: { type: 'string', format: 'uuid' }, tipo: { const: 'MembresiaActualizada' },
    schemaVersion: { const: 1 }, cambio: { const: 'SUSPENSION' }, estado: { const: 'SUSPENDIDA' },
    socioId: id, membresiaId: id, actorId: id, ocurridoEn: fecha, fechaInicio: fecha, fechaFin: fecha,
    traceparent: { type: 'string', pattern: '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$' },
  },
});

export class MembresiasEventosService {
  constructor(private repository: MembresiasEventosRepository) {}
  async procesar(contenido: Buffer) {
    let evento: unknown;
    try {
      if (contenido.length > 65536) throw new Error();
      evento = JSON.parse(contenido.toString('utf8'));
    } catch { throw new EventoInvalido('EVENTO_INVALIDO'); }
    if (!validar(evento)) throw new EventoInvalido('EVENTO_INVALIDO');
    const suspension = evento as EventoSuspension;
    if (Date.parse(suspension.fechaInicio) > Date.parse(suspension.fechaFin)) throw new EventoInvalido('VIGENCIA_INVALIDA');
    return this.repository.aplicarSuspension(suspension);
  }
}
