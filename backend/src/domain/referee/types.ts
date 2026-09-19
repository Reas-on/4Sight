import type {
  NarrativeState,
  ScenarioDefinition,
  StoryletDefinition,
  StoryletOutcome,
} from '../narrative/types.js';

export const REFEREE_ACTION_TYPES = [
  'triage_alert',
  'perimeter_block',
  'soc_escalation',
  'soc_acknowledgement',
  'incident_closure',
] as const;
export type RefereeActionType = (typeof REFEREE_ACTION_TYPES)[number];

export const REFEREE_VERDICTS = ['APPROVED', 'REJECTED'] as const;
export type RefereeVerdict = (typeof REFEREE_VERDICTS)[number];

export const POLICY_STATUSES = ['PASS', 'FAIL', 'NOT_APPLICABLE'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export interface DecisionParameters {
  readonly sourceId?: string;
  readonly incidentId?: string;
}

export interface ProposedDecision {
  readonly decisionId: string;
  readonly providerId: string;
  readonly actionType: RefereeActionType;
  readonly parameters?: DecisionParameters;
  readonly storyletId: string;
  readonly outcomeId: string;
  readonly reasoning?: string;
}

export interface RefereePolicyContext {
  readonly decision: ProposedDecision;
  readonly state: NarrativeState;
  readonly scenario: ScenarioDefinition;
  readonly selectedStorylet: StoryletDefinition | null;
  readonly selectedOutcome: StoryletOutcome | null;
  readonly expectedActionType: RefereeActionType | null;
  readonly eligibleStoryletIds: readonly string[];
}

export interface RefereePolicyFinding {
  readonly status: PolicyStatus;
  readonly reasonCode: string;
  readonly message: string;
  readonly evidence?: readonly string[];
}

export interface RefereePolicy {
  readonly policyId: string;
  readonly description: string;
  evaluate(context: RefereePolicyContext): RefereePolicyFinding;
}

export interface RefereePolicySet {
  readonly id: string;
  readonly version: string;
  readonly policies: readonly RefereePolicy[];
}

export interface EvaluatedPolicy extends RefereePolicyFinding {
  readonly policyId: string;
  readonly description: string;
}

export interface RefereeResult {
  readonly verdict: RefereeVerdict;
  readonly approved: boolean;
  readonly decisionId: string;
  readonly providerId: string;
  readonly actionType: RefereeActionType;
  readonly storyletId: string;
  readonly outcomeId: string;
  readonly stateVersion: number;
  readonly policySetId: string;
  readonly policySetVersion: string;
  readonly reasonCode: string;
  readonly reasons: readonly string[];
  readonly evidence: readonly string[];
  readonly evaluatedPolicies: readonly EvaluatedPolicy[];
  readonly violatedPolicies: readonly EvaluatedPolicy[];
}

export interface RefereeErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly details?: readonly string[];
}

export interface RefereeOptions {
  readonly policySet?: RefereePolicySet;
}
