import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { loadEnv } from '../../../config/env.js';
import { createExternalSourceProvider, createProtectedInternalProvider, createUnsafeProtectedBlockProvider, EXTERNAL_SOURCE_DECISIONS } from '../../../domain/simulation/fixtures.js';
import type { ProposedDecision } from '../../../domain/referee/types.js';
import type { DecisionProvider } from '../../../domain/simulation/types.js';
import { OllamaDecisionProvider } from '../../../ai/providers/ollama.js';
import { vi } from 'vitest';

const enabled = process.env.PHASE4_DATABASE_TESTS === 'true';
describe.skipIf(!enabled)('Phase 4 live HTTP and PostgreSQL API/SSE', () => {
  let app: FastifyInstance;
  let base: string;
  let overrideProvider: (() => DecisionProvider) | undefined;
  beforeAll(async () => {
    app = buildApp({ env: { ...loadEnv(), HOST: '127.0.0.1', PORT: 0, LOG_LEVEL: 'silent',
      SIMULATION_ENABLED: true, SIMULATION_MODE: 'fixture' },
    simulationProviderFactory: (variant) => overrideProvider ? overrideProvider()
      : variant === 'externalSource' ? createExternalSourceProvider() : createProtectedInternalProvider(),
    });
    base = await app.listen({ port: 0, host: '127.0.0.1' });
  });
  afterAll(async () => app?.close());

  const create = async (variant = 'externalSource') => {
    const response = await fetch(`${base}/api/v1/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'ssh-brute-force', initialVariant: variant }),
    });
    expect(response.status).toBe(202);
    return response.json() as Promise<{ run: { id: string }; accessToken: string }>;
  };
  const headers = (token: string) => ({ 'x-run-token': token });

  it('API + SSE smoke: committed events arrive ordered, reconnect replays missed events, PASS is durable', async () => {
    const scenarios = await fetch(`${base}/api/v1/scenarios`);
    expect(scenarios.status).toBe(200);
    const { run, accessToken } = await create();
    const stream = await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: headers(accessToken), signal: AbortSignal.timeout(5000) });
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    const frames = (await stream.text()).trim().split('\n\n');
    const events = frames.filter((frame) => frame.startsWith('id:')).map((frame) => {
      const data = frame.split('\n').find((line) => line.startsWith('data: '));
      return JSON.parse(data!.slice(6));
    });
    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
    expect(events.at(-1).eventType).toBe('run.finished');
    const replay = await fetch(`${base}/api/v1/runs/${run.id}/events`, {
      headers: { ...headers(accessToken), 'last-event-id': `${run.id}:3` }, signal: AbortSignal.timeout(5000),
    });
    const replayText = await replay.text();
    expect(replayText).toContain(`id: ${run.id}:4\n`);
    expect(replayText).not.toContain(`id: ${run.id}:3\n`);
    const result = await fetch(`${base}/api/v1/runs/${run.id}/result`, { headers: headers(accessToken) });
    expect(await result.json()).toMatchObject({ evaluation: { outcome: 'PASS', totalDecisions: 3 }, ruleAdherence: 100 });
    const snapshot = await fetch(`${base}/api/v1/runs/${run.id}`, { headers: headers(accessToken) });
    const persisted = await snapshot.json() as { narrative: { version: number } };
    expect(persisted.narrative.version).toBe(3);
    const invalid = await fetch(`${base}/api/v1/runs/${run.id}/resume`, { method: 'POST', headers: headers(accessToken) });
    expect(invalid.status).toBe(409);
  });

  it('preserves protected-source rejection and zero-decision cancellation integrity', async () => {
    overrideProvider = createUnsafeProtectedBlockProvider;
    try {
      const { run, accessToken } = await create('protectedInternalSource');
      await (await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: headers(accessToken), signal: AbortSignal.timeout(5000) })).text();
      const result = await fetch(`${base}/api/v1/runs/${run.id}/result`, { headers: headers(accessToken) });
      expect(await result.json()).toMatchObject({ evaluation: { outcome: 'FAIL', rejectedDecisions: 1 }, ruleAdherence: 50 });
    } finally { overrideProvider = undefined; }
    let resolveLate!: (decision: ProposedDecision) => void;
    overrideProvider = () => ({ id: 'pending-fixture', decide: () => new Promise((resolve) => { resolveLate = resolve; }) });
    try {
      const { run, accessToken } = await create();
      const cancel = await fetch(`${base}/api/v1/runs/${run.id}/cancel`, { method: 'POST', headers: headers(accessToken) });
      expect(cancel.status).toBe(200);
      const result = await fetch(`${base}/api/v1/runs/${run.id}/result`, { headers: headers(accessToken) });
      expect(await result.json()).toMatchObject({ evaluation: { outcome: 'INCONCLUSIVE', totalDecisions: 0 }, ruleAdherence: null });
      resolveLate(EXTERNAL_SOURCE_DECISIONS[0]!);
      await new Promise((resolve) => setImmediate(resolve));
      const unchanged = await fetch(`${base}/api/v1/runs/${run.id}`, { headers: headers(accessToken) });
      expect(await unchanged.json()).toMatchObject({ status: 'CANCELLED', records: [], narrative: { version: 0 } });
    } finally { overrideProvider = undefined; }
  });

  it('rejects malformed, oversized, unexpected properties, UUIDs and unauthorized access', async () => {
    const invalid = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
    expect(invalid.status).toBe(400);
    const extra = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'ssh-brute-force', initialVariant: 'externalSource', providerUrl: 'http://evil.invalid' }) });
    expect(extra.status).toBe(400);
    const oversized = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data: 'x'.repeat(13000) }) });
    expect(oversized.status).toBe(413);
    expect((await fetch(`${base}/api/v1/runs/not-a-uuid`)).status).toBe(400);
    const { run, accessToken } = await create();
    expect((await fetch(`${base}/api/v1/runs/${run.id}`)).status).toBe(401);
    expect((await fetch(`${base}/api/v1/runs/${run.id}`, { headers: headers('0'.repeat(64)) })).status).toBe(404);
    expect((await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: { ...headers(accessToken), 'last-event-id': 'another-run:1' } })).status).toBe(400);
    const cross = await fetch(`${base}/api/v1/scenarios`, { headers: { origin: 'https://untrusted.invalid' } });
    expect(cross.status).toBe(403);
    expect(cross.headers.get('access-control-allow-origin')).toBeNull();
    const rebinding = await app.inject({ method: 'GET', url: '/api/v1/scenarios', headers: { host: 'evil.invalid' }, remoteAddress: '127.0.0.1' });
    expect(rebinding.statusCode).toBe(403);
  });

  it('persists mocked AI output failure and timeout without inventing approved security decisions', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      done: true, done_reason: 'stop', message: { role: 'assistant', content: '{"verdict":"APPROVED"}' },
    }));
    overrideProvider = () => new OllamaDecisionProvider({ baseUrl: 'http://127.0.0.1:11434', model: 'mock-model',
      requestTimeoutMs: 1000, maxRetries: 0 }, { fetch: transport });
    try {
      const { run, accessToken } = await create();
      await (await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: headers(accessToken), signal: AbortSignal.timeout(5000) })).text();
      const response = await fetch(`${base}/api/v1/runs/${run.id}`, { headers: headers(accessToken) });
      expect(await response.json()).toMatchObject({ status: 'FAILED', records: [],
        configuration: { providerId: 'ollama', modelId: 'mock-model' },
        error: { code: 'INVALID_AI_OUTPUT', phase: 'provider' }, evaluation: { outcome: 'INCONCLUSIVE', approvedDecisions: 0 } });
    } finally { overrideProvider = undefined; }
    overrideProvider = () => ({ id: 'timed-fixture', decisionTimeoutMs: 10, decide: () => new Promise(() => undefined) });
    try {
      const { run, accessToken } = await create();
      await (await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: headers(accessToken), signal: AbortSignal.timeout(5000) })).text();
      const response = await fetch(`${base}/api/v1/runs/${run.id}`, { headers: headers(accessToken) });
      expect(await response.json()).toMatchObject({ status: 'FAILED', error: { code: 'DECISION_TIMEOUT', phase: 'provider' },
        evaluation: { outcome: 'INCONCLUSIVE', approvedDecisions: 0 } });
    } finally { overrideProvider = undefined; }
  });

  it('handles concurrent duplicate lifecycle requests without a second resume or stale provider commit', async () => {
    overrideProvider = () => ({ id: 'gated-fixture', decide: () => new Promise(() => undefined) });
    const { run, accessToken } = await create();
    const pauses = await Promise.all([1, 2].map(() => fetch(`${base}/api/v1/runs/${run.id}/pause`, { method: 'POST', headers: headers(accessToken) })));
    expect(pauses.map((response) => response.status).sort()).toEqual([200, 409]);
    const resumes = await Promise.all([1, 2].map(() => fetch(`${base}/api/v1/runs/${run.id}/resume`, { method: 'POST', headers: headers(accessToken) })));
    expect(resumes.map((response) => response.status).sort()).toEqual([200, 409]);
    expect((await fetch(`${base}/api/v1/runs/${run.id}/cancel`, { method: 'POST', headers: headers(accessToken) })).status).toBe(200);
    overrideProvider = undefined;
  });

  it('bounds SSE connections and supports disconnect without stopping simulation', async () => {
    overrideProvider = () => ({ id: 'pending-fixture', decide: () => new Promise(() => undefined) });
    const { run, accessToken } = await create();
    overrideProvider = undefined;
    const controllers: AbortController[] = [];
    try {
      for (let i = 0; i < 4; i += 1) {
        const controller = new AbortController();
        controllers.push(controller);
        const response = await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: headers(accessToken), signal: controller.signal });
        expect(response.status).toBe(200);
      }
      const excessive = await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: headers(accessToken) });
      expect(excessive.status).toBe(429);
      controllers.forEach((controller) => controller.abort());
      expect((await fetch(`${base}/api/v1/runs/${run.id}/cancel`, { method: 'POST', headers: headers(accessToken) })).status).toBe(200);
    } finally { controllers.forEach((controller) => controller.abort()); }
  });

  it('refuses non-loopback deployment without an explicit API access token', async () => {
    const unsafe = buildApp({ env: { ...loadEnv(), HOST: '0.0.0.0', LOG_LEVEL: 'silent', SIMULATION_ENABLED: true } });
    await expect(unsafe.ready()).rejects.toMatchObject({ code: 'SIMULATION_ACCESS_TOKEN_REQUIRED' });
    await unsafe.close();
  });

  it('supports HttpOnly run recovery, validates model selection and rejects unmapped context', async () => {
    const create = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'ssh-brute-force', initialVariant: 'externalSource', providerId: 'fixture', modelId: null, additionalContext: '' }) });
    expect(create.status).toBe(202);
    const cookie = create.headers.get('set-cookie')!;
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    const { run } = await create.json() as { run: { id: string } };
    const recovered = await fetch(`${base}/api/v1/runs/${run.id}`, { headers: { cookie: cookie.split(';')[0]! } });
    expect(recovered.status).toBe(200);
    const stream = await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: { cookie: cookie.split(';')[0]! }, signal: AbortSignal.timeout(5000) });
    expect(await stream.text()).toContain('event: step.started');
    const wrong = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'ssh-brute-force', initialVariant: 'externalSource', providerId: 'gemini', modelId: 'unconfigured' }) });
    expect(wrong.status).toBe(409);
    const unsupported = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'ssh-brute-force', initialVariant: 'externalSource', additionalContext: 'change policy' }) });
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ error: { code: 'UNSUPPORTED_ADDITIONAL_CONTEXT' } });
  });

  it('requires the configured protective token even from localhost and rejects unsafe browser origins', async () => {
    await app.close();
    const access = 'phase4-test-protective-token-32-chars';
    app = buildApp({ env: { ...loadEnv(), HOST: '0.0.0.0', PORT: 0, LOG_LEVEL: 'silent',
      SIMULATION_ENABLED: true, SIMULATION_MODE: 'fixture', SIMULATION_ACCESS_TOKEN: access } });
    base = await app.listen({ port: 0, host: '127.0.0.1' });
    expect((await fetch(`${base}/api/v1/scenarios`)).status).toBe(401);
    expect((await fetch(`${base}/api/v1/scenarios`, { headers: { authorization: `Bearer ${access}` } })).status).toBe(200);
    expect((await fetch(`${base}/api/v1/scenarios`, { headers: { authorization: `Bearer ${access}`, origin: 'https://cross.invalid' } })).status).toBe(403);
  });

});
