import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import { loadEnv, type Env } from './config/env.js';
import { databasePlugin } from './plugins/database.js';
import { healthRoutes } from './routes/health.js';
import { simulationPlugin } from './plugins/simulation.js';
import type { ProviderFactory } from './application/simulation/simulation-service.js';

export interface BuildAppOptions {
  env?: Env;
  simulationProviderFactory?: ProviderFactory;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = options.env ?? loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      base: { service: '4sight-backend', environment: env.NODE_ENV },
      serializers: { req: (request: FastifyRequest) => ({
        method: request.method, url: request.url.split('?')[0] ?? '/', remoteAddress: request.ip,
      }) },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-run-token"]', '*.apiKey', '*.GEMINI_API_KEY', 'prompt', 'additionalContext'],
        censor: '[REDACTED]',
      },
    },
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: true,
        useDefaults: true,
      },
    },
    trustProxy: false,
    requestTimeout: 15_000,
    bodyLimit: 12_288,
    forceCloseConnections: true,
  });

  app.register(databasePlugin, { env });
  app.register(healthRoutes);
  if (env.SIMULATION_ENABLED) {
    app.register(simulationPlugin, { env,
      ...(options.simulationProviderFactory ? { providerFactory: options.simulationProviderFactory } : {}) });
  }

  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      request.log.error({ code: 'INTERNAL_SERVER_ERROR', statusCode }, 'request failed');
    } else {
      request.log.warn({ code: error.code ?? 'REQUEST_ERROR', statusCode }, 'request rejected');
    }

    const message =
      isServerError ? 'Internal Server Error' : 'Request rejected';

    void reply.code(statusCode).send({
      error: {
        code: error.code ?? (isServerError ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
        message,
      },
    });
  });

  return app;
}
