import type { RunRuntime } from './run-store.js';
import type {
  PolicyViolation,
  SimulationEvaluation,
  SimulationEvaluationOutcome,
} from './types.js';

export function buildSimulationEvaluation(
  runtime: RunRuntime,
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
