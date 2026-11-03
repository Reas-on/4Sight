import type { NarrativeState, ScenarioDefinition } from '../../domain/narrative/types.js';
import type { SimulationErrorInfo, SimulationEvaluation, SimulationRecord, SimulationStatus } from '../../domain/simulation/types.js';
import type { SimulationLifecycleAction } from '../../domain/simulation/lifecycle.js';

export interface RunConfiguration {
  readonly scenario: ScenarioDefinition;
  readonly scenarioVersion: string;
  readonly initialVariant: 'externalSource' | 'protectedInternalSource';
  readonly providerId: string;
  readonly modelId: string | null;
  readonly decisionTimeoutMs: number;
}

export interface DurableRun {
  readonly id: string;
  readonly configuration: RunConfiguration;
  readonly status: SimulationStatus;
  readonly revision: number;
  readonly eventSequence: number;
  readonly narrative: NarrativeState;
  readonly records: readonly SimulationRecord[];
  readonly evaluation: SimulationEvaluation | null;
  readonly error: SimulationErrorInfo | null;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly updatedAt: string;
}

export interface AuditEvent {
  readonly id: string;
  readonly runId: string;
  readonly sequence: number;
  readonly eventType: string;
  readonly storyletId: string | null;
  readonly nodeId: string | null;
  readonly stateVersion: number;
  readonly payload: Record<string, unknown>;
  readonly createdAt: string;
}

export interface SimulationRepository {
  create(configuration: RunConfiguration, token: string): Promise<DurableRun>;
  read(id: string): Promise<DurableRun>;
  authorize(id: string, token: string): Promise<void>;
  lifecycle(id: string, action: SimulationLifecycleAction): Promise<DurableRun>;
  commitDecision(id: string, revision: number, stateVersion: number, decision: unknown): Promise<DurableRun>;
  fail(id: string, revision: number, code: string): Promise<DurableRun>;
  events(id: string, after: number, limit?: number): Promise<readonly AuditEvent[]>;
  recover(): Promise<number>;
}

export class ApplicationError extends Error {
  constructor(readonly code: string, readonly statusCode: number, message = code) {
    super(message);
  }
}
