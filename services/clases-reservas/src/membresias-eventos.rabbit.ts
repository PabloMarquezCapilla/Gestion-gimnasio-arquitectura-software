import { connect, ChannelModel, ConfirmChannel, ConsumeMessage } from 'amqplib';
import { setTimeout as pause } from 'node:timers/promises';
import { EventoInvalido, MembresiasEventosService } from './application/membresias-eventos.service';

const exchange = 'gimnasio.dominio.v1';
export const MEMBRESIAS_QUEUE = 'clases.membresias.v1';
export const MEMBRESIAS_DLQ = 'clases.membresias.v1.dlq';
const routingKey = 'membresia.actualizada.v1';
type Log = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };

export class ConsumidorMembresias {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private consumerTag?: string;
  private connecting?: Promise<void>;
  private active = new Set<Promise<void>>();
  private timer?: ReturnType<typeof setInterval>;
  private stop = new AbortController();

  constructor(private url: string, private service: MembresiasEventosService, private log: Log) {}

  iniciar() {
    this.timer = setInterval(() => this.conectar(),1000);
    this.timer.unref();
    this.conectar();
  }

  private conectar() {
    if (this.stop.signal.aborted || this.channel || this.connecting) return;
    this.connecting = this.abrir().catch(async () => {
      this.log.warn({ componente:'inbox' },'RabbitMQ no disponible; consumo pendiente.');
      await this.desconectar();
    }).finally(() => { this.connecting = undefined; });
  }

  private async abrir() {
    const url = new URL(this.url);
    url.searchParams.set('heartbeat','10');
    const connection = await connect(url.toString(),{timeout:3000});
    this.connection = connection;
    connection.on('error',() => {});
    connection.on('close',() => { if (this.connection === connection) { this.connection = undefined; this.channel = undefined; } });
    const channel = await connection.createConfirmChannel();
    channel.on('error',() => {});
    channel.on('close',() => { if (this.channel === channel) { this.channel = undefined; void connection.close().catch(() => {}); } });
    await channel.assertExchange(exchange,'topic',{durable:true});
    await channel.assertQueue(MEMBRESIAS_QUEUE,{durable:true});
    await channel.bindQueue(MEMBRESIAS_QUEUE,exchange,routingKey);
    await channel.assertQueue(MEMBRESIAS_DLQ,{durable:true});
    await channel.prefetch(1);
    this.channel = channel;
    const consumer = await channel.consume(MEMBRESIAS_QUEUE,message => {
      if (!message) { void this.desconectar(); return; }
      const active = this.procesar(channel,message).catch(async () => {
        this.log.warn({ componente:'inbox' },'Entrega sin confirmar; RabbitMQ podrá repetirla.');
        if (this.channel === channel) await this.desconectar();
      }).finally(() => { this.active.delete(active); });
      this.active.add(active);
    },{noAck:false});
    this.consumerTag = consumer.consumerTag;
  }

  private async procesar(channel: ConfirmChannel, message: ConsumeMessage) {
    try {
      const result = await this.service.procesar(message.content);
      channel.ack(message);
      this.log.info({ eventId:message.properties.messageId,...result },'Evento de membresía aplicado en Clases.');
    } catch (error) {
      if (this.stop.signal.aborted) throw error;
      const intento = message.properties.headers?.['gimnasio-intento'] ?? 0;
      const invalido = error instanceof EventoInvalido || !Number.isInteger(intento) || intento < 0 || intento > 3;
      const agotado = invalido || intento >= 3;
      if (!agotado) await pause([1000,5000,15000][intento],undefined,{signal:this.stop.signal});
      const destino = agotado ? MEMBRESIAS_DLQ : MEMBRESIAS_QUEUE;
      await new Promise<void>((resolve,reject) => {
        const timer = setTimeout(() => reject(new Error('CONFIRM_TIMEOUT')),5000);
        const returned = () => { clearTimeout(timer); reject(new Error('EVENTO_NO_ENRUTADO')); };
        channel.once('return',returned);
        channel.sendToQueue(destino,message.content,{
          persistent:true,mandatory:true,contentType:'application/json',messageId:message.properties.messageId,
          headers: { 'gimnasio-intento':agotado ? intento : intento+1,
            'gimnasio-causa':invalido ? 'EVENTO_INVALIDO' : 'PROCESAMIENTO_FALLIDO' },
        },err => { clearTimeout(timer); channel.removeListener('return',returned); if (err) reject(err); else resolve(); });
      });
      channel.ack(message);
      this.log.warn({ eventId:message.properties.messageId,destino,intento,
        codigo:error instanceof EventoInvalido ? error.message : 'PROCESAMIENTO_FALLIDO' },'Evento conservado para reintento o revisión.');
    }
  }

  private async desconectar() {
    const connection = this.connection;
    this.connection = undefined;
    this.channel = undefined;
    this.consumerTag = undefined;
    await connection?.close().catch(() => {});
  }

  async cerrar() {
    this.stop.abort();
    clearInterval(this.timer);
    await this.connecting;
    if (this.channel && this.consumerTag) await this.channel.cancel(this.consumerTag).catch(() => {});
    await Promise.all(this.active);
    await this.desconectar();
  }
}
