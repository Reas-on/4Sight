import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { buildApp } from '../../../app.js';
import { loadEnv } from '../../../config/env.js';
import { createExternalSourceProvider } from '../../../domain/simulation/fixtures.js';

describe.skipIf(process.env.PHASE4_DATABASE_TESTS !== 'true')('capability, CSRF and executor security acceptance', () => {
  let app: FastifyInstance;
  let pool: Pool;
  let base: string;
  let pending = false;
  const body = { scenarioId: 'ssh-brute-force', initialVariant: 'externalSource' };
  beforeAll(async () => {
    const env = loadEnv();
    pool = new Pool({ connectionString: env.DATABASE_URL });
    app = buildApp({ env: { ...env, HOST: '127.0.0.1', PORT: 0, LOG_LEVEL: 'silent', SIMULATION_ENABLED: true, SIMULATION_MODE: 'fixture' },
      simulationProviderFactory: () => pending
        ? { id: 'pending-fixture', decisionTimeoutMs: 60_000, decide: () => new Promise(() => undefined) }
        : createExternalSourceProvider(),
    });
    base = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  async function create() {
    const response = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(202);
    const value = await response.json() as { run: { id: string }; accessToken?: string };
    const cookie = response.headers.get('set-cookie')!;
    return { ...value, cookie, pair: cookie.split(';')[0]!, capability: cookie.split(';')[0]!.split('=')[1]! };
  }

  it('keeps unpredictable capabilities out of JSON and enforces cross-run isolation and server expiry', async () => {
    const first = await create();
    const second = await create();
    expect(first.accessToken).toBeUndefined();
    expect(first.capability).toMatch(/^[a-f0-9]{64}$/);
    expect(first.capability).not.toBe(second.capability);
    expect(first.cookie).toContain('HttpOnly; SameSite=Strict');
    expect(first.cookie).toContain(`Path=/api/v1/runs/${first.run.id}; Max-Age=604800`);
    const cross = await fetch(`${base}/api/v1/runs/${second.run.id}`, { headers: { cookie: first.pair } });
    expect(cross.status).toBe(401);
    const renamed = first.pair.replace(first.run.id, second.run.id);
    expect((await fetch(`${base}/api/v1/runs/${second.run.id}`, { headers: { cookie: renamed } })).status).toBe(404);
    expect((await fetch(`${base}/api/v1/runs/${first.run.id}`, { headers: { cookie: `${first.pair}; ${first.pair}` } })).status).toBe(401);
    await pool.query("update simulation_runs set access_expires_at=now()-interval '1 second' where id=$1", [first.run.id]);
    expect((await fetch(`${base}/api/v1/runs/${first.run.id}`, { headers: { cookie: first.pair } })).status).toBe(404);
    expect((await fetch(`${base}/api/v1/runs/${first.run.id}`, { headers: { 'x-run-token': first.capability } })).status).toBe(404);
  });

  it('blocks cross-origin/null-origin, same-site opaque browser requests and unsupported media types', async () => {
    pending = true;
    const run = await create();
    for (const origin of ['https://evil.invalid', 'null']) {
      const response = await fetch(`${base}/api/v1/runs/${run.run.id}/cancel`, { method: 'POST', headers: { origin, cookie: run.pair } });
      expect(response.status).toBe(403);
    }
    const opaque = await app.inject({ method: 'POST', url: `/api/v1/runs/${run.run.id}/cancel`, remoteAddress: '127.0.0.1',
      headers: { host: '127.0.0.1', 'sec-fetch-site': 'same-site', cookie: run.pair } });
    expect(opaque.statusCode).toBe(403);
    const media = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
    expect(media.status).toBe(415);
    const invalidType = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, additionalContext: 1 }) });
    expect(invalidType.status).toBe(400);
    const snapshot = await fetch(`${base}/api/v1/runs/${run.run.id}`, { headers: { cookie: run.pair } });
    expect(await snapshot.json()).toMatchObject({ status: 'RUNNING', narrative: { version: 0 } });
    expect((await fetch(`${base}/api/v1/runs/${run.run.id}/cancel`, { method: 'POST', headers: { cookie: run.pair, origin: base } })).status).toBe(200);
    pending = false;
  });

  it('ends already-open SSE when its capability expires', async () => {
    pending = true;
    const run = await create();
    const response = await fetch(`${base}/api/v1/runs/${run.run.id}/events`, { headers: { cookie: run.pair }, signal: AbortSignal.timeout(5000) });
    await pool.query("update simulation_runs set access_expires_at=now()-interval '1 second' where id=$1", [run.run.id]);
    await response.text();
    pending = false;
  });

  it('uses Secure cookies for the configured HTTPS origin', async () => {
    const { simulationRoutes } = await import('../../../routes/simulation-routes.js');
    const { default: Fastify } = await import('fastify');
    const fake = Fastify();
    const runId = '11111111-1111-4111-8111-111111111111';
    const { initializeScenario } = await import('../../../domain/narrative/engine.js');
    const { sshBruteForceScenario, sshBruteForceInitialStates } = await import('../../../domain/narrative/scenarios/ssh-brute-force.js');
    const fixture = {
      id: runId, configuration: { scenario: sshBruteForceScenario, scenarioVersion: '1.0.0', initialVariant: 'externalSource', providerId: 'fixture', modelId: null, decisionTimeoutMs: 1000 },
      status: 'RUNNING', revision: 0, eventSequence: 0, narrative: initializeScenario(sshBruteForceScenario, sshBruteForceInitialStates.externalSource),
      records: [], evaluation: null, error: null, createdAt: new Date().toISOString(), startedAt: null, completedAt: null, updatedAt: new Date().toISOString(),
    };
    await fake.register(simulationRoutes, {
      service: { repository: {}, create: async () => ({ run: fixture, accessToken: 'a'.repeat(64) }) } as never,
      allowedOrigin: 'https://sandbox.example', accessToken: 'test-token', models: () => [],
    });
    const response = await fake.inject({ method: 'POST', url: '/api/v1/runs', headers: { host: 'sandbox.example', authorization: 'Bearer test-token', origin: 'https://sandbox.example' }, payload: body });
    expect(response.statusCode).toBe(202);
    expect(response.headers['set-cookie']).toContain('; Secure');
    expect(response.json().accessToken).toBeUndefined();
    await fake.close();
  });

  it('limits rapid run-creation attempts before more inference or database work is scheduled', async () => {
    let response;
    for (let index = 0; index < 21; index++) response = await app.inject({ method: 'POST', url: '/api/v1/runs',
      headers: { host: '127.0.0.1' }, remoteAddress: '127.0.0.2', payload: { unknown: true } });
    expect(response?.statusCode).toBe(429);
    expect(response?.json()).toMatchObject({ error: { code: 'REQUEST_RATE_LIMITED' } });
  });

  it('fails readiness and fences writes after loss of the exclusive executor session', async () => {
    expect((await fetch(`${base}/ready`)).status).toBe(200);
    const lock = await pool.query<{ pid: number }>("select pid from pg_locks where locktype='advisory' and classid=4174 and objid=1 and granted");
    expect(lock.rows).toHaveLength(1);
    await pool.query('select pg_terminate_backend($1)', [lock.rows[0]!.pid]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await fetch(`${base}/ready`);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ checks: { database: { status: 'up' }, simulation: { status: 'down' } } });
    const inaccessible = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(inaccessible.status).toBe(503);
  });
});
