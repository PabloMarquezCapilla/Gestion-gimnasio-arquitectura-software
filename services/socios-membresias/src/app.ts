import { hostname } from 'node:os';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ISociosRepository, MemorySociosRepository } from './repository';
import { registerTracing } from './tracing';
import { Socio, Membresia, RegistroDTO, LoginDTO, AuthResponse } from './types';
import { hashPassword, verifyPassword } from './security';

export interface SociosAppOptions {
  repository?: ISociosRepository;
  logger?: boolean | Record<string, unknown>;
}

export function buildSociosApp(options: SociosAppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  const repository = options.repository ?? new MemorySociosRepository();
  const instanceId = hostname();
  let httpRequestsTotal = 0;
  let httpErrorsTotal = 0;

  void registerTracing(app, { serviceName: 'socios-membresias' });

  app.addHook('onResponse', async (request, reply) => {
    httpRequestsTotal += 1;
    if (reply.statusCode >= 500) {
      httpErrorsTotal += 1;
    }
  });

  app.get('/health', async (request, reply) => {
    reply.header('X-Instance-ID', instanceId);
    const salud = await repository.verificarSalud();
    if (!salud.ok) {
      reply.code(503);
      return {
        servicio: 'socios-membresias',
        instancia: instanceId,
        estado: 'error',
        persistencia: repository instanceof MemorySociosRepository ? 'memoria' : 'postgresql',
        error: salud.detalle,
        timestamp: new Date().toISOString(),
      };
    }
    return {
      servicio: 'socios-membresias',
      instancia: instanceId,
      estado: 'operativo',
      persistencia: repository instanceof MemorySociosRepository ? 'memoria' : 'postgresql',
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/metrics', async (request, reply) => {
    reply.header('content-type', 'text/plain; version=0.0.4');
    reply.header('X-Instance-ID', instanceId);
    return [
      '# HELP http_requests_total Total de solicitudes HTTP procesadas',
      '# TYPE http_requests_total counter',
      `http_requests_total{service="socios-membresias",instance="${instanceId}"} ${httpRequestsTotal}`,
      '# HELP http_errors_total Total de respuestas HTTP 5xx emitidas',
      '# TYPE http_errors_total counter',
      `http_errors_total{service="socios-membresias",instance="${instanceId}"} ${httpErrorsTotal}`,
      '# HELP pg_pool_active_connections Conexiones en el pool de base de datos',
      '# TYPE pg_pool_active_connections gauge',
      `pg_pool_active_connections{service="socios-membresias",instance="${instanceId}"} ${repository instanceof MemorySociosRepository ? 0 : 1}`,
      '# HELP process_uptime_seconds Tiempo de actividad en segundos',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds{service="socios-membresias",instance="${instanceId}"} ${Math.floor(process.uptime())}`,
    ].join('\n') + '\n';
  });

  // Endpoints de Autenticacion y Registro con Hash seguro de contraseñas
  app.post<{ Body: RegistroDTO }>('/api/v1/auth/registro', async (request, reply) => {
    const { dni, nombre, email, password, telefono, tipoPlan, rol } = request.body || {};

    if (!dni || !nombre || !email || !password) {
      return reply.code(400).send({
        codigo: 'DATOS_INCOMPLETOS',
        mensaje: 'DNI, nombre, email y contraseña son obligatorios para el registro.',
      });
    }

    if (password.length < 6) {
      return reply.code(400).send({
        codigo: 'PASSWORD_CORTO',
        mensaje: 'La contraseña debe tener al menos 6 caracteres.',
      });
    }

    const existentePorEmail = await repository.buscarPorEmailODni(email);
    if (existentePorEmail) {
      return reply.code(409).send({
        codigo: 'EMAIL_EN_USO',
        mensaje: 'El correo electrónico ya se encuentra registrado.',
      });
    }

    const existentePorDni = await repository.buscarPorEmailODni(dni);
    if (existentePorDni) {
      return reply.code(409).send({
        codigo: 'DNI_EN_USO',
        mensaje: 'El número de DNI ya se encuentra registrado.',
      });
    }

    const socioId = `socio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const passwordHash = hashPassword(password);
    const ahora = new Date().toISOString();

    const nuevoSocio: Socio = {
      socioId,
      dni: dni.trim(),
      nombre: nombre.trim(),
      email: email.trim().toLowerCase(),
      passwordHash,
      rol: rol === 'ADMIN' ? 'ADMIN' : 'SOCIO',
      telefono: telefono?.trim(),
      estado: 'ACTIVO',
      createdAt: ahora,
    };

    const socioCreado = await repository.crearSocio(nuevoSocio);

    // Si seleccionó un plan, se le habilita la membresía inicial
    let membresiaCreada: Membresia | null = null;
    const planElegido = tipoPlan || 'STANDARD_SEMESTRAL';
    const diasVigencia = planElegido === 'FULL_ANUAL' ? 365 : planElegido === 'MENSUAL' ? 30 : 180;
    const fechaFin = new Date(Date.now() + diasVigencia * 24 * 60 * 60 * 1000).toISOString();

    membresiaCreada = await repository.crearMembresia({
      membresiaId: `mem-${Date.now().toString(36)}`,
      socioId: socioCreado.socioId,
      tipoPlan: planElegido,
      fechaInicio: ahora,
      fechaFin,
      estado: 'HABILITADA',
      createdAt: ahora,
      updatedAt: ahora,
    });

    const { passwordHash: _, ...socioSeguro } = socioCreado;
    const token = Buffer.from(`${socioCreado.socioId}:${Date.now()}`).toString('base64');

    return reply.code(201).send({
      token,
      socio: socioSeguro,
      membresia: membresiaCreada,
    });
  });

  app.post<{ Body: LoginDTO }>('/api/v1/auth/login', async (request, reply) => {
    const { emailOrDni, password } = request.body || {};

    if (!emailOrDni || !password) {
      return reply.code(400).send({
        codigo: 'DATOS_INCOMPLETOS',
        mensaje: 'Email/DNI y contraseña son obligatorios.',
      });
    }

    const socio = await repository.buscarPorEmailODni(emailOrDni);
    if (!socio || !socio.passwordHash) {
      return reply.code(401).send({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Credenciales inválidas. Verifique sus datos.',
      });
    }

    const valido = verifyPassword(password, socio.passwordHash);
    if (!valido) {
      return reply.code(401).send({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Credenciales inválidas. Verifique sus datos.',
      });
    }

    const membresia = await repository.obtenerMembresia(socio.socioId);
    const { passwordHash: _, ...socioSeguro } = socio;
    const token = Buffer.from(`${socio.socioId}:${Date.now()}`).toString('base64');

    return reply.code(200).send({
      token,
      socio: socioSeguro,
      membresia: membresia ?? null,
    });
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
    const { passwordHash: _, ...socioSeguro } = socio;
    return { ...socioSeguro, membresia: membresia ?? null };
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
    const { passwordHash: _, ...socioSeguro } = socio;
    request.log.info({ socioId: socio.socioId }, 'Socio creado exitosamente');
    return reply.code(201).send(socioSeguro);
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
