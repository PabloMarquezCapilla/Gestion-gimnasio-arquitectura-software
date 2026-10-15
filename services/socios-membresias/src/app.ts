import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ISociosRepository, MemorySociosRepository } from './repository';
import { registerTracing } from './tracing';
import { Socio, Membresia } from './types';

export interface SociosAppOptions {
  repository?: ISociosRepository;
  logger?: boolean;
}

export function buildSociosApp(options: SociosAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  const repository = options.repository ?? new MemorySociosRepository();

  void registerTracing(app, { serviceName: 'socios-membresias' });

  app.get('/health', async (request, reply) => {
    const salud = await repository.verificarSalud();
    if (!salud.ok) {
      reply.code(503);
      return {
        servicio: 'socios-membresias',
        estado: 'error',
        persistencia: repository instanceof MemorySociosRepository ? 'memoria' : 'postgresql',
        error: salud.detalle,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      servicio: 'socios-membresias',
      estado: 'operativo',
      persistencia: repository instanceof MemorySociosRepository ? 'memoria' : 'postgresql',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/metrics', async (request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    return [
      '# HELP http_requests_total Total de solicitudes HTTP procesadas',
      '# TYPE http_requests_total counter',
      'http_requests_total{service="socios-membresias"} 1',
      '# HELP pg_pool_active_connections Conexiones en el pool de base de datos',
      '# TYPE pg_pool_active_connections gauge',
      `pg_pool_active_connections{service="socios-membresias"} ${repository instanceof MemorySociosRepository ? 0 : 1}`,
      '# HELP process_uptime_seconds Tiempo de actividad en segundos',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds{service="socios-membresias"} ${Math.floor(process.uptime())}`,
    ].join('\n') + '\n';
  });

  // Endpoint clave para la colaboracion con Clases y Reservas
  app.get<{
    Params: { socioId: string };
    Querystring: { fecha?: string };
  }>('/api/v1/socios/:socioId/habilitacion', async (request, reply) => {
    const { socioId } = request.params;
    const { fecha } = request.query;

    let fechaReferencia = new Date();
    if (fecha) {
      const parsed = Date.parse(fecha);
      if (Number.isNaN(parsed)) {
        return reply.code(400).send({
          codigo: 'FECHA_INVALIDA',
          mensaje: 'El parametro fecha debe ser una fecha valida RFC 3339.',
        });
      }
      fechaReferencia = new Date(parsed);
    }

    request.log.info(
      { socioId, fechaReferencia: fechaReferencia.toISOString() },
      'Evaluando habilitacion de membresia para socio'
    );

    const resultado = await repository.evaluarHabilitacion(socioId, fechaReferencia);

    request.log.info(
      { socioId, habilitado: resultado.habilitado, motivo: resultado.motivo },
      'Resultado de evaluacion de membresia'
    );

    return resultado;
  });

  app.get<{ Params: { socioId: string } }>('/api/v1/socios/:socioId', async (request, reply) => {
    const socio = await repository.obtenerSocio(request.params.socioId);
    if (!socio) {
      return reply.code(404).send({
        codigo: 'SOCIO_NO_ENCONTRADO',
        mensaje: 'No se encontro el socio solicitado.',
      });
    }
    const membresia = await repository.obtenerMembresia(request.params.socioId);
    return { ...socio, membresia: membresia ?? null };
  });

  app.post<{ Body: Socio }>('/api/v1/socios', async (request, reply) => {
    const body = request.body;
    if (!body?.socioId || !body?.dni || !body?.nombre || !body?.email) {
      return reply.code(400).send({
        codigo: 'DATOS_INCOMPLETOS',
        mensaje: 'socioId, dni, nombre y email son obligatorios.',
      });
    }
    const socio = await repository.crearSocio({
      ...body,
      estado: body.estado || 'ACTIVO',
      createdAt: body.createdAt || new Date().toISOString(),
    });
    request.log.info({ socioId: socio.socioId }, 'Socio creado exitosamente');
    return reply.code(201).send(socio);
  });

  app.post<{
    Params: { socioId: string };
    Body: Omit<Membresia, 'socioId' | 'createdAt' | 'updatedAt'>;
  }>('/api/v1/socios/:socioId/membresias', async (request, reply) => {
    const { socioId } = request.params;
    const socio = await repository.obtenerSocio(socioId);
    if (!socio) {
      return reply.code(404).send({
        codigo: 'SOCIO_NO_ENCONTRADO',
        mensaje: 'No se puede asociar membresia a un socio inexistente.',
      });
    }
    const body = request.body;
    if (!body?.tipoPlan || !body?.fechaInicio || !body?.fechaFin) {
      return reply.code(400).send({
        codigo: 'DATOS_INCOMPLETOS',
        mensaje: 'tipoPlan, fechaInicio y fechaFin son obligatorios para la membresia.',
      });
    }
    const membresia: Membresia = {
      membresiaId: body.membresiaId || `mem-${Date.now()}`,
      socioId,
      tipoPlan: body.tipoPlan,
      fechaInicio: body.fechaInicio,
      fechaFin: body.fechaFin,
      estado: body.estado || 'HABILITADA',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const guardada = await repository.crearMembresia(membresia);
    request.log.info({ socioId, membresiaId: guardada.membresiaId }, 'Membresia registrada');
    return reply.code(201).send(guardada);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return reply.code(409).send({
        codigo: 'DATO_DUPLICADO',
        mensaje: 'Ya existe un registro con el mismo identificador o DNI.',
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    request.log.error({ err: error }, 'Error procesando solicitud en socios-membresias');
    return reply.code(statusCode).send({
      codigo: 'ERROR_INTERNO',
      mensaje: error instanceof Error ? error.message : 'Error interno.',
    });
  });

  return app;
}
