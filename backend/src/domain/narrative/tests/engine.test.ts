import { describe, expect, it } from 'vitest';
import {
  advanceNarrative,
  applyStoryletOutcome,
  getEligibleStorylets,
  initializeScenario,
  resolveNextStorylet,
} from '../engine.js';
import {
  NarrativeStepLimitError,
  NarrativeTransitionError,
  NarrativeValidationError,
} from '../errors.js';
import { validateScenarioDefinition } from '../schemas.js';
import {
  SSH_BRUTE_FORCE_SCENARIO_ID,
  sshBruteForceInitialStates,
  sshBruteForceScenario,
} from '../scenarios/ssh-brute-force.js';
import type {
  AdvanceNarrativeApplied,
  AdvanceNarrativeResult,
  Condition,
  Effect,
  NarrativeState,
  ScenarioDefinition,
  StoryletDefinition,
  TransitionRecord,
  WorldState,
} from '../types.js';

function expectApplied(result: AdvanceNarrativeResult): AdvanceNarrativeApplied {
  if (result.status !== 'advanced') {
    throw new Error(`Expected advanced result, received ${result.status}`);
  }
  return result;
}

function makeStorylet(
  id: string,
  priority: number,
  oneShot = true,
): StoryletDefinition {
  return {
    id,
    description: `Storylet ${id}`,
    priority,
    oneShot,
    terminal: false,
    preconditions: {
      op: 'equals',
      field: 'sourceClassification',
      value: 'external',
    },
    action: {
      id: 'check-source',
      description: 'Check the source classification.',
    },
    outcomes: [
      {
        id: 'done',
        description: 'Record the check.',
        effects: [{ type: 'set', field: 'threatConfidence', value: 70 }],
      },
    ],
  };
}

const baseScenario: ScenarioDefinition = {
  id: 'test-scenario',
  title: 'Test Scenario',
  description: 'Fixture scenario for narrative engine tests.',
  technique: 'T1110.001',
  maxTransitions: 5,
  storylets: [makeStorylet('valid-storylet', 10)],
};

const external = sshBruteForceInitialStates.externalSource;
const protectedInternal = sshBruteForceInitialStates.protectedInternalSource;

function triaged(state: NarrativeState): NarrativeState {
  return expectApplied(
    advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'confirm-threat' }),
  ).state;
}

function executeExternalScenario(): {
  state: NarrativeState;
  records: readonly TransitionRecord[];
} {
  let state = initializeScenario(sshBruteForceScenario, external);
  const records: TransitionRecord[] = [];

  for (const outcomeId of ['confirm-threat', 'block-applied', 'incident-resolved']) {
    const applied = expectApplied(
      advanceNarrative(state, sshBruteForceScenario, { outcomeId }),
    );
    state = applied.state;
    records.push(applied.record);
  }

  return { state, records };
}

describe('initializeScenario', () => {
  it('initializes a validated narrative state at version zero', () => {
    const state = initializeScenario(sshBruteForceScenario, external);

    expect(state.scenarioId).toBe(SSH_BRUTE_FORCE_SCENARIO_ID);
    expect(state.version).toBe(0);
    expect(state.step).toBe(0);
    expect(state.completedStorylets).toEqual([]);
    expect(state.currentStoryletId).toBeNull();
    expect(state.terminal).toBe(false);
    expect(state.world).toEqual(external);
  });

  it('rejects invalid initial world state', () => {
    const invalid = { ...external, threatConfidence: 101 } as unknown as WorldState;

    expect(() => initializeScenario(sshBruteForceScenario, invalid)).toThrow(
      NarrativeValidationError,
    );
  });
});

describe('deterministic storylet selection', () => {
  it('orders by priority and then stable identifier', () => {
    const selectionScenario: ScenarioDefinition = {
      ...baseScenario,
      id: 'selection-scenario',
      storylets: [
        makeStorylet('beta', 100),
        makeStorylet('alpha', 100),
        makeStorylet('critical', 200),
      ],
    };
    const state = initializeScenario(selectionScenario, external);
    const resolution = resolveNextStorylet(state, selectionScenario);

    expect(resolution.status).toBe('eligible');
    if (resolution.status !== 'eligible') return;
    expect(resolution.storylet.id).toBe('critical');
    expect(resolution.eligibleStoryletIds).toEqual(['critical', 'alpha', 'beta']);
  });
});

describe('SSH brute-force external source branch', () => {
  it('offers the block response and reaches the terminal state', () => {
    let state = initializeScenario(sshBruteForceScenario, external);

    expect(getEligibleStorylets(state, sshBruteForceScenario).map((storylet) => storylet.id)).toEqual([
      'triage-ssh-brute-force',
    ]);

    const triage = expectApplied(
      advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'confirm-threat' }),
    );
    expect(triage.record).toMatchObject({
      sequence: 1,
      storyletId: 'triage-ssh-brute-force',
      outcomeId: 'confirm-threat',
      previousStateVersion: 0,
      nextStateVersion: 1,
      graphNodeId: 'N-01',
    });
    expect(triage.state.world.incidentStatus).toBe('triaged');
    state = triage.state;

    expect(getEligibleStorylets(state, sshBruteForceScenario).map((storylet) => storylet.id)).toEqual([
      'block-external-source',
    ]);

    const block = expectApplied(
      advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'block-applied' }),
    );
    expect(block.state.world.responseStatus).toBe('blocked');
    expect(block.state.world.incidentStatus).toBe('contained');
    expect(block.state.world.completedEvents).toContain('event:perimeter-block-applied');
    state = block.state;

    expect(getEligibleStorylets(state, sshBruteForceScenario).map((storylet) => storylet.id)).toEqual([
      'close-ssh-incident',
    ]);

    const closed = expectApplied(
      advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'incident-resolved' }),
    );
    expect(closed.state.world.incidentStatus).toBe('resolved');
    expect(closed.state.world.responseStatus).toBe('resolved');
    expect(closed.state.terminal).toBe(true);
    expect(closed.record.sequence).toBe(3);

    expect(resolveNextStorylet(closed.state, sshBruteForceScenario).status).toBe('terminal');
    expect(
      advanceNarrative(closed.state, sshBruteForceScenario, { outcomeId: 'incident-resolved' })
        .status,
    ).toBe('terminal');
  });
});

describe('SSH brute-force protected internal source branch', () => {
  it('does not offer a direct perimeter block for protected internal sources', () => {
    const state = triaged(initializeScenario(sshBruteForceScenario, protectedInternal));
    const eligible = getEligibleStorylets(state, sshBruteForceScenario).map(
      (storylet) => storylet.id,
    );

    expect(eligible).toContain('escalate-protected-source');
    expect(eligible).not.toContain('block-external-source');
    expect(() =>
      applyStoryletOutcome(
        state,
        sshBruteForceScenario,
        'block-external-source',
        'block-applied',
      ),
    ).toThrow(/Preconditions/);
  });

  it('applies SOC escalation, enables follow-up, and reaches terminal state', () => {
    let state = triaged(initializeScenario(sshBruteForceScenario, protectedInternal));

    const escalation = expectApplied(
      advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'soc-escalated' }),
    );
    expect(escalation.state.world.escalationStatus).toBe('requested');
    expect(escalation.state.world.incidentStatus).toBe('escalated');
    expect(escalation.state.world.escalationAttempts).toBe(1);
    state = escalation.state;

    expect(getEligibleStorylets(state, sshBruteForceScenario).map((storylet) => storylet.id)).toEqual([
      'soc-escalation-follow-up',
    ]);

    const followUp = expectApplied(
      advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'soc-contained' }),
    );
    expect(followUp.state.world.escalationStatus).toBe('accepted');
    expect(followUp.state.world.responseStatus).toBe('isolated');
    expect(followUp.state.world.incidentStatus).toBe('contained');
    state = followUp.state;

    const closed = expectApplied(
      advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'incident-resolved' }),
    );
    expect(closed.state.terminal).toBe(true);
    expect(closed.state.world.incidentStatus).toBe('resolved');
  });
});

describe('transition safety', () => {
  it('rejects a storylet that is not currently selected without mutating state', () => {
    const state = initializeScenario(sshBruteForceScenario, external);
    const snapshot = JSON.stringify(state);

    expect(() =>
      advanceNarrative(state, sshBruteForceScenario, {
        storyletId: 'block-external-source',
        outcomeId: 'block-applied',
      }),
    ).toThrow(NarrativeTransitionError);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('rejects unknown outcomes without mutating state', () => {
    const state = initializeScenario(sshBruteForceScenario, external);
    const snapshot = JSON.stringify(state);

    expect(() =>
      advanceNarrative(state, sshBruteForceScenario, { outcomeId: 'unknown-outcome' }),
    ).toThrow(/does not define outcome/);
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('rejects reuse of a consumed one-shot storylet', () => {
    const state = triaged(initializeScenario(sshBruteForceScenario, external));

    expect(() =>
      applyStoryletOutcome(
        state,
        sshBruteForceScenario,
        'triage-ssh-brute-force',
        'confirm-threat',
      ),
    ).toThrow(/already been completed/);
  });

  it('returns a structured dead-end instead of silently succeeding', () => {
    const deadEndScenario: ScenarioDefinition = {
      ...baseScenario,
      id: 'dead-end-scenario',
      storylets: [
        {
          ...makeStorylet('never-eligible', 1),
          preconditions: {
            op: 'equals',
            field: 'sourceClassification',
            value: 'internal',
          },
        },
      ],
    };
    const state = initializeScenario(deadEndScenario, external);

    const resolution = resolveNextStorylet(state, deadEndScenario);
    expect(resolution.status).toBe('dead_end');
    if (resolution.status === 'dead_end') {
      expect(resolution.error.code).toBe('NARRATIVE_DEAD_END');
    }

    const result = advanceNarrative(state, deadEndScenario, { outcomeId: 'done' });
    expect(result.status).toBe('dead_end');
    if (result.status === 'dead_end') {
      expect(result.error.code).toBe('NARRATIVE_DEAD_END');
    }
    expect(state.terminal).toBe(false);
  });
});

describe('loop protection and determinism', () => {
  it('raises a structured step-limit error instead of succeeding', () => {
    const loopScenario: ScenarioDefinition = {
      ...baseScenario,
      id: 'loop-scenario',
      maxTransitions: 2,
      storylets: [makeStorylet('loop-storylet', 1, false)],
    };
    let state = initializeScenario(loopScenario, external);

    state = expectApplied(
      advanceNarrative(state, loopScenario, { outcomeId: 'done' }),
    ).state;
    state = expectApplied(
      advanceNarrative(state, loopScenario, { outcomeId: 'done' }),
    ).state;
    expect(state.step).toBe(2);

    expect(() => advanceNarrative(state, loopScenario, { outcomeId: 'done' })).toThrow(
      NarrativeStepLimitError,
    );
    expect(state.terminal).toBe(false);
  });

  it('produces identical states and records for identical inputs', () => {
    const first = executeExternalScenario();
    const second = executeExternalScenario();

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.records.map((record) => record.sequence)).toEqual([1, 2, 3]);
    expect(first.state.terminal).toBe(true);
  });
});

describe('scenario definition validation', () => {
  it.each<[string, unknown]>([
    [
      'duplicate storylet identifiers',
      {
        ...baseScenario,
        storylets: [makeStorylet('duplicate-id', 1), makeStorylet('duplicate-id', 2)],
      },
    ],
    [
      'invalid condition field references',
      {
        ...baseScenario,
        storylets: [
          {
            ...makeStorylet('invalid-field', 1),
            preconditions: {
              op: 'equals',
              field: 'missingField',
              value: 'external',
            } as unknown as Condition,
          },
        ],
      },
    ],
    [
      'unsupported condition operators',
      {
        ...baseScenario,
        storylets: [
          {
            ...makeStorylet('invalid-operator', 1),
            preconditions: {
              op: 'contains',
              field: 'sourceClassification',
              value: 'external',
            } as unknown as Condition,
          },
        ],
      },
    ],
    [
      'invalid effect values',
      {
        ...baseScenario,
        storylets: [
          {
            ...makeStorylet('invalid-effect', 1),
            outcomes: [
              {
                id: 'done',
                description: 'Invalid effect outcome.',
                effects: [
                  {
                    type: 'set',
                    field: 'incidentStatus',
                    value: 'invalid-status',
                  } as unknown as Effect,
                ],
              },
            ],
          },
        ],
      },
    ],
    [
      'missing outcome definitions',
      {
        ...baseScenario,
        storylets: [{ ...makeStorylet('missing-outcomes', 1), outcomes: [] }],
      },
    ],
    ['malformed scenario definitions', { ...baseScenario, storylets: 'not-an-array' }],
  ])('rejects %s', (_label, definition) => {
    expect(() => validateScenarioDefinition(definition)).toThrow(NarrativeValidationError);
  });
});
