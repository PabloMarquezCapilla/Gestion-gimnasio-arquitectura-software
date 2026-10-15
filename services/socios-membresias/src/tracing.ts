import { randomBytes } from 'node:crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceFlags: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    traceContext: TraceContext;
  }
}

const TRACEPARENT_REGEX = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export function parseTraceparent(header?: string | string[]): TraceContext | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const match = TRACEPARENT_REGEX.exec(value.trim());
  if (!match) return null;
  return {
    traceId: match[1],
    spanId: match[2],
    traceFlags: match[3],
  };
}

export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

export function createChildSpan(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
    traceFlags: parent.traceFlags,
  };
}

export function getOutgoingTraceHeaders(context?: TraceContext): Record<string, string> {
  if (!context) {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    return {
      traceparent: `00-${traceId}-${spanId}-01`,
      'x-correlation-id': traceId,
    };
  }
  const child = createChildSpan(context);
  return {
    traceparent: formatTraceparent(child),
    'x-correlation-id': child.traceId,
  };
}

export interface TracingPluginOptions {
  serviceName: string;
}

export async function registerTracing(
  app: FastifyInstance,
  options: TracingPluginOptions
): Promise<void> {
  const serviceName = options.serviceName || 'desconocido';

  app.addHook('onRequest', async (request: FastifyRequest, reply) => {
    const rawTraceparent = request.headers['traceparent'];
    const rawCorrelationId = request.headers['x-correlation-id'];

    let parsed = parseTraceparent(rawTraceparent);
    let traceId: string;
    let parentSpanId: string | undefined;

    if (parsed) {
      traceId = parsed.traceId;
      parentSpanId = parsed.spanId;
    } else if (typeof rawCorrelationId === 'string' && /^[0-9a-fA-F-]{16,64}$/.test(rawCorrelationId)) {
      traceId = rawCorrelationId.replace(/-/g, '').slice(0, 32).padEnd(32, '0').toLowerCase();
      parentSpanId = undefined;
    } else {
      traceId = generateTraceId();
      parentSpanId = undefined;
    }

    const currentSpanId = generateSpanId();
    const traceContext: TraceContext = {
      traceId,
      spanId: currentSpanId,
      parentSpanId,
      traceFlags: '01',
    };

    request.traceContext = traceContext;

    // Attach structured correlation bindings to Fastify logger
    request.log = request.log.child({
      service: serviceName,
      trace_id: traceId,
      span_id: currentSpanId,
      parent_span_id: parentSpanId,
    });

    // Expose in response headers
    reply.header('traceparent', formatTraceparent(traceContext));
    reply.header('x-correlation-id', traceId);
  });
}
