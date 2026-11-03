import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { loadEnv, type Env } from './config/env.js';
import { databasePlugin } from './plugins/database.js';
import { healthRoutes } from './routes/health.js';

export interface BuildAppOptions {
  env?: Env;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const env = options.env ?? loadEnv();

  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      base: { service: '4sight-backend', environment: env.NODE_ENV },
    },
    ajv: {
      customOptions: {
        removeAdditional: false,
        coerceTypes: true,
        useDefaults: true,
      },
    },
    trustProxy: false,
  });

  app.register(databasePlugin, { env });
  app.register(healthRoutes);

  app.setNotFoundHandler((request, reply) => {
    void reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${request.url} not found`,
      },
    });
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      request.log.error({ err: error }, 'request failed');
    } else {
      request.log.warn({ err: error }, 'request rejected');
    }

    const message =
      isServerError && env.NODE_ENV === 'production' ? 'Internal Server Error' : error.message;

    void reply.code(statusCode).send({
      error: {
        code: error.code ?? (isServerError ? 'INTERNAL_SERVER_ERROR' : 'REQUEST_ERROR'),
        message,
      },
    });
  });

  return app;
}
