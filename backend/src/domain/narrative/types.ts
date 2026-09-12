export const SOURCE_CLASSIFICATIONS = ['external', 'internal'] as const;
export type SourceClassification = (typeof SOURCE_CLASSIFICATIONS)[number];

export const ASSET_CLASSIFICATIONS = ['workstation', 'server', 'domain-controller'] as const;
export type AssetClassification = (typeof ASSET_CLASSIFICATIONS)[number];

export const INCIDENT_STATUSES = ['detected', 'triaged', 'contained', 'escalated', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const ESCALATION_STATUSES = ['not_required', 'required', 'requested', 'accepted', 'declined'] as const;
export type EscalationStatus = (typeof ESCALATION_STATUSES)[number];

export const RESPONSE_STATUSES = ['none', 'monitoring', 'blocked', 'isolated', 'escalated', 'resolved'] as const;
export type ResponseStatus = (typeof RESPONSE_STATUSES)[number];

export const NARRATIVE_EVENT_PATTERN = /^event:[a-z0-9-]+$/;
export type NarrativeEventId = `event:${string}`;

export interface WorldState {
  readonly sourceClassification: SourceClassification;
  readonly sourceProtected: boolean;
  readonly assetClassification: AssetClassification;
  readonly assetProtected: boolean;
  readonly threatConfidence: number;
  readonly incidentStatus: IncidentStatus;
  readonly escalationStatus: EscalationStatus;
  readonly responseStatus: ResponseStatus;
  readonly escalationAttempts: number;
  readonly completedEvents: readonly NarrativeEventId[];
}

export interface NarrativeState {
  readonly scenarioId: string;
  readonly initialWorld: WorldState;
  readonly world: WorldState;
  readonly version: number;
  readonly step: number;
  readonly completedStorylets: readonly string[];
  readonly currentStoryletId: string | null;
  readonly terminal: boolean;
}

export type ScalarWorldField = Exclude<keyof WorldState, 'completedEvents'>;
export type NumericWorldField = 'threatConfidence' | 'escalationAttempts';
export type ConditionValue = string | number | boolean;

export type Condition =
  | {
      readonly op: 'equals';
      readonly field: ScalarWorldField;
      readonly value: ConditionValue;
    }
  | {
      readonly op: 'not_equals';
      readonly field: ScalarWorldField;
      readonly value: ConditionValue;
    }
  | {
      readonly op: 'greater_than';
      readonly field: NumericWorldField;
      readonly value: number;
    }
  | {
      readonly op: 'less_than';
      readonly field: NumericWorldField;
      readonly value: number;
    }
  | {
      readonly op: 'all';
      readonly conditions: readonly Condition[];
    }
  | {
      readonly op: 'any';
      readonly conditions: readonly Condition[];
    }
  | {
      readonly op: 'not';
      readonly condition: Condition;
    };

export type Effect =
  | {
      readonly type: 'set';
      readonly field: ScalarWorldField;
      readonly value: ConditionValue;
    }
  | {
      readonly type: 'increment';
      readonly field: NumericWorldField;
      readonly by: number;
    }
  | {
      readonly type: 'append';
      readonly field: 'completedEvents';
      readonly value: NarrativeEventId;
    };

export interface StoryletAction {
  readonly id: string;
  readonly description: string;
}

export interface StoryletOutcome {
  readonly id: string;
  readonly description: string;
  readonly effects: readonly Effect[];
}

export interface StoryletDefinition {
  readonly id: string;
  readonly description: string;
  readonly graphNodeId?: string;
  readonly priority: number;
  readonly oneShot: boolean;
  readonly terminal: boolean;
  readonly preconditions: Condition;
  readonly action: StoryletAction;
  readonly outcomes: readonly StoryletOutcome[];
}

export interface ScenarioDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly technique: string;
  readonly maxTransitions: number;
  readonly storylets: readonly StoryletDefinition[];
}

export interface TransitionRecord {
  readonly sequence: number;
  readonly storyletId: string;
  readonly outcomeId: string;
  readonly previousStateVersion: number;
  readonly nextStateVersion: number;
  readonly appliedEffects: readonly Effect[];
  readonly graphNodeId?: string;
}

export interface NarrativeErrorInfo {
  readonly code: string;
  readonly message: string;
  readonly details?: readonly string[];
}

export interface NextStoryletResolutionEligible {
  readonly status: 'eligible';
  readonly storylet: StoryletDefinition;
  readonly sequence: number;
  readonly eligibleStoryletIds: readonly string[];
}

export interface NextStoryletResolutionTerminal {
  readonly status: 'terminal';
  readonly sequence: number;
  readonly eligibleStoryletIds: readonly [];
}

export interface NextStoryletResolutionDeadEnd {
  readonly status: 'dead_end';
  readonly sequence: number;
  readonly eligibleStoryletIds: readonly [];
  readonly error: NarrativeErrorInfo;
}

export type NextStoryletResolution =
  | NextStoryletResolutionEligible
  | NextStoryletResolutionTerminal
  | NextStoryletResolutionDeadEnd;

export interface AdvanceNarrativeInput {
  readonly storyletId?: string;
  readonly outcomeId: string;
}

export interface AdvanceNarrativeApplied {
  readonly status: 'advanced';
  readonly state: NarrativeState;
  readonly record: TransitionRecord;
  readonly storylet: StoryletDefinition;
  readonly outcome: StoryletOutcome;
}

export interface AdvanceNarrativeTerminal {
  readonly status: 'terminal';
  readonly state: NarrativeState;
}

export interface AdvanceNarrativeDeadEnd {
  readonly status: 'dead_end';
  readonly state: NarrativeState;
  readonly error: NarrativeErrorInfo;
}

export type AdvanceNarrativeResult =
  | AdvanceNarrativeApplied
  | AdvanceNarrativeTerminal
  | AdvanceNarrativeDeadEnd;
