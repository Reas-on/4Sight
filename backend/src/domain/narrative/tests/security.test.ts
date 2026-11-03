import { describe, expect, it } from 'vitest';
import { validateScenarioDefinition, validateWorldState } from '../schemas.js';
import { evaluateCondition } from '../conditions.js';
import { NarrativeValidationError } from '../errors.js';
import { sshBruteForceScenario, sshBruteForceInitialStates } from '../scenarios/ssh-brute-force.js';
import type { Condition } from '../types.js';

describe('narrative resource and object boundaries', () => {
  it('rejects deep and cyclic conditions before recursive validation/evaluation', () => {
    let condition: Condition = { op: 'equals', field: 'sourceProtected', value: false };
    for (let index = 0; index < 100; index++) condition = { op: 'not', condition };
    expect(() => evaluateCondition(condition, sshBruteForceInitialStates.externalSource)).toThrow(NarrativeValidationError);
    const cyclic = { op: 'not' } as { op: 'not'; condition: Condition };
    cyclic.condition = cyclic;
    expect(() => evaluateCondition(cyclic, sshBruteForceInitialStates.externalSource)).toThrow(/Cyclic/);
    expect(() => validateScenarioDefinition({ ...sshBruteForceScenario, storylets: [
      { ...sshBruteForceScenario.storylets[0], preconditions: cyclic },
    ] })).toThrow(NarrativeValidationError);
  });

  it('bounds storylets, effects, conditions and serialized input size', () => {
    const storylet = sshBruteForceScenario.storylets[0]!;
    expect(() => validateScenarioDefinition({ ...sshBruteForceScenario,
      storylets: Array.from({ length: 101 }, (_, index) => ({ ...storylet, id: `storylet-${index}` })),
    })).toThrow(NarrativeValidationError);
    expect(() => validateScenarioDefinition({ ...sshBruteForceScenario, description: 'x'.repeat(262_145) })).toThrow(NarrativeValidationError);
    expect(() => validateScenarioDefinition({ ...sshBruteForceScenario, storylets: [{ ...storylet,
      preconditions: { op: 'all', conditions: Array(33).fill({ op: 'equals', field: 'sourceProtected', value: false }) },
    }] })).toThrow(NarrativeValidationError);
    expect(() => validateScenarioDefinition({ ...sshBruteForceScenario, maxTransitions: 101 })).toThrow(NarrativeValidationError);
    expect(() => validateScenarioDefinition({ ...sshBruteForceScenario, storylets: Array(1_000_000) })).toThrow(NarrativeValidationError);
  });

  it('rejects prototype keys, accessor objects and unapproved world fields without evaluating code', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":true}}');
    expect(() => validateWorldState({ ...sshBruteForceInitialStates.externalSource, ...payload })).toThrow(NarrativeValidationError);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    let invoked = false;
    const hostile = { ...sshBruteForceScenario, get title() { invoked = true; return 'injected'; } };
    expect(() => validateScenarioDefinition(hostile)).toThrow(/Unsafe/);
    expect(invoked).toBe(false);
    expect(() => validateWorldState({ ...sshBruteForceInitialStates.externalSource, shellCommand: 'never execute' }))
      .toThrow(NarrativeValidationError);
  });
});
