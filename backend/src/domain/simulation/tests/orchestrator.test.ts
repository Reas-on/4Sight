import { describe, expect, it } from 'vitest';
import {
  sshBruteForceInitialStates,
  sshBruteForceScenario,
} from '../../narrative/scenarios/ssh-brute-force.js';
import type { ScenarioDefinition } from '../../narrative/types.js';
import type { ProposedDecision, RefereePolicyFinding } from '../../referee/types.js';
import {
  SimulationConfigurationError,
  SimulationLifecycleError,
  SimulationNotFoundError,
} from '../errors.js';
import {
  EXTERNAL_SOURCE_DECISIONS,
  createExternalSourceProvider,
  createProtectedInternalProvider,
  createUnsafeProtectedBlockProvider,
} from '../fixtures.js';
import { InMemorySimulationOrchestrator } from '../orchestrator.js';
import type {
  DecisionContext,
  DecisionProvider,
  SimulationRunConfig,
} from '../types.js';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function externalDecision(sequence: number): ProposedDecision {
  const decision = EXTERNAL_SOURCE_DECISIONS[sequence - 1];
  if (decision === undefined) throw new Error(`Missing fixture decision ${sequence}`);
  return decision;
}

function externalConfig(overrides: Partial<SimulationRunConfig> = {}): SimulationRunConfig {
  return {
    scenario: sshBruteForceScenario,
    initialState: sshBruteForceInitialStates.externalSource,
    provider: createExternalSourceProvider(),
    ...overrides,
  };
}

function orchestrator(): InMemorySimulationOrchestrator {
  let time = Date.parse('2026-11-03T10:00:00.000Z');
  let id = 0;
  return new InMemorySimulationOrchestrator({
    clock: { now: () => new Date(time++) },
    runIdFactory: () => `run-${++id}`,
  });
}

describe('simulation execution and evaluation', () => {
  it('Case A: completes the external source path with a measured PASS', async () => {
    const engine = orchestrator();
    const run = engine.createRun(externalConfig());

    expect(run.status).toBe('CREATED');
    expect(run.evaluation).toBeNull();
    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('COMPLETED');
    expect(result.narrative.terminal).toBe(true);
    expect(result.narrative.world.incidentStatus).toBe('resolved');
    expect(result.records.map((record) => record.decision.actionType)).toEqual([
      'triage_alert', 'perimeter_block', 'incident_closure',
    ]);
    expect(result.records.map((record) => record.transition?.nextStateVersion)).toEqual([
      1, 2, 3,
    ]);
    expect(result.evaluation).toMatchObject({
      outcome: 'PASS',
      totalDecisions: 3,
      approvedDecisions: 3,
      rejectedDecisions: 0,
      policyViolations: [],
      terminal: true,
      finalStateVersion: 3,
    });
    expect(engine.getRunRecords(run.runId)).toEqual(result.records);
    expect(engine.getRunEvaluation(run.runId)).toBe(result.evaluation);
    expect(run.narrative.version).toBe(0);
    expect(run.records).toEqual([]);
  });

  it('Case B: escalates and safely contains a protected internal source', async () => {
    const engine = orchestrator();
    const run = engine.createRun(externalConfig({
      initialState: sshBruteForceInitialStates.protectedInternalSource,
      provider: createProtectedInternalProvider(),
    }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('COMPLETED');
    expect(result.evaluation?.outcome).toBe('PASS');
    expect(result.evaluation?.totalDecisions).toBe(4);
    expect(result.narrative.world).toMatchObject({
      sourceClassification: 'internal',
      sourceProtected: true,
      assetProtected: true,
      escalationStatus: 'accepted',
      escalationAttempts: 1,
      incidentStatus: 'resolved',
    });
    expect(result.records.map((record) => record.decision.actionType)).toEqual([
      'triage_alert', 'soc_escalation', 'soc_acknowledgement', 'incident_closure',
    ]);
    expect(result.narrative.world.completedEvents).toContain('event:soc-containment-applied');
    expect(result.narrative.world.completedEvents).not.toContain('event:perimeter-block-applied');
  });

  it('Case C: records a protected-source block rejection without applying its effects', async () => {
    const engine = orchestrator();
    const run = engine.createRun(externalConfig({
      initialState: sshBruteForceInitialStates.protectedInternalSource,
      provider: createUnsafeProtectedBlockProvider(),
    }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('COMPLETED');
    expect(result.evaluation).toMatchObject({
      outcome: 'FAIL',
      reasonCode: 'POLICY_REJECTION',
      totalDecisions: 2,
      approvedDecisions: 1,
      rejectedDecisions: 1,
      terminal: false,
    });
    expect(result.evaluation?.policyViolations).toEqual(expect.arrayContaining([
      expect.objectContaining({ policyId: 'POLICY-002', reasonCode: 'PROTECTED_SOURCE_BLOCK' }),
    ]));
    expect(result.records[1]?.transition).toBeNull();
    expect(result.narrative.version).toBe(1);
    expect(result.narrative.world.incidentStatus).toBe('triaged');
    expect(result.narrative.world.responseStatus).toBe('none');
    expect(result.narrative.world.completedEvents).toEqual(['event:ssh-brute-force-confirmed']);
  });

  it('Case D: fails malformed provider output with an INCONCLUSIVE evaluation', async () => {
    const engine = orchestrator();
    const provider: DecisionProvider = {
      id: 'malformed-provider',
      decide: () => ({ actionType: 'unrecognized' } as unknown as ProposedDecision),
    };
    const run = engine.createRun(externalConfig({ provider }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('FAILED');
    expect(result.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', reasonCode: 'INVALID_DECISION' });
    expect(result.error?.code).toBe('INVALID_DECISION');
    expect(result.narrative.version).toBe(0);
    expect(result.records).toEqual([]);
  });

  it('Case E: reports provider failure without inventing a referee verdict', async () => {
    const engine = orchestrator();
    const provider: DecisionProvider = {
      id: 'failing-provider',
      decide: () => { throw new Error('fixture provider failure'); },
    };
    const run = engine.createRun(externalConfig({ provider }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('FAILED');
    expect(result.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', reasonCode: 'PROVIDER_ERROR' });
    expect(result.error).toMatchObject({ phase: 'provider', message: 'fixture provider failure' });
    expect(result.records).toEqual([]);
  });

  it('times out and ignores a late provider response', async () => {
    const engine = orchestrator();
    const response = deferred<ProposedDecision>();
    let signal: AbortSignal | undefined;
    const provider: DecisionProvider = {
      id: 'timeout-provider',
      decide: (context) => { signal = context.signal; return response.promise; },
    };
    const run = engine.createRun(externalConfig({ provider, decisionTimeoutMs: 10 }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('DECISION_TIMEOUT');
    expect(result.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', reasonCode: 'DECISION_TIMEOUT' });
    expect(signal?.aborted).toBe(true);
    response.resolve(externalDecision(1));
    await response.promise;
    await Promise.resolve();
    expect(engine.getRunSnapshot(run.runId)).toEqual(result);
  });

  it('reports a narrative dead end before requesting a decision', async () => {
    const engine = orchestrator();
    let requested = false;
    const provider: DecisionProvider = {
      id: 'unused-provider',
      decide: () => { requested = true; return externalDecision(1); },
    };
    const run = engine.createRun(externalConfig({
      initialState: { ...sshBruteForceInitialStates.externalSource, threatConfidence: 30 },
      provider,
    }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('NARRATIVE_DEAD_END');
    expect(result.evaluation?.outcome).toBe('INCONCLUSIVE');
    expect(requested).toBe(false);
    expect(result.narrative.terminal).toBe(false);
  });

  it('enforces the decision limit without claiming successful completion', async () => {
    const engine = orchestrator();
    const run = engine.createRun(externalConfig({ maxDecisions: 1 }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('FAILED');
    expect(result.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', reasonCode: 'DECISION_LIMIT' });
    expect(result.narrative.version).toBe(1);
    expect(result.records).toHaveLength(1);
  });

  it('isolates concurrent runs even when they share a scripted provider', async () => {
    const engine = orchestrator();
    const provider = createExternalSourceProvider();
    const first = engine.createRun(externalConfig({ provider }));
    const second = engine.createRun(externalConfig({ provider }));
    const protectedRun = engine.createRun(externalConfig({
      provider: createProtectedInternalProvider(),
      initialState: sshBruteForceInitialStates.protectedInternalSource,
    }));

    const results = await Promise.all([
      engine.startRun(first.runId),
      engine.startRun(second.runId),
      engine.startRun(protectedRun.runId),
    ]);

    expect(new Set(results.map((result) => result.runId)).size).toBe(3);
    expect(results.map((result) => result.evaluation?.outcome)).toEqual(['PASS', 'PASS', 'PASS']);
    expect(results.map((result) => result.narrative.version)).toEqual([3, 3, 4]);
    expect(results[0]?.narrative).not.toBe(results[1]?.narrative);
    expect(engine.listRuns()).toHaveLength(3);
  });

  it('replays identical inputs, IDs, and clocks into identical records and evaluations', async () => {
    const first = orchestrator();
    const second = orchestrator();
    const a = first.createRun(externalConfig());
    const b = second.createRun(externalConfig());

    const resultA = await first.startRun(a.runId);
    const resultB = await second.startRun(b.runId);

    expect(JSON.stringify(resultA)).toBe(JSON.stringify(resultB));
  });

  it('snapshots scenario data and freezes the provider context', async () => {
    const engine = orchestrator();
    const scenario = structuredClone(sshBruteForceScenario);
    const provider: DecisionProvider = {
      id: 'immutable-context',
      decide: (context) => {
        expect(Object.isFrozen(context.state.world)).toBe(true);
        expect(Object.isFrozen(context.scenario.storylets)).toBe(true);
        expect(() => Object.assign(context.selectedStorylet.action, { id: 'close-incident' })).toThrow(TypeError);
        expect(() => Object.assign(context.selectedStorylet.outcomes[0]?.effects[0] ?? {}, { value: 'resolved' })).toThrow(TypeError);
        expect(() => Object.assign(context.records, { 0: 'overwritten' })).toThrow(TypeError);
        return externalDecision(context.sequence);
      },
    };
    const run = engine.createRun(externalConfig({ scenario, provider }));
    Object.assign(scenario.storylets[0]?.action ?? {}, { id: 'changed-by-caller' });
    expect(Object.isFrozen(scenario)).toBe(false);

    const result = await engine.startRun(run.runId);

    expect(result.evaluation?.outcome).toBe('PASS');
    expect(Object.isFrozen(result.records[0]?.decision.parameters)).toBe(true);
    expect(Object.isFrozen(result.evaluation?.policyViolations)).toBe(true);
  });

  it('snapshots policy definitions and versions when creating a run', async () => {
    const engine = orchestrator();
    const policy = {
      policyId: 'custom-deny', description: 'A denying fixture.',
      evaluate: (): RefereePolicyFinding => ({ status: 'FAIL', reasonCode: 'DENIED', message: 'Denied.' }),
    };
    const policySet = { id: 'snapshot-policy', version: 'original', policies: [policy] };
    const run = engine.createRun(externalConfig({ policySet }));
    policy.evaluate = () => ({ status: 'PASS', reasonCode: 'ALLOWED', message: 'Allowed.' });
    policySet.version = 'changed';
    policySet.policies.length = 0;

    const result = await engine.startRun(run.runId);

    expect(result.evaluation?.outcome).toBe('FAIL');
    expect(result.evaluation?.policySetVersion).toBe('original');
    expect(result.records[0]?.referee.violatedPolicies[0]?.policyId).toBe('custom-deny');
  });

  it('records an approved decision but rolls back a failed narrative effect', async () => {
    const engine = orchestrator();
    const run = engine.createRun(externalConfig({
      initialState: { ...sshBruteForceInitialStates.protectedInternalSource, escalationAttempts: 10 },
      provider: createProtectedInternalProvider(),
    }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('FAILED');
    expect(result.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', reasonCode: 'NARRATIVE_ERROR' });
    expect(result.error?.code).toBe('INVALID_EFFECT_VALUE');
    expect(result.records[1]?.referee.verdict).toBe('APPROVED');
    expect(result.records[1]?.transition).toBeNull();
    expect(result.narrative.version).toBe(1);
    expect(result.narrative.world).toMatchObject({
      escalationAttempts: 10, incidentStatus: 'triaged', escalationStatus: 'required',
    });
  });

  it('returns an inconclusive failure when referee policy code throws', async () => {
    const engine = orchestrator();
    const run = engine.createRun(externalConfig({ policySet: {
      id: 'broken', version: 'test', policies: [{
        policyId: 'throwing', description: 'Throwing policy.',
        evaluate: () => { throw new Error('fixture policy failure'); },
      }],
    } }));

    const result = await engine.startRun(run.runId);

    expect(result.status).toBe('FAILED');
    expect(result.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', reasonCode: 'REFEREE_ERROR' });
    expect(result.records).toEqual([]);
    expect(result.narrative.version).toBe(0);
  });
});

describe('simulation lifecycle and in-flight decisions', () => {
  it('discards an in-flight response on pause and requests the same sequence on resume', async () => {
    const engine = orchestrator();
    const entered = deferred<void>();
    const resumed = deferred<void>();
    const stale = deferred<ProposedDecision>();
    const fresh = deferred<ProposedDecision>();
    const requests: DecisionContext[] = [];
    const provider: DecisionProvider = {
      id: 'gated-provider',
      decide: (context) => {
        requests.push(context);
        if (requests.length === 1) { entered.resolve(); return stale.promise; }
        if (requests.length === 2) { resumed.resolve(); return fresh.promise; }
        return externalDecision(context.sequence);
      },
    };
    const run = engine.createRun(externalConfig({ provider }));
    const execution = engine.startRun(run.runId);
    await entered.promise;

    const paused = engine.pauseRun(run.runId);
    expect(paused.status).toBe('PAUSED');
    expect(paused.evaluation).toBeNull();
    expect((await execution).status).toBe('PAUSED');
    const continuation = engine.resumeRun(run.runId);
    await resumed.promise;

    stale.resolve(externalDecision(2));
    await stale.promise;
    await Promise.resolve();
    expect(engine.getRunRecords(run.runId)).toEqual([]);
    fresh.resolve(externalDecision(1));
    const result = await continuation;

    expect(requests.map((context) => context.sequence)).toEqual([1, 1, 2, 3]);
    expect(requests[0]?.signal.aborted).toBe(true);
    expect(result.evaluation?.outcome).toBe('PASS');
    expect(result.records.map((record) => record.sequence)).toEqual([1, 2, 3]);
  });

  it('cancels an in-flight run and prevents later state or record changes', async () => {
    const engine = orchestrator();
    const entered = deferred<void>();
    const response = deferred<ProposedDecision>();
    const provider: DecisionProvider = {
      id: 'cancel-provider',
      decide: () => { entered.resolve(); return response.promise; },
    };
    const run = engine.createRun(externalConfig({ provider }));
    const execution = engine.startRun(run.runId);
    await entered.promise;

    const cancelled = engine.cancelRun(run.runId);
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.evaluation).toMatchObject({ outcome: 'INCONCLUSIVE', reasonCode: 'RUN_CANCELLED' });
    expect(await execution).toEqual(cancelled);
    response.resolve(externalDecision(1));
    await response.promise;
    await Promise.resolve();
    expect(engine.getRunSnapshot(run.runId)).toEqual(cancelled);
  });

  it('supports cancellation before start and after pause', async () => {
    const engine = orchestrator();
    const created = engine.createRun(externalConfig());
    expect(engine.cancelRun(created.runId).status).toBe('CANCELLED');

    const run = engine.createRun(externalConfig());
    const execution = engine.startRun(run.runId);
    engine.pauseRun(run.runId);
    const cancelled = engine.cancelRun(run.runId);
    expect((await execution).status).toBe('CANCELLED');
    expect(cancelled.narrative.version).toBe(0);
    expect(cancelled.evaluation?.outcome).toBe('INCONCLUSIVE');
  });

  it('rejects invalid lifecycle transitions and unknown run IDs', async () => {
    const engine = orchestrator();
    const run = engine.createRun(externalConfig());
    expect(() => engine.pauseRun(run.runId)).toThrow(SimulationLifecycleError);
    expect(() => engine.resumeRun(run.runId)).toThrow(SimulationLifecycleError);
    expect(() => engine.getRunSnapshot('missing')).toThrow(SimulationNotFoundError);
    await engine.startRun(run.runId);
    expect(() => engine.startRun(run.runId)).toThrow(SimulationLifecycleError);
    expect(() => engine.cancelRun(run.runId)).toThrow(SimulationLifecycleError);
  });

  it('validates run configuration and rejects duplicate run IDs', () => {
    const engine = orchestrator();
    engine.createRun(externalConfig({ runId: 'duplicate' }));
    expect(() => engine.createRun(externalConfig({ runId: 'duplicate' }))).toThrow(SimulationConfigurationError);
    expect(() => engine.createRun(externalConfig({ maxDecisions: 0 }))).toThrow(SimulationConfigurationError);
    expect(() => engine.createRun(externalConfig({ decisionTimeoutMs: -1 }))).toThrow(SimulationConfigurationError);
    expect(() => engine.createRun(externalConfig({
      scenario: { ...sshBruteForceScenario, storylets: [] } as ScenarioDefinition,
    }))).toThrow(SimulationConfigurationError);
  });
});
