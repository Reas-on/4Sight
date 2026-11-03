import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { simulationRoutes } from './simulation-routes.js';
import { ApplicationError, type DurableRun } from '../application/simulation/contracts.js';
import type { SimulationService } from '../application/simulation/simulation-service.js';
import { initializeScenario } from '../domain/narrative/engine.js';
import { sshBruteForceScenario, sshBruteForceInitialStates } from '../domain/narrative/scenarios/ssh-brute-force.js';

const origin = 'http://localhost:5173';
const id = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const capability = 'a'.repeat(64);
const body = { scenarioId: 'ssh-brute-force', initialVariant: 'externalSource' };
const browserHeaders = { host: 'localhost:5173', origin, 'sec-fetch-site': 'same-origin' };
const cookie = `fourSightRun_${id}=${capability}`;

describe('public browser origin behind the same-origin development proxy', () => {
  let app: FastifyInstance;
  afterEach(async () => app?.close());

  async function setup() {
    const now = new Date().toISOString();
    const run: DurableRun = {
      id, configuration: { scenario: sshBruteForceScenario, scenarioVersion: '1.0.0', initialVariant: 'externalSource',
        providerId: 'test-only', modelId: null, decisionTimeoutMs: 1000 },
      status: 'CANCELLED', revision: 1, eventSequence: 2,
      narrative: initializeScenario(sshBruteForceScenario, sshBruteForceInitialStates.externalSource),
      records: [], evaluation: null, error: null, createdAt: now, startedAt: now, completedAt: now, updatedAt: now,
    };
    const create = vi.fn(async () => ({ run, accessToken: capability }));
    const authorize = vi.fn(async (runId: string, token: string) => {
      if (runId !== id || token !== capability) throw new ApplicationError('RUN_NOT_FOUND', 404);
    });
    app = Fastify({ trustProxy: false });
    await app.register(simulationRoutes, {
      allowedOrigin: origin, models: () => [],
      service: { create, repository: { authorize, read: async () => run,
        events: async (_id: string, after: number) => [1, 2].filter(sequence => sequence > after).map(sequence => ({
          id: `event-${sequence}`, runId: id, sequence, eventType: sequence === 2 ? 'run.finished' : 'run.created',
          storyletId: null, nodeId: null, stateVersion: 0, payload: {}, createdAt: now,
        })),
      } } as unknown as SimulationService,
    });
    return { create, authorize };
  }

  it('accepts the configured localhost POST and issues a private path-scoped HTTP cookie', async () => {
    await setup();
    const response = await app.inject({ method: 'POST', url: '/api/v1/runs', headers: browserHeaders, payload: body });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ run: { id } });
    expect(response.json().accessToken).toBeUndefined();
    expect(response.headers['set-cookie']).toContain(`HttpOnly; SameSite=Strict; Path=/api/v1/runs/${id}; Max-Age=604800`);
    expect(response.headers['set-cookie']).not.toMatch(/; (Secure|Domain=)/);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects other hosts, ports, null and cross-site origins before creating a run', async () => {
    const { create } = await setup();
    for (const denied of ['http://127.0.0.1:5173', 'http://localhost:5174', 'https://untrusted.invalid', 'null']) {
      const response = await app.inject({ method: 'POST', url: '/api/v1/runs', headers: { ...browserHeaders, origin: denied }, payload: body });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: { code: 'CROSS_ORIGIN_DENIED' } });
    }
    const crossSite = await app.inject({ method: 'POST', url: '/api/v1/runs', headers: { ...browserHeaders, 'sec-fetch-site': 'cross-site' }, payload: body });
    expect(crossSite.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
  });

  it('ignores spoofed forwarding headers and rejects opaque same-site requests', async () => {
    await setup();
    const spoofed = await app.inject({ method: 'POST', url: '/api/v1/runs', headers: {
      ...browserHeaders, origin: 'https://untrusted.invalid', 'x-forwarded-host': 'localhost:5173',
      'x-forwarded-proto': 'http', 'x-forwarded-for': '127.0.0.1',
    }, payload: body });
    expect(spoofed.statusCode).toBe(403);
    const opaque = await app.inject({ method: 'POST', url: '/api/v1/runs', headers: {
      host: 'localhost:5173', 'sec-fetch-site': 'same-site',
    }, payload: body });
    expect(opaque.statusCode).toBe(403);
  });

  it('still requires the correct run capability and prevents cross-run access', async () => {
    await setup();
    const get = (runId: string, value?: string) => app.inject({ method: 'GET', url: `/api/v1/runs/${runId}`,
      headers: { ...browserHeaders, ...(value ? { cookie: value } : {}) } });
    expect((await get(id, cookie)).statusCode).toBe(200);
    expect((await get(id)).statusCode).toBe(401);
    expect((await get(otherId, cookie)).statusCode).toBe(401);
    expect((await get(otherId, cookie.replace(id, otherId))).statusCode).toBe(404);
    expect((await get(id, `${cookie}; ${cookie}`)).statusCode).toBe(401);
    const deniedStream = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events`, headers: browserHeaders });
    expect(deniedStream.statusCode).toBe(401);
  });

  it('streams and reconnects with the same cookie and Last-Event-ID cursor', async () => {
    await setup();
    const headers = { ...browserHeaders, cookie };
    const stream = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events?after=0`, headers });
    expect(stream.statusCode).toBe(200);
    expect(stream.headers['content-type']).toBe('text/event-stream');
    expect(stream.body).toContain(`id: ${id}:1\n`);
    const replay = await app.inject({ method: 'GET', url: `/api/v1/runs/${id}/events?after=0`,
      headers: { ...headers, 'last-event-id': `${id}:1` } });
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toContain(`id: ${id}:2\n`);
    expect(replay.body).not.toContain(`id: ${id}:1\n`);
  });
});
