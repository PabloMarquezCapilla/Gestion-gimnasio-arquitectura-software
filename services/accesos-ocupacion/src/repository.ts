import { randomUUID } from 'node:crypto';
import { Collection, MongoClient, MongoServerError } from 'mongodb';
import { AccesosError, AccesosRepository, decidir, Evaluacion, Movimiento, Operacion, Resultado, Sede } from './domain';

interface Presencia { _id: string; sedeId: string; socioId: string; abierta: boolean; revision: number }
interface Registro { _id: string; contenido: string; resultado: Resultado }
interface MovimientoDoc { _id: string; movimiento: Movimiento; sedeId: string; socioId: string; fecha: string }
interface SedeDoc extends Sede { _id: string }
const identidad = (op: Operacion) => JSON.stringify([op.actorId, op.clave]);
const contenido = (op: Operacion) => JSON.stringify([op.sedeId, op.socioId, op.tipo]);

export class MongoAccesosRepository implements AccesosRepository {
  private readonly presencias: Collection<Presencia>;
  private readonly operaciones: Collection<Registro>;
  private readonly movimientos: Collection<MovimientoDoc>;
  private readonly catalogo: Collection<SedeDoc>;
  constructor(private readonly client: MongoClient, database?: string) {
    const db = client.db(database);
    this.presencias = db.collection('presencias'); this.operaciones = db.collection('operaciones');
    this.movimientos = db.collection('movimientos'); this.catalogo = db.collection('sedes');
  }
  async inicializar(sedes: Sede[]) {
    const hello = await this.client.db('admin').command({ hello: 1 });
    if (!hello.setName) throw new Error('Accesos requiere MongoDB replica set para transacciones.');
    await this.presencias.createIndex({ sedeId: 1, socioId: 1 }, { unique: true, name: 'uq_presencia_socio_sede' });
    await this.presencias.createIndex({ sedeId: 1, abierta: 1 }, { name: 'ocupacion_sede' });
    await this.movimientos.createIndex({ sedeId: 1, fecha: -1, _id: -1 }, { name: 'historial_sede' });
    await this.movimientos.createIndex({ sedeId: 1, socioId: 1, fecha: -1, _id: -1 }, { name: 'historial_socio' });
    // Creación explícita de la colección antes de usar transacciones; no borra historial ni vence claves.
    await this.operaciones.createIndex({ _id: 1 });
    for (const sede of sedes) await this.catalogo.updateOne({ _id: sede.sedeId }, { $setOnInsert: { ...sede } }, { upsert: true });
  }
  async salud() { await this.client.db().command({ ping: 1 }, { timeoutMS: 3000 }); }
  async sedes(): Promise<Sede[]> {
    return (await this.catalogo.find({}, { projection: { _id: 0 }, maxTimeMS: 3000 }).sort({ sedeId: 1 }).toArray());
  }
  async existeSede(sedeId: string) { return !!await this.catalogo.findOne({ _id: sedeId }, { maxTimeMS: 3000 }); }
  private resultado(registro: Registro | null, op: Operacion): Resultado | null {
    if (!registro) return null;
    if (registro.contenido !== contenido(op)) throw new AccesosError(409, 'IDEMPOTENCIA_EN_CONFLICTO', 'La clave ya se utilizó para otra operación.');
    return registro.resultado;
  }
  async repeticion(op: Operacion) { return this.resultado(await this.operaciones.findOne({ _id: identidad(op) }, { maxTimeMS: 3000 }), op); }
  async registrar(op: Operacion, evaluacion: Evaluacion | null, fecha: string): Promise<Resultado> {
    const pair = JSON.stringify([op.sedeId, op.socioId]);
    // El documento estable serializa también ingreso/egreso simultáneos y rechazos.
    // Un documento cerrado sin movimiento no altera la ocupación si falla la transacción posterior.
    try {
      await this.presencias.updateOne({ _id: pair }, { $setOnInsert: {
        sedeId: op.sedeId, socioId: op.socioId, abierta: false, revision: 0,
      } }, { upsert: true, timeoutMS: 5000 });
    } catch (error) { if (!(error instanceof MongoServerError && error.code === 11000)) throw error; }
    for (let intento = 0; intento < 3; intento++) {
      const session = this.client.startSession();
      try {
        return await session.withTransaction(async () => {
          const anterior = this.resultado(await this.operaciones.findOne({ _id: identidad(op) }, { session }), op);
          if (anterior) return anterior;
          const presencia = await this.presencias.findOneAndUpdate({ _id: pair }, { $inc: { revision: 1 } }, { session, returnDocument: 'after' });
          if (!presencia) throw new Error('Presencia ausente.');
          const codigo = decidir(op.tipo, presencia.abierta, evaluacion);
          const aceptado = codigo === 'INGRESO_REGISTRADO' || codigo === 'EGRESO_REGISTRADO';
          const movimiento: Movimiento = { sedeId: op.sedeId, socioId: op.socioId, tipo: op.tipo,
            actorId: op.actorId, movimientoId: randomUUID(), fecha, aceptado, codigo };
          if (aceptado) await this.presencias.updateOne({ _id: pair }, { $set: { abierta: op.tipo === 'INGRESO' } }, { session });
          await this.movimientos.insertOne({ _id: identidad(op), sedeId: op.sedeId, socioId: op.socioId, fecha, movimiento }, { session });
          const resultado = { movimiento };
          await this.operaciones.insertOne({ _id: identidad(op), contenido: contenido(op), resultado }, { session });
          return resultado;
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary', maxCommitTimeMS: 3000, timeoutMS: 8000 });
      } catch (error) {
        // Dos transacciones con la misma clave, incluso para pares distintos, convergen al replay/conflicto.
        if (!(error instanceof MongoServerError && error.code === 11000) || intento === 2) throw error;
        const replay = await this.repeticion(op);
        if (replay) return replay;
      } finally { await session.endSession(); }
    }
    throw new AccesosError(503, 'ALMACENAMIENTO_NO_DISPONIBLE', 'No se pudo confirmar la operación. Reintentá con la misma clave.');
  }
  async ocupacion(sedeId: string) { return this.presencias.countDocuments({ sedeId, abierta: true }, { maxTimeMS: 3000 }); }
  async historial(sedeId: string, socioId: string | undefined, pagina: number, tamanio: number) {
    return (await this.movimientos.find({ sedeId, ...(socioId ? { socioId } : {}) }, { maxTimeMS: 3000 })
      .sort({ fecha: -1, _id: -1 }).skip((pagina - 1) * tamanio).limit(tamanio).toArray()).map(r => r.movimiento);
  }
}
