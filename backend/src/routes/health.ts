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
  }),
  timestamp: Type.String({ format: 'date-time' }),
});

const NotReadyResponse = Type.Object({
  status: Type.Literal('not_ready'),
  checks: Type.Object({
    database: Type.Object({
      status: Type.Literal('down'),
    }),
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

      try {
        await app.pool.query('SELECT 1');
        return reply.code(200).send({
          status: 'ready' as const,
          checks: {
            database: {
              status: 'up' as const,
              latencyMs: Math.round(performance.now() - startedAt),
            },
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        app.log.warn({ err: error }, 'readiness database check failed');
        return reply.code(503).send({
          status: 'not_ready' as const,
          checks: {
            database: {
              status: 'down' as const,
            },
          },
          timestamp: new Date().toISOString(),
        });
      }
    },
  );
};
