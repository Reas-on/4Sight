import { describe, expect, it } from 'vitest';
import {
  advanceNarrative,
  initializeScenario,
} from '../../narrative/engine.js';
import {
  sshBruteForceInitialStates,
  sshBruteForceScenario,
} from '../../narrative/scenarios/ssh-brute-force.js';
import type {
  NarrativeState,
  WorldState,
} from '../../narrative/types.js';
import {
  EXTERNAL_SOURCE_DECISIONS,
  PROTECTED_INTERNAL_DECISIONS,
  UNSAFE_PROTECTED_BLOCK_DECISIONS,
} from '../../simulation/fixtures.js';
import { RefereeEvaluationError, RefereeValidationError } from '../errors.js';
import { evaluateDecision } from '../evaluator.js';
import { validateRefereePolicySet } from '../schemas.js';
import type { ProposedDecision, RefereePolicySet } from '../types.js';

function afterTriage(initialWorld: WorldState): NarrativeState {
  const result = advanceNarrative(
    initializeScenario(sshBruteForceScenario, initialWorld),
    sshBruteForceScenario,
    { outcomeId: 'confirm-threat' },
  );
  if (result.status !== 'advanced') {
    throw new Error(`Expected triage transition, received ${result.status}`);
  }
  return result.state;
}

function decisionAt(
  decisions: readonly ProposedDecision[],
  index: number,
): ProposedDecision {
  const decision = decisions[index];
  if (decision === undefined) throw new Error(`Missing fixture decision ${index}`);
  return decision;
}

describe('referee policy decisions', () => {
  it('approves an external perimeter block after triage', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const decision = decisionAt(EXTERNAL_SOURCE_DECISIONS, 1);

    const result = evaluateDecision(decision, state, sshBruteForceScenario);

    expect(result.verdict).toBe('APPROVED');
    expect(result.approved).toBe(true);
    expect(result.reasonCode).toBe('POLICY_APPROVED');
    expect(result.violatedPolicies).toEqual([]);
    expect(result.evaluatedPolicies.map((policy) => policy.policyId)).toEqual([
      'POLICY-001',
      'POLICY-002',
      'POLICY-003',
      'POLICY-004',
      'POLICY-005',
      'POLICY-006',
      'POLICY-007',
      'POLICY-008',
    ]);
  });

  it('rejects a direct block against a protected internal source', () => {
    const state = afterTriage(sshBruteForceInitialStates.protectedInternalSource);
    const decision = decisionAt(UNSAFE_PROTECTED_BLOCK_DECISIONS, 1);
    const snapshot = JSON.stringify(state);

    const result = evaluateDecision(decision, state, sshBruteForceScenario);

    expect(result.verdict).toBe('REJECTED');
    expect(result.reasonCode).toBe('EXTERNAL_BLOCK_STORYLET_REQUIRED');
    expect(result.violatedPolicies.map((policy) => policy.policyId)).toEqual([
      'POLICY-001',
      'POLICY-002',
      'POLICY-008',
    ]);
    expect(result.violatedPolicies.map((policy) => policy.reasonCode)).toContain(
      'PROTECTED_SOURCE_BLOCK',
    );
    expect(JSON.stringify(state)).toBe(snapshot);
  });

  it('approves SOC escalation for a protected internal source', () => {
    const state = afterTriage(sshBruteForceInitialStates.protectedInternalSource);
    const decision = decisionAt(PROTECTED_INTERNAL_DECISIONS, 1);

    const result = evaluateDecision(decision, state, sshBruteForceScenario);

    expect(result.verdict).toBe('APPROVED');
    expect(
      result.evaluatedPolicies.find((policy) => policy.policyId === 'POLICY-003')
        ?.status,
    ).toBe('PASS');
  });

  it('rejects an action that is not bound to the selected storylet', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const decision: ProposedDecision = {
      ...decisionAt(EXTERNAL_SOURCE_DECISIONS, 1),
      decisionId: 'mismatched-action',
      actionType: 'soc_escalation',
    };

    const result = evaluateDecision(decision, state, sshBruteForceScenario);

    expect(result.verdict).toBe('REJECTED');
    expect(result.violatedPolicies.map((policy) => policy.reasonCode)).toContain(
      'ACTION_BINDING_MISMATCH',
    );
  });

  it('rejects an outcome that is not defined by the selected storylet', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const decision: ProposedDecision = {
      ...decisionAt(EXTERNAL_SOURCE_DECISIONS, 1),
      outcomeId: 'unknown-outcome',
    };

    const result = evaluateDecision(decision, state, sshBruteForceScenario);

    expect(result.verdict).toBe('REJECTED');
    expect(result.violatedPolicies.map((policy) => policy.reasonCode)).toContain(
      'UNKNOWN_OUTCOME',
    );
  });

  it('rejects any decision after the narrative reaches a terminal state', () => {
    let state = afterTriage(sshBruteForceInitialStates.externalSource);
    const block = advanceNarrative(state, sshBruteForceScenario, {
      outcomeId: 'block-applied',
    });
    if (block.status !== 'advanced') throw new Error('Expected block transition');
    state = block.state;
    const close = advanceNarrative(state, sshBruteForceScenario, {
      outcomeId: 'incident-resolved',
    });
    if (close.status !== 'advanced') throw new Error('Expected close transition');

    const result = evaluateDecision(
      decisionAt(EXTERNAL_SOURCE_DECISIONS, 2),
      close.state,
      sshBruteForceScenario,
    );

    expect(result.verdict).toBe('REJECTED');
    expect(result.violatedPolicies.map((policy) => policy.reasonCode)).toContain(
      'NO_ELIGIBLE_STORYLET',
    );
  });

  it('rejects malformed decisions before policy evaluation', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const malformed = {
      ...decisionAt(EXTERNAL_SOURCE_DECISIONS, 1),
      actionType: 'delete_everything',
    } as unknown as ProposedDecision;

    expect(() =>
      evaluateDecision(malformed, state, sshBruteForceScenario),
    ).toThrow(RefereeValidationError);
  });

  it('is deterministic for identical decisions and state', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const decision = decisionAt(EXTERNAL_SOURCE_DECISIONS, 1);

    const first = evaluateDecision(decision, state, sshBruteForceScenario);
    const second = evaluateDecision(decision, state, sshBruteForceScenario);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('keeps storylet binding mandatory for a custom allow policy', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const policySet: RefereePolicySet = {
      id: 'custom',
      version: 'test',
      policies: [{
        policyId: 'custom-allow',
        description: 'Fixture allow policy.',
        evaluate: () => ({ status: 'PASS', reasonCode: 'ALLOWED', message: 'Allowed.' }),
      }],
    };

    const result = evaluateDecision(
      { ...decisionAt(EXTERNAL_SOURCE_DECISIONS, 1), storyletId: 'close-ssh-incident' },
      state,
      sshBruteForceScenario,
      { policySet },
    );

    expect(result.verdict).toBe('REJECTED');
    expect(result.violatedPolicies.map((policy) => policy.policyId)).toContain('POLICY-008');
  });

  it('does not authorize an action when every custom policy is inapplicable', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const result = evaluateDecision(
      decisionAt(EXTERNAL_SOURCE_DECISIONS, 1), state, sshBruteForceScenario,
      { policySet: {
        id: 'no-authorization', version: 'test', policies: [{
          policyId: 'unrelated', description: 'Unrelated policy.',
          evaluate: () => ({ status: 'NOT_APPLICABLE', reasonCode: 'UNRELATED', message: 'Unrelated.' }),
        }],
      } },
    );

    expect(result.verdict).toBe('REJECTED');
    expect(result.reasonCode).toBe('NO_APPLICABLE_POLICY');
  });

  it('fails evaluation for a malformed policy finding', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    const policySet = {
      id: 'broken', version: 'test', policies: [{
        policyId: 'broken-policy', description: 'Malformed finding.',
        evaluate: () => ({ status: 'unexpected' }),
      }],
    } as unknown as RefereePolicySet;

    expect(() => evaluateDecision(
      decisionAt(EXTERNAL_SOURCE_DECISIONS, 1), state, sshBruteForceScenario, { policySet },
    )).toThrow(RefereeEvaluationError);
  });

  it('does not let policy code mutate caller-owned state', () => {
    const state = structuredClone(afterTriage(sshBruteForceInitialStates.externalSource));
    const before = JSON.stringify(state);
    const policySet: RefereePolicySet = {
      id: 'mutating', version: 'test', policies: [{
        policyId: 'mutating-policy', description: 'Attempt a state mutation.',
        evaluate: (context) => {
          Object.assign(context.state.world, { sourceProtected: true });
          return { status: 'PASS', reasonCode: 'ALLOWED', message: 'Allowed.' };
        },
      }],
    };

    expect(() => evaluateDecision(
      decisionAt(EXTERNAL_SOURCE_DECISIONS, 1), state, sshBruteForceScenario, { policySet },
    )).toThrow(RefereeEvaluationError);
    expect(JSON.stringify(state)).toBe(before);
    expect(Object.isFrozen(state)).toBe(false);
  });

  it('fails evaluation for mismatched scenario identity', () => {
    const state = afterTriage(sshBruteForceInitialStates.externalSource);
    expect(() => evaluateDecision(
      decisionAt(EXTERNAL_SOURCE_DECISIONS, 1),
      { ...state, scenarioId: 'another-scenario' },
      sshBruteForceScenario,
    )).toThrow(/belongs to scenario/);
  });

  it('validates duplicate and malformed policy definitions', () => {
    const policy = {
      policyId: 'duplicate', description: 'Duplicate fixture.',
      evaluate: () => ({ status: 'PASS', reasonCode: 'PASS', message: 'Pass.' }),
    };
    expect(() => validateRefereePolicySet({
      id: 'duplicate-set', version: 'test', policies: [policy, policy],
    })).toThrow(RefereeValidationError);
    expect(() => validateRefereePolicySet({
      id: 'malformed-set', version: 'test', policies: [null],
    })).toThrow(RefereeValidationError);
  });
});
