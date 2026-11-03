import { Type } from '@sinclair/typebox';
import type { FastifyPluginAsync } from 'fastify';

const EmptyQuery = Type.Object({}, { additionalProperties: false });

const HealthResponse = Type.Object({
  status: Type.Literal('ok'),
  service: Type.Literal('4sight-backend'),
  uptimeSeconds: Type.Number(),
  timestamp: Type.String({ format: 'date-time' }),
});

const ReadyResponse = Type.Object({
  status: Type.Literal('ready'),
  checks: Type.Object({
    database: Type.Object({
      status: Type.Literal('up'),
      latencyMs: Type.Number(),
    }),
    simulation: Type.Optional(Type.Object({ status: Type.Literal('up') })),
  }),
  timestamp: Type.String({ format: 'date-time' }),
});

const NotReadyResponse = Type.Object({
  status: Type.Literal('not_ready'),
  checks: Type.Object({
    database: Type.Object({
      status: Type.Union([Type.Literal('up'), Type.Literal('down')]),
    }),
    simulation: Type.Optional(Type.Object({ status: Type.Union([Type.Literal('up'), Type.Literal('down')]) })),
  }),
  timestamp: Type.String({ format: 'date-time' }),
});

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        querystring: EmptyQuery,
        response: { 200: HealthResponse },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return {
        status: 'ok' as const,
        service: '4sight-backend' as const,
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      };
    },
  );

  app.get(
    '/ready',
    {
      schema: {
        querystring: EmptyQuery,
        response: { 200: ReadyResponse, 503: NotReadyResponse },
      },
    },
    async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      const startedAt = performance.now();
      let databaseUp = false;

      try {
        await app.pool.query('SELECT 1');
        databaseUp = true;
        if (app.simulationReady && !app.simulationReady()) throw new Error('Executor unavailable');
        return reply.code(200).send({
          status: 'ready' as const,
          checks: {
            database: {
              status: 'up' as const,
              latencyMs: Math.round(performance.now() - startedAt),
            },
            ...(app.simulationReady ? { simulation: { status: 'up' as const } } : {}),
          },
          timestamp: new Date().toISOString(),
        });
      } catch {
        app.log.warn({ code: 'READINESS_CHECK_FAILED' }, 'readiness check failed');
        return reply.code(503).send({
          status: 'not_ready' as const,
          checks: {
            database: {
              status: databaseUp ? 'up' as const : 'down' as const,
            },
            ...(app.simulationReady ? { simulation: { status: app.simulationReady() ? 'up' as const : 'down' as const } } : {}),
          },
          timestamp: new Date().toISOString(),
        });
      }
    },
  );
};
