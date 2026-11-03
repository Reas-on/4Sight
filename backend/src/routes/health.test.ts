import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Env } from '../config/env.js';

const testEnv: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 0,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/test',
  DB_POOL_MAX: 2,
  DB_CONNECTION_TIMEOUT_MS: 1000,
  DB_IDLE_TIMEOUT_MS: 1000,
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /health', () => {
  it('reports process liveness', async () => {
    app = buildApp({ env: testEnv });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: '4sight-backend',
    });
  });

  it('rejects unknown query parameters', async () => {
    app = buildApp({ env: testEnv });
    const response = await app.inject({ method: 'GET', url: '/health?x=1' });

    expect(response.statusCode).toBe(400);
  });
});
