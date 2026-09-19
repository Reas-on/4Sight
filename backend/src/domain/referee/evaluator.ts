import { immutableDataSnapshot } from '../immutable.js';
import { resolveNextStorylet } from '../narrative/resolver.js';
import {
  validateNarrativeState,
  validateScenarioDefinition,
} from '../narrative/schemas.js';
import type { NarrativeState, ScenarioDefinition } from '../narrative/types.js';
import { RefereeEvaluationError } from './errors.js';
import {
  ACTION_TYPE_BY_STORYLET_ACTION_ID,
  DECISION_BINDING_POLICY,
  DEFAULT_REFEREE_POLICY_SET,
} from './policies.js';
import {
  validateProposedDecision,
  validateRefereePolicyFinding,
  validateRefereePolicySet,
} from './schemas.js';
import type {
  EvaluatedPolicy,
  RefereeOptions,
  RefereePolicyContext,
  RefereeResult,
} from './types.js';

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)]);
}

export function evaluateDecision(
  proposedDecision: unknown,
  state: NarrativeState,
  scenario: ScenarioDefinition,
  options: RefereeOptions = {},
): RefereeResult {
  const decision = validateProposedDecision(proposedDecision);
  const validState = immutableDataSnapshot(validateNarrativeState(state));
  const validScenario = immutableDataSnapshot(validateScenarioDefinition(scenario));
  if (validState.scenarioId !== validScenario.id) {
    throw new RefereeEvaluationError(
      'SCENARIO_MISMATCH',
      `Narrative state belongs to scenario "${validState.scenarioId}", not "${validScenario.id}"`,
    );
  }
  const policySet = validateRefereePolicySet(
    options.policySet ?? DEFAULT_REFEREE_POLICY_SET,
  );

  const resolution = resolveNextStorylet(validState, validScenario);
  const selectedStorylet = resolution.status === 'eligible' ? resolution.storylet : null;
  const selectedOutcome =
    selectedStorylet === null
      ? null
      : (selectedStorylet.outcomes.find(
          (outcome) => outcome.id === decision.outcomeId,
        ) ?? null);
  const expectedActionType =
    selectedStorylet === null
      ? null
      : (ACTION_TYPE_BY_STORYLET_ACTION_ID[selectedStorylet.action.id] ?? null);
  const eligibleStoryletIds =
    resolution.status === 'eligible' ? resolution.eligibleStoryletIds : [];

  const context: RefereePolicyContext = Object.freeze({
    decision,
    state: validState,
    scenario: validScenario,
    selectedStorylet,
    selectedOutcome,
    expectedActionType,
    eligibleStoryletIds: Object.freeze([...eligibleStoryletIds]),
  });

  const policies = [
    ...policySet.policies.filter(
      (policy) => policy.policyId !== DECISION_BINDING_POLICY.policyId,
    ),
    DECISION_BINDING_POLICY,
  ];
  const evaluatedPolicies: EvaluatedPolicy[] = policies.map((policy) => {
    let policyFinding;
    try {
      policyFinding = validateRefereePolicyFinding(policy.evaluate(context));
    } catch (error) {
      throw new RefereeEvaluationError(
        'POLICY_EVALUATION_ERROR',
        `Referee policy "${policy.policyId}" failed to evaluate: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return Object.freeze({
      ...policyFinding,
      policyId: policy.policyId,
      description: policy.description,
      ...(policyFinding.evidence === undefined
        ? {}
        : { evidence: Object.freeze([...policyFinding.evidence]) }),
    });
  });

  if (!evaluatedPolicies.some(
    (policy) => policy.policyId !== DECISION_BINDING_POLICY.policyId && policy.status === 'PASS',
  )) {
    evaluatedPolicies.push(Object.freeze({
      policyId: 'POLICY-DEFAULT-DENY',
      description: 'Require an applicable policy to authorize the action.',
      status: 'FAIL',
      reasonCode: 'NO_APPLICABLE_POLICY',
      message: 'No applicable policy authorized the proposed action.',
    }));
  }

  const violatedPolicies = evaluatedPolicies.filter(
    (policy) => policy.status === 'FAIL',
  );
  const approved = violatedPolicies.length === 0;
  const reasons = approved
    ? Object.freeze(['All referee policies approved the proposed decision.'])
    : Object.freeze(violatedPolicies.map((policy) => policy.message));
  const evidence = unique(
    evaluatedPolicies.flatMap((policy) => policy.evidence ?? []),
  );
  const reasonCode = approved
    ? 'POLICY_APPROVED'
    : (violatedPolicies[0]?.reasonCode ?? 'POLICY_VIOLATION');

  return Object.freeze({
    verdict: approved ? 'APPROVED' : 'REJECTED',
    approved,
    decisionId: decision.decisionId,
    providerId: decision.providerId,
    actionType: decision.actionType,
    storyletId: decision.storyletId,
    outcomeId: decision.outcomeId,
    stateVersion: validState.version,
    policySetId: policySet.id,
    policySetVersion: policySet.version,
    reasonCode,
    reasons,
    evidence,
    evaluatedPolicies: Object.freeze([...evaluatedPolicies]),
    violatedPolicies: Object.freeze([...violatedPolicies]),
  });
}
