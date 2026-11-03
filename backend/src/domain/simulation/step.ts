import { advanceNarrative } from '../narrative/engine.js';
import { evaluateDecision } from '../referee/evaluator.js';
import { validateProposedDecision } from '../referee/schemas.js';
import type { NarrativeState, ScenarioDefinition } from '../narrative/types.js';
import type { RefereePolicySet } from '../referee/types.js';
import { SimulationNarrativeError, toSimulationErrorInfo } from './errors.js';
import type { SimulationErrorInfo, SimulationRecord } from './types.js';

export interface EvaluatedStep {
  readonly state: NarrativeState;
  readonly record: SimulationRecord;
  readonly error: SimulationErrorInfo | null;
}

export function evaluateSimulationStep(
  raw: unknown, state: NarrativeState, scenario: ScenarioDefinition,
  policySet: RefereePolicySet, sequence: number, recordedAt: string,
): EvaluatedStep {
  const decision = validateProposedDecision(raw);
  const referee = evaluateDecision(decision, state, scenario, { policySet });
  if (!referee.approved) {
    return { state, record: Object.freeze({ sequence, decision, referee, transition: null, recordedAt }), error: null };
  }
  try {
    const applied = advanceNarrative(state, scenario, { storyletId: decision.storyletId, outcomeId: decision.outcomeId });
    if (applied.status !== 'advanced') throw new SimulationNarrativeError('NARRATIVE_NOT_ADVANCED', 'Approved narrative did not advance');
    return {
      state: applied.state,
      record: Object.freeze({ sequence, decision, referee, transition: applied.record, recordedAt }),
      error: null,
    };
  } catch (error) {
    return {
      state, record: Object.freeze({ sequence, decision, referee, transition: null, recordedAt }),
      error: toSimulationErrorInfo(error, 'narrative', sequence),
    };
  }
}
