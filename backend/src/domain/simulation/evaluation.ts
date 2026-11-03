import type { NarrativeState } from '../narrative/types.js';
import type { RefereePolicySet } from '../referee/types.js';
import type { DecisionProvider, SimulationRecord, SimulationStatus } from './types.js';
import type {
  PolicyViolation,
  SimulationEvaluation,
  SimulationEvaluationOutcome,
} from './types.js';

export interface EvaluationContext {
  readonly runId: string;
  readonly scenario: { readonly id: string };
  readonly provider: Pick<DecisionProvider, 'provenance'>;
  readonly status: SimulationStatus;
  readonly records: readonly SimulationRecord[];
  readonly narrative: NarrativeState;
  readonly startedAt: string | null;
  readonly policySet: Pick<RefereePolicySet, 'id' | 'version'>;
}

export function buildSimulationEvaluation(
  runtime: EvaluationContext,
  outcome: SimulationEvaluationOutcome,
  reasonCode: string,
  summary: string,
  completedAt: string,
): SimulationEvaluation {
  const policyViolations: PolicyViolation[] = [];
  let approvedDecisions = 0;
  let rejectedDecisions = 0;

  runtime.records.forEach((record) => {
    if (record.referee.approved) {
      approvedDecisions += 1;
      return;
    }

    rejectedDecisions += 1;
    record.referee.violatedPolicies.forEach((policy) => {
      policyViolations.push(
        Object.freeze({
          sequence: record.sequence,
          decisionId: record.decision.decisionId,
          policyId: policy.policyId,
          reasonCode: policy.reasonCode,
          message: policy.message,
        }),
      );
    });
  });

  return Object.freeze({
    runId: runtime.runId,
    scenarioId: runtime.scenario.id,
    providerProvenance: runtime.provider.provenance ?? null,
    status: runtime.status,
    outcome,
    reasonCode,
    summary,
    terminal: runtime.narrative.terminal,
    totalDecisions: runtime.records.length,
    approvedDecisions,
    rejectedDecisions,
    policyViolations: Object.freeze(policyViolations),
    finalStateVersion: runtime.narrative.version,
    finalWorld: runtime.narrative.world,
    startedAt: runtime.startedAt,
    completedAt,
    policySetId: runtime.policySet.id,
    policySetVersion: runtime.policySet.version,
  });
}
