import type { NarrativeState, ScenarioDefinition, WorldState } from '../narrative/types.js';
import type { RefereePolicySet } from '../referee/types.js';
import { SimulationNotFoundError } from './errors.js';
import type {
  DecisionProvider,
  SimulationErrorInfo,
  SimulationEvaluation,
  SimulationRecord,
  SimulationStatus,
} from './types.js';

export interface RunRuntime {
  readonly runId: string;
  readonly scenario: ScenarioDefinition;
  readonly initialState: WorldState;
  readonly provider: DecisionProvider;
  readonly policySet: RefereePolicySet;
  readonly maxDecisions: number;
  readonly decisionTimeoutMs: number;
  status: SimulationStatus;
  narrative: NarrativeState;
  readonly records: SimulationRecord[];
  evaluation: SimulationEvaluation | null;
  error: SimulationErrorInfo | null;
  readonly createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  generation: number;
  controller: AbortController | null;
}

export class InMemoryRunStore {
  private readonly runs = new Map<string, RunRuntime>();

  create(runtime: RunRuntime): void {
    this.runs.set(runtime.runId, runtime);
  }

  get(runId: string): RunRuntime {
    const runtime = this.runs.get(runId);
    if (runtime === undefined) throw new SimulationNotFoundError(runId);
    return runtime;
  }

  has(runId: string): boolean {
    return this.runs.has(runId);
  }

  values(): readonly RunRuntime[] {
    return Object.freeze([...this.runs.values()]);
  }
}
