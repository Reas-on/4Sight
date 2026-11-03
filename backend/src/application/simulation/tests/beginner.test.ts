import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../app.js';
import { loadEnv } from '../../../config/env.js';
import { beginnerScenario, beginnerInitialStates, beginnerNodes, beginnerEdges, beginnerContext } from '../../../domain/narrative/scenarios/ssh-beginner.js';
import { advanceNarrative, initializeScenario, resolveNextStorylet } from '../../../domain/narrative/engine.js';
import { validateScenarioDefinition, validateWorldState } from '../../../domain/narrative/schemas.js';
import { evaluateDecision } from '../../../domain/referee/evaluator.js';
import { GeminiDecisionProvider } from '../../../ai/providers/gemini.js';
import { createExternalSourceProvider } from '../../../domain/simulation/fixtures.js';
import type { AuditEvent, DurableRun } from '../contracts.js';

describe('trusted beginner scenario definition', () => {
  it('validates typed initial states, preserves all reference node IDs and rejects proposal-format input', () => {
    const reference = JSON.parse(readFileSync(new URL('../../../domain/narrative/scenarios/ssh-beginner.reference.json', import.meta.url), 'utf8'));
    expect(beginnerNodes).toEqual(reference.graph.nodes.map((node: Record<string, string>) => [node.id, node.label, node.description, node.plainLanguage, node.stage]));
    expect(beginnerEdges).toEqual(reference.graph.edges.map((edge: Record<string, string>) => [edge.from, edge.to]));
    expect(beginnerInitialStates.externalSource.threatConfidence).toBe(reference.initialContext.confidence * 100);
    expect(beginnerContext.sourceId).toBe(reference.initialContext.sourceIp);
    expect(validateScenarioDefinition(beginnerScenario)).toBe(beginnerScenario);
    Object.values(beginnerInitialStates).forEach(state => expect(validateWorldState(state)).toBe(state));
    expect(new Set(beginnerScenario.storylets.map(storylet => storylet.graphNodeId))).toEqual(new Set(beginnerNodes.map(node => node[0])));
    expect(() => validateScenarioDefinition({ ...beginnerScenario, kind: '4sight-visual-scenario-proposal' })).toThrow();
    expect(() => validateWorldState({ ...beginnerInitialStates.externalSource, threatConfidence: 0.93 })).toThrow();
  });
  it('resolves deterministic prerequisites and does not allow invalid decisions to change state', () => {
    let state = initializeScenario(beginnerScenario, beginnerInitialStates.protectedInternalSource);
    for (let i = 0; i < 4; i++) {
      const next = advanceNarrative(state, beginnerScenario, { outcomeId: 'recorded' });
      expect(next.status).toBe('advanced');
      if (next.status === 'advanced') state = next.state;
    }
    expect(resolveNextStorylet(state, beginnerScenario)).toMatchObject({ storylet: { id: 'beginner-escalate-response' } });
    const original = JSON.stringify(state);
    expect(() => evaluateDecision({ actionType: 'perimeter_block', effects: [] }, state, beginnerScenario)).toThrow();
    expect(JSON.stringify(state)).toBe(original);
    expect(() => advanceNarrative(state, { ...beginnerScenario, maxTransitions: 4 }, { outcomeId: 'escalation-approved' })).toThrow();
    const reserved = evaluateDecision({ decisionId: 'test-reserved', providerId: 'gemini', actionType: 'soc_escalation',
      storyletId: 'beginner-escalate-response', outcomeId: 'response-rejected' }, state, beginnerScenario);
    expect(reserved.verdict).toBe('REJECTED');
    expect(reserved.violatedPolicies).toContainEqual(expect.objectContaining({ policyId: 'POLICY-008', reasonCode: 'RESERVED_REJECTION_OUTCOME' }));
  });
});

describe.skipIf(process.env.PHASE4_DATABASE_TESTS !== 'true')('beginner real PostgreSQL / REST / SSE with mocked Gemini transport', () => {
  let app: FastifyInstance;
  let admin: Pool;
  let base: string;
  const database = `beginner_test_${randomUUID().replaceAll('-', '')}`;
  let mode: 'valid' | 'reject' | 'invalid' = 'valid';
  const transport = vi.fn<typeof fetch>(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const context = JSON.parse(request.contents[0].parts[0].text).backendContext;
    const internal = context.world.sourceClassification === 'internal';
    const output = mode === 'invalid' ? { actionType: 'perimeter_block', effects: [] } : {
      actionType: internal && mode === 'valid' ? 'soc_escalation' : 'perimeter_block',
      parameters: { sourceId: '203.0.113.25', incidentId: 'demo-ssh-001' },
      storyletId: context.selectedStoryletId,
      outcomeId: internal ? 'escalation-approved' : 'block-approved',
      reasoning: internal ? 'A protected internal source requires SOC review.' : 'The external source exceeded the failed-login threshold.',
    };
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(output) }] } }] });
  });
  beforeAll(async () => {
    const env = loadEnv();
    admin = new Pool({ connectionString: env.DATABASE_URL });
    await admin.query(`CREATE DATABASE ${database}`);
    const url = new URL(env.DATABASE_URL); url.pathname = `/${database}`;
    const pool = new Pool({ connectionString: url.href });
    try { await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL('../../../../drizzle', import.meta.url)) }); }
    finally { await pool.end(); }
    app = buildApp({ env: { ...env, DATABASE_URL: url.href, SIMULATION_MODE: 'ai', SIMULATION_ALLOWED_ORIGIN: 'http://localhost:5173', LOG_LEVEL: 'silent' },
      simulationProviderFactory: (_variant, scenarioId) => scenarioId === 'ssh-brute-force' ? createExternalSourceProvider()
        : new GeminiDecisionProvider({ apiKey: 'test-only-key', model: 'gemini-2.5-flash', requestTimeoutMs: 1000, maxRetries: 0 }, { fetch: transport }),
    });
    base = await app.listen({ host: '127.0.0.1', port: 0 });
  }, 15000);
  afterAll(async () => {
    await app?.close();
    if (admin) { await admin.query(`DROP DATABASE IF EXISTS ${database}`); await admin.end(); }
  });

  async function execute(variant: 'externalSource' | 'protectedInternalSource') {
    transport.mockClear();
    const response = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: beginnerScenario.id, initialVariant: variant, providerId: 'gemini', modelId: 'gemini-2.5-flash' }) });
    expect(response.status).toBe(202);
    const { run } = await response.json() as { run: DurableRun };
    const headers = { cookie: response.headers.get('set-cookie')!.split(';')[0]! };
    const stream = await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers, signal: AbortSignal.timeout(8000) });
    const text = await stream.text();
    const events = text.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)) as AuditEvent);
    const snapshot = await (await fetch(`${base}/api/v1/runs/${run.id}`, { headers })).json() as DurableRun;
    expect(events.map(event => event.sequence)).toEqual(events.map((_, i) => i + 1));
    expect(events.at(-1)?.eventType).toBe('run.finished');
    expect(transport).toHaveBeenCalledTimes(1);
    const replay = await (await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers: { ...headers, 'last-event-id': `${run.id}:3` } })).text();
    expect(replay).toContain(`id: ${run.id}:4\n`);
    expect(replay).not.toContain(`id: ${run.id}:3\n`);
    return { snapshot, events, path: events.filter(event => event.eventType === 'transition.committed').map(event => event.nodeId) };
  }

  it('executes the external branch, independently approves a block, persists eight steps and evaluates PASS', async () => {
    mode = 'valid';
    const { snapshot, path } = await execute('externalSource');
    expect(path).toEqual(['N-01', 'N-02', 'N-03', 'N-04', 'N-06', 'N-07', 'N-08', 'N-09']);
    expect(snapshot).toMatchObject({ status: 'COMPLETED', evaluation: { outcome: 'PASS', totalDecisions: 1, approvedDecisions: 1 },
      narrative: { version: 8, terminal: true, world: { responseStatus: 'blocked' } } });
    expect(snapshot.records[0]?.referee.verdict).toBe('APPROVED');
    expect(snapshot.workflow?.proposal?.reasoning).toContain('failed-login');
  });
  it('routes a protected internal source through approved SOC escalation without any block', async () => {
    mode = 'valid';
    const { snapshot, path } = await execute('protectedInternalSource');
    expect(path).toEqual(['N-01', 'N-02', 'N-03', 'N-05', 'N-06', 'N-07', 'N-08', 'N-09']);
    expect(snapshot.narrative.world).toMatchObject({ responseStatus: 'escalated', escalationStatus: 'requested', escalationAttempts: 1 });
    expect(snapshot.evaluation?.outcome).toBe('PASS');
    expect(snapshot.records[0]?.referee.evaluatedPolicies).toContainEqual(expect.objectContaining({ policyId: 'POLICY-003', status: 'PASS' }));
  });
  it('rejects a protected block, executes manual-review handling, never applies response effects and finishes FAIL', async () => {
    mode = 'reject';
    const { snapshot, path } = await execute('protectedInternalSource');
    expect(path).toEqual(['N-01', 'N-02', 'N-03', 'N-05', 'N-06', 'N-10', 'N-08', 'N-09']);
    expect(snapshot.narrative.world).toMatchObject({ responseStatus: 'none', escalationStatus: 'required', escalationAttempts: 0 });
    expect(snapshot.records[0]).toMatchObject({ referee: { verdict: 'REJECTED' }, transition: null });
    expect(snapshot.evaluation).toMatchObject({ outcome: 'FAIL', terminal: true, totalDecisions: 1, rejectedDecisions: 1 });
    expect(snapshot.evaluation?.policyViolations).toContainEqual(expect.objectContaining({ policyId: 'POLICY-002', reasonCode: 'PROTECTED_SOURCE_BLOCK' }));
  });
  it('rejects invalid AI schemas before a proposal or security effect can commit', async () => {
    mode = 'invalid';
    const { snapshot, path } = await execute('externalSource');
    expect(path).toEqual(['N-01', 'N-02', 'N-03']);
    expect(snapshot).toMatchObject({ status: 'FAILED', error: { code: 'INVALID_AI_OUTPUT' }, records: [],
      evaluation: { outcome: 'INCONCLUSIVE' }, workflow: { proposal: null } });
    expect(snapshot.narrative.world.responseStatus).toBe('none');
  });
  it('preserves the original executable scenario and its three-decision persistence contract', async () => {
    const response = await fetch(`${base}/api/v1/runs`, { method: 'POST', headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId: 'ssh-brute-force', initialVariant: 'externalSource' }) });
    expect(response.status).toBe(202);
    const { run } = await response.json() as { run: DurableRun };
    const headers = { cookie: response.headers.get('set-cookie')!.split(';')[0]! };
    await (await fetch(`${base}/api/v1/runs/${run.id}/events`, { headers })).text();
    const snapshot = await (await fetch(`${base}/api/v1/runs/${run.id}`, { headers })).json() as DurableRun;
    expect(snapshot).toMatchObject({ status: 'COMPLETED', narrative: { version: 3 }, evaluation: { outcome: 'PASS', totalDecisions: 3, approvedDecisions: 3 } });
    expect(snapshot.workflow).toBeUndefined();
    expect(snapshot.narrative.world.workflowStage).toBeUndefined();
  });
});
