import { connect, ChannelModel, ConfirmChannel } from 'amqplib';
import { PostgresMembresiasOutbox } from './membresias.eventos';

const exchange = 'gimnasio.dominio.v1';
const queue = 'clases.membresias.v1';
const routingKey = 'membresia.actualizada.v1';
type Log = { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void };

export class PublicadorMembresias {
  private connection?: ChannelModel;
  private channel?: ConfirmChannel;
  private active?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(private url: string, private outbox: PostgresMembresiasOutbox, private log: Log) {}

  iniciar() {
    this.timer = setInterval(() => this.ejecutar(),1000);
    this.timer.unref();
    this.ejecutar();
  }

  private ejecutar() {
    if (this.stopped || this.active) return;
    this.active = this.paso().catch(async () => {
      this.log.warn({ componente: 'outbox' },'Publicación pendiente; se conserva el evento para reintentar.');
      await this.desconectar();
    }).finally(() => { this.active = undefined; });
  }

  async paso() {
    if (!this.channel) {
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
      await channel.assertQueue(queue,{durable:true});
      await channel.bindQueue(queue,exchange,routingKey);
      this.channel = channel;
    }
    const operacion = await this.outbox.reclamar();
    if (!operacion) return;
    const channel = this.channel;
    await new Promise<void>((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('CONFIRM_TIMEOUT')),5000);
      const returned = () => { clearTimeout(timer); reject(new Error('EVENTO_NO_ENRUTADO')); };
      channel.once('return',returned);
      channel.publish(exchange,routingKey,Buffer.from(JSON.stringify(operacion.evento)),{
        persistent:true,mandatory:true,contentType:'application/json',messageId:operacion.eventId,
      },err => { clearTimeout(timer); channel.removeListener('return',returned); if (err) reject(err); else resolve(); });
    });
    await this.outbox.confirmar(operacion.eventId,operacion.reclamo);
    this.log.info({ eventId:operacion.eventId },'Evento de membresía confirmado por RabbitMQ.');
  }

  private async desconectar() {
    const connection = this.connection;
    this.connection = undefined;
    this.channel = undefined;
    await connection?.close().catch(() => {});
  }

  async cerrar() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.active;
    await this.desconectar();
  }
}
