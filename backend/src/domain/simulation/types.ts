import type {
  NarrativeState,
  ScenarioDefinition,
  StoryletDefinition,
  TransitionRecord,
  WorldState,
} from '../narrative/types.js';
import type {
  ProposedDecision,
  RefereePolicySet,
  RefereeResult,
} from '../referee/types.js';

export const SIMULATION_STATUSES = [
  'CREATED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

export const SIMULATION_EVALUATION_OUTCOMES = [
  'PASS',
  'FAIL',
  'INCONCLUSIVE',
] as const;
export type SimulationEvaluationOutcome =
  (typeof SIMULATION_EVALUATION_OUTCOMES)[number];

export const SIMULATION_ERROR_PHASES = [
  'configuration',
  'provider',
  'referee',
  'narrative',
  'orchestrator',
] as const;
export type SimulationErrorPhase = (typeof SIMULATION_ERROR_PHASES)[number];

export interface SimulationClock {
  now(): Date;
}

export interface SimulationRecord {
  readonly sequence: number;
  readonly decision: ProposedDecision;
  readonly referee: RefereeResult;
  readonly transition: TransitionRecord | null;
  readonly rejectionTransition?: TransitionRecord;
  readonly recordedAt: string;
}

export interface DecisionContext {
  readonly runId: string;
  readonly sequence: number;
  readonly scenario: ScenarioDefinition;
  readonly state: NarrativeState;
  readonly selectedStorylet: StoryletDefinition;
  readonly eligibleStorylets: readonly StoryletDefinition[];
  readonly eligibleStoryletIds: readonly string[];
  readonly records: readonly SimulationRecord[];
  readonly signal: AbortSignal;
}

export interface ProviderProvenance {
  readonly provider: string;
  readonly model: string;
}

export interface DecisionProvider {
  readonly id: string;
  readonly provenance?: ProviderProvenance;
  readonly decisionTimeoutMs?: number;
  decide(context: DecisionContext): ProposedDecision | Promise<ProposedDecision>;
}

export interface SimulationRunConfig {
  readonly scenario: ScenarioDefinition;
  readonly initialState: WorldState;
  readonly provider: DecisionProvider;
  readonly policySet?: RefereePolicySet;
  readonly maxDecisions?: number;
  readonly decisionTimeoutMs?: number;
  readonly runId?: string;
}

export interface SimulationErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly phase: SimulationErrorPhase;
  readonly details?: readonly string[];
  readonly sequence?: number;
}

export interface PolicyViolation {
  readonly sequence: number;
  readonly decisionId: string;
  readonly policyId: string;
  readonly reasonCode: string;
  readonly message: string;
}

export interface SimulationEvaluation {
  readonly runId: string;
  readonly scenarioId: string;
  readonly providerProvenance: ProviderProvenance | null;
  readonly status: SimulationStatus;
  readonly outcome: SimulationEvaluationOutcome;
  readonly reasonCode: string;
  readonly summary: string;
  readonly terminal: boolean;
  readonly totalDecisions: number;
  readonly approvedDecisions: number;
  readonly rejectedDecisions: number;
  readonly policyViolations: readonly PolicyViolation[];
  readonly finalStateVersion: number;
  readonly finalWorld: WorldState;
  readonly startedAt: string | null;
  readonly completedAt: string;
  readonly policySetId: string;
  readonly policySetVersion: string;
}

export interface SimulationRunSnapshot {
  readonly runId: string;
  readonly scenarioId: string;
  readonly providerId: string;
  readonly providerProvenance: ProviderProvenance | null;
  readonly status: SimulationStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly narrative: NarrativeState;
  readonly records: readonly SimulationRecord[];
  readonly evaluation: SimulationEvaluation | null;
  readonly error: SimulationErrorInfo | null;
  readonly decisionCount: number;
  readonly maxDecisions: number;
  readonly policySetId: string;
  readonly policySetVersion: string;
}
