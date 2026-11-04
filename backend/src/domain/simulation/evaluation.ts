import type { NarrativeState, TransitionRecord } from '../narrative/types.js';
import type { RefereePolicySet } from '../referee/types.js';
import type { DecisionProvider, SimulationRecord, SimulationStatus } from './types.js';
import { SimulationError } from './errors.js';
import { BEGINNER_SCENARIO_ID } from '../narrative/scenarios/ssh-beginner.js';
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
  readonly workflowTransitions?: readonly TransitionRecord[];
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
  let stateVersion = 0;
  if (runtime.workflowTransitions) {
    if (runtime.scenario.id !== BEGINNER_SCENARIO_ID || runtime.records.length > 1) {
      throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Unexpected workflow evidence');
    }
    runtime.workflowTransitions.forEach((transition, index) => {
      if (transition.sequence !== index + 1 || transition.previousStateVersion !== index || transition.nextStateVersion !== index + 1) {
        throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Workflow transition versions are inconsistent');
      }
    });
  }

  runtime.records.forEach((record, index) => {
    if (record.referee.decisionId !== record.decision.decisionId ||
        record.referee.storyletId !== record.decision.storyletId || record.referee.outcomeId !== record.decision.outcomeId ||
        record.transition && (record.transition.storyletId !== record.decision.storyletId || record.transition.outcomeId !== record.decision.outcomeId) ||
        record.referee.approved && record.referee.violatedPolicies.length > 0 ||
        !record.referee.approved && record.referee.violatedPolicies.length === 0) {
      throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Referee and decision evidence are inconsistent');
    }
    if (runtime.workflowTransitions) {
      const gate = runtime.workflowTransitions.find(transition => transition.graphNodeId === 'N-06');
      if (!gate || gate.storyletId !== record.decision.storyletId || record.referee.stateVersion !== gate.previousStateVersion ||
          gate.outcomeId !== (record.referee.approved ? record.decision.outcomeId : 'response-rejected')) {
        throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Referee decision does not match the committed response gate');
      }
      stateVersion = gate.previousStateVersion;
    }
    if (record.sequence !== index + 1 || record.referee.stateVersion !== stateVersion ||
        record.transition && (record.transition.previousStateVersion !== stateVersion ||
          record.transition.nextStateVersion !== stateVersion + 1 || record.transition.sequence !== stateVersion + 1)) {
      throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Decision and transition versions are inconsistent');
    }
    if (record.transition) stateVersion++;
    if (record.rejectionTransition) {
      const route = record.rejectionTransition;
      if (record.referee.approved || record.transition ||
          route.outcomeId !== 'response-rejected' || route.previousStateVersion !== stateVersion ||
          route.nextStateVersion !== stateVersion + 1 || route.sequence !== stateVersion + 1) {
        throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Invalid rejection routing evidence');
      }
      stateVersion++;
    }
    if (runtime.workflowTransitions && record.transition && !runtime.workflowTransitions.some(item =>
      item.storyletId === record.transition!.storyletId && item.nextStateVersion === record.transition!.nextStateVersion && item.outcomeId === record.transition!.outcomeId)) {
      throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Decision transition is missing from workflow evidence');
    }
    if (record.referee.approved !== (record.referee.verdict === 'APPROVED') ||
        !record.referee.approved && record.transition !== null) {
      throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Decision evidence is inconsistent');
    }
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

  if (runtime.workflowTransitions) stateVersion = runtime.workflowTransitions.length;
  if (stateVersion !== runtime.narrative.version || stateVersion !== runtime.narrative.step) {
    throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Final narrative version differs from committed evidence');
  }

  if (outcome === 'PASS' && (runtime.status !== 'COMPLETED' || !runtime.narrative.terminal ||
      approvedDecisions === 0 || rejectedDecisions > 0 || runtime.records.some((record) => record.transition === null)) ||
      outcome === 'FAIL' && rejectedDecisions === 0 ||
      (runtime.status === 'CANCELLED' || runtime.status === 'FAILED') && outcome !== 'INCONCLUSIVE') {
    throw new SimulationError('EVALUATION_EVIDENCE_MISMATCH', 'Evaluation outcome does not match execution evidence');
  }

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
