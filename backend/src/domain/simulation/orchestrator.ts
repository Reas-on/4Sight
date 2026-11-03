import { randomUUID } from 'node:crypto';
import { immutableDataSnapshot } from '../immutable.js';
import {
  initializeScenario,
} from '../narrative/engine.js';
import {
  getEligibleStorylets,
  resolveNextStorylet,
} from '../narrative/resolver.js';
import {
  validateScenarioDefinition,
  validateWorldState,
} from '../narrative/schemas.js';
import type {
  NarrativeState,
  ScenarioDefinition,
  TransitionRecord,
  WorldState,
} from '../narrative/types.js';
import { RefereeValidationError } from '../referee/errors.js';
import {
  DEFAULT_REFEREE_POLICY_SET,
  validateRefereePolicySet,
} from '../referee/index.js';
import type { ProposedDecision, RefereePolicySet, RefereeResult } from '../referee/types.js';
import { requestDecision } from './decision-provider.js';
import {
  SimulationConfigurationError,
  SimulationProviderError,
  SimulationNarrativeError,
  toSimulationErrorInfo,
} from './errors.js';
import { buildSimulationEvaluation } from './evaluation.js';
import { evaluateSimulationStep } from './step.js';
import {
  assertLifecycleTransition,
  isTerminalStatus,
} from './lifecycle.js';
import { InMemoryRunStore, type RunRuntime } from './run-store.js';
import type {
  DecisionContext,
  DecisionProvider,
  SimulationClock,
  SimulationErrorInfo,
  SimulationEvaluation,
  SimulationEvaluationOutcome,
  SimulationRecord,
  SimulationRunConfig,
  SimulationRunSnapshot,
  SimulationStatus,
} from './types.js';

const DEFAULT_DECISION_TIMEOUT_MS = 1_000;
const SYSTEM_CLOCK: SimulationClock = Object.freeze({
  now: () => new Date(),
});

export interface InMemorySimulationOrchestratorOptions {
  readonly clock?: SimulationClock;
  readonly runIdFactory?: () => string;
  readonly defaultDecisionTimeoutMs?: number;
  readonly defaultMaxDecisions?: number;
}

export interface SimulationOrchestrator {
  createRun(config: SimulationRunConfig): SimulationRunSnapshot;
  startRun(runId: string): Promise<SimulationRunSnapshot>;
  pauseRun(runId: string): SimulationRunSnapshot;
  resumeRun(runId: string): Promise<SimulationRunSnapshot>;
  cancelRun(runId: string): SimulationRunSnapshot;
  getRunSnapshot(runId: string): SimulationRunSnapshot;
  getRunRecords(runId: string): readonly SimulationRecord[];
  getRunEvaluation(runId: string): SimulationEvaluation | null;
  listRuns(): readonly SimulationRunSnapshot[];
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new SimulationConfigurationError(`${label} must be a positive integer`, [
      `${label}=${String(value)}`,
    ]);
  }
}

function assertDecisionProvider(value: DecisionProvider): void {
  if (typeof value !== 'object' || value === null) {
    throw new SimulationConfigurationError('A decision provider is required');
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new SimulationConfigurationError(
      'The decision provider requires a non-empty identifier',
    );
  }
  if (typeof value.decide !== 'function') {
    throw new SimulationConfigurationError(
      `Decision provider "${value.id}" requires a decide function`,
    );
  }
}

export class InMemorySimulationOrchestrator implements SimulationOrchestrator {
  private readonly store = new InMemoryRunStore();
  private readonly clock: SimulationClock;
  private readonly runIdFactory: () => string;
  private readonly defaultDecisionTimeoutMs: number;
  private readonly defaultMaxDecisions: number | null;

  constructor(options: InMemorySimulationOrchestratorOptions = {}) {
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.runIdFactory = options.runIdFactory ?? (() => randomUUID());
    this.defaultDecisionTimeoutMs =
      options.defaultDecisionTimeoutMs ?? DEFAULT_DECISION_TIMEOUT_MS;
    this.defaultMaxDecisions = options.defaultMaxDecisions ?? null;

    assertPositiveInteger(this.defaultDecisionTimeoutMs, 'defaultDecisionTimeoutMs');
    if (this.defaultMaxDecisions !== null) {
      assertPositiveInteger(this.defaultMaxDecisions, 'defaultMaxDecisions');
    }
  }

  createRun(config: SimulationRunConfig): SimulationRunSnapshot {
    assertDecisionProvider(config.provider);

    let scenario: ScenarioDefinition;
    let initialState: WorldState;
    let narrative: NarrativeState;
    let policySet: RefereePolicySet;

    try {
      scenario = immutableDataSnapshot(validateScenarioDefinition(config.scenario));
      initialState = immutableDataSnapshot(validateWorldState(config.initialState));
      narrative = initializeScenario(scenario, initialState);
    } catch (error) {
      throw new SimulationConfigurationError(
        'Invalid simulation scenario or initial state',
        [error instanceof Error ? error.message : String(error)],
      );
    }

    try {
      policySet = validateRefereePolicySet(
        config.policySet ?? DEFAULT_REFEREE_POLICY_SET,
      );
    } catch (error) {
      throw new SimulationConfigurationError(
        'Invalid referee policy set',
        [error instanceof Error ? error.message : String(error)],
      );
    }

    const configuredMaxDecisions =
      config.maxDecisions ?? this.defaultMaxDecisions ?? scenario.maxTransitions;
    assertPositiveInteger(configuredMaxDecisions, 'maxDecisions');
    const maxDecisions = Math.min(configuredMaxDecisions, scenario.maxTransitions);

    const decisionTimeoutMs =
      config.decisionTimeoutMs ?? config.provider.decisionTimeoutMs ?? this.defaultDecisionTimeoutMs;
    assertPositiveInteger(decisionTimeoutMs, 'decisionTimeoutMs');

    const runId = config.runId ?? this.runIdFactory();
    if (typeof runId !== 'string' || runId.length === 0) {
      throw new SimulationConfigurationError(
        'The run identifier factory returned an empty identifier',
      );
    }
    if (this.store.has(runId)) {
      throw new SimulationConfigurationError(
        `Simulation run "${runId}" already exists`,
      );
    }

    const now = this.nowIso();
    const runtime: RunRuntime = {
      runId,
      scenario,
      initialState,
      provider: Object.freeze({
        id: config.provider.id,
        decide: config.provider.decide.bind(config.provider),
        ...(config.provider.provenance === undefined
          ? {} : { provenance: immutableDataSnapshot(config.provider.provenance) }),
      }),
      policySet,
      maxDecisions,
      decisionTimeoutMs,
      status: 'CREATED',
      narrative,
      records: [],
      evaluation: null,
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      generation: 0,
      controller: null,
    };

    this.store.create(runtime);
    return this.toSnapshot(runtime);
  }

  startRun(runId: string): Promise<SimulationRunSnapshot> {
    const runtime = this.store.get(runId);
    assertLifecycleTransition(runtime.status, 'start');

    const now = this.nowIso();
    runtime.status = 'RUNNING';
    runtime.startedAt = now;
    runtime.updatedAt = now;

    return this.drive(runtime);
  }

  pauseRun(runId: string): SimulationRunSnapshot {
    const runtime = this.store.get(runId);
    assertLifecycleTransition(runtime.status, 'pause');

    const now = this.nowIso();
    runtime.generation += 1;
    runtime.status = 'PAUSED';
    runtime.updatedAt = now;
    runtime.controller?.abort();

    return this.toSnapshot(runtime);
  }

  resumeRun(runId: string): Promise<SimulationRunSnapshot> {
    const runtime = this.store.get(runId);
    assertLifecycleTransition(runtime.status, 'resume');

    const now = this.nowIso();
    runtime.status = 'RUNNING';
    runtime.updatedAt = now;
    if (runtime.startedAt === null) runtime.startedAt = now;

    return this.drive(runtime);
  }

  cancelRun(runId: string): SimulationRunSnapshot {
    const runtime = this.store.get(runId);
    assertLifecycleTransition(runtime.status, 'cancel');

    this.finishRun(
      runtime,
      'CANCELLED',
      'INCONCLUSIVE',
      'RUN_CANCELLED',
      'Simulation run was cancelled before reaching a terminal outcome.',
      null,
    );

    return this.toSnapshot(runtime);
  }

  getRunSnapshot(runId: string): SimulationRunSnapshot {
    return this.toSnapshot(this.store.get(runId));
  }

  getRunRecords(runId: string): readonly SimulationRecord[] {
    return Object.freeze([...this.store.get(runId).records]);
  }

  getRunEvaluation(runId: string): SimulationEvaluation | null {
    return this.store.get(runId).evaluation;
  }

  listRuns(): readonly SimulationRunSnapshot[] {
    return Object.freeze(this.store.values().map((runtime) => this.toSnapshot(runtime)));
  }

  private drive(runtime: RunRuntime): Promise<SimulationRunSnapshot> {
    const generation = runtime.generation + 1;
    runtime.generation = generation;
    const controller = new AbortController();
    runtime.controller = controller;

    return this.runLoop(runtime, generation, controller);
  }

  private async runLoop(
    runtime: RunRuntime,
    generation: number,
    controller: AbortController,
  ): Promise<SimulationRunSnapshot> {
    try {
      while (this.isActive(runtime, generation, controller)) {
        if (runtime.narrative.terminal) {
          this.finishRun(
            runtime,
            'COMPLETED',
            'PASS',
            'RUN_COMPLETED',
            `Simulation completed after ${runtime.records.length} decision(s).`,
            null,
          );
          break;
        }

        if (runtime.narrative.step >= runtime.maxDecisions) {
          this.finishRun(
            runtime,
            'FAILED',
            'INCONCLUSIVE',
            'DECISION_LIMIT',
            `Simulation reached its decision limit of ${runtime.maxDecisions}.`,
            toSimulationErrorInfo(
              new SimulationProviderError(
                'DECISION_LIMIT',
                `Simulation reached its decision limit of ${runtime.maxDecisions}`,
              ),
              'orchestrator',
            ),
          );
          break;
        }

        const resolution = resolveNextStorylet(runtime.narrative, runtime.scenario);
        if (resolution.status === 'terminal') {
          this.finishRun(
            runtime,
            'COMPLETED',
            'PASS',
            'RUN_COMPLETED',
            `Simulation completed after ${runtime.records.length} decision(s).`,
            null,
          );
          break;
        }
        if (resolution.status === 'dead_end') {
          this.finishRun(
            runtime,
            'FAILED',
            'INCONCLUSIVE',
            'NARRATIVE_DEAD_END',
            'Simulation stopped at a narrative dead end.',
            toSimulationErrorInfo(
              new SimulationNarrativeError(
                resolution.error.code,
                resolution.error.message,
                resolution.error.details,
              ),
              'narrative',
              resolution.sequence,
            ),
          );
          break;
        }

        const sequence = runtime.records.length + 1;
        const eligibleStorylets = Object.freeze([
          ...getEligibleStorylets(runtime.narrative, runtime.scenario),
        ]);
        const context: DecisionContext = Object.freeze({
          runId: runtime.runId,
          sequence,
          scenario: runtime.scenario,
          state: runtime.narrative,
          selectedStorylet: resolution.storylet,
          eligibleStorylets,
          eligibleStoryletIds: Object.freeze([...resolution.eligibleStoryletIds]),
          records: Object.freeze([...runtime.records]),
          signal: controller.signal,
        });

        let rawDecision: unknown;
        try {
          rawDecision = await requestDecision(runtime.provider, context, {
            timeoutMs: runtime.decisionTimeoutMs,
            signal: controller.signal,
            sequence,
          });
        } catch (error) {
          if (!this.isActive(runtime, generation, controller)) {
            return this.toSnapshot(runtime);
          }

          const info = toSimulationErrorInfo(error, 'provider', sequence);
          const timeout = info.code === 'DECISION_TIMEOUT' || info.code === 'PROVIDER_TIMEOUT';
          this.finishRun(
            runtime,
            'FAILED',
            'INCONCLUSIVE',
            timeout ? 'DECISION_TIMEOUT' : 'PROVIDER_ERROR',
            timeout
              ? `Decision provider timed out at decision ${sequence}.`
              : `Decision provider failed at decision ${sequence}.`,
            info,
          );
          break;
        }

        if (!this.isActive(runtime, generation, controller)) {
          return this.toSnapshot(runtime);
        }

        let step: ReturnType<typeof evaluateSimulationStep>;
        try {
          step = evaluateSimulationStep(rawDecision, runtime.narrative, runtime.scenario,
            runtime.policySet, sequence, this.nowIso());
        } catch (error) {
          if (!this.isActive(runtime, generation, controller)) {
            return this.toSnapshot(runtime);
          }
          const info = toSimulationErrorInfo(error, 'referee', sequence);
          this.finishRun(
            runtime,
            'FAILED',
            'INCONCLUSIVE',
            error instanceof RefereeValidationError ? 'INVALID_DECISION' : 'REFEREE_ERROR',
            `Decision evaluation failed at sequence ${sequence}.`,
            Object.freeze({ ...info, code: error instanceof RefereeValidationError ? 'INVALID_DECISION' : 'REFEREE_ERROR' }),
          );
          break;
        }

        if (!this.isActive(runtime, generation, controller)) {
          return this.toSnapshot(runtime);
        }
        const { decision, referee: refereeResult } = step.record;
        this.appendRecord(runtime, sequence, decision, refereeResult, step.record.transition);
        if (!refereeResult.approved) {
          this.finishRun(
            runtime,
            'COMPLETED',
            'FAIL',
            'POLICY_REJECTION',
            `Simulation stopped after referee rejection at decision ${sequence}.`,
            null,
          );
          break;
        }

        if (step.error) {
          this.finishRun(
            runtime,
            'FAILED',
            'INCONCLUSIVE',
            'NARRATIVE_ERROR',
            `Narrative transition failed at decision ${sequence}.`,
            step.error,
          );
          break;
        }

        const nextState = step.state;
        runtime.narrative = nextState;
        runtime.updatedAt = this.nowIso();

        if (nextState.terminal) {
          this.finishRun(
            runtime,
            'COMPLETED',
            'PASS',
            'RUN_COMPLETED',
            `Simulation completed after ${runtime.records.length} decision(s).`,
            null,
          );
          break;
        }
      }
    } catch (error) {
      if (this.isActive(runtime, generation, controller)) {
        this.finishRun(
          runtime,
          'FAILED',
          'INCONCLUSIVE',
          'ORCHESTRATOR_ERROR',
          'Simulation orchestrator encountered an unexpected error.',
          toSimulationErrorInfo(error, 'orchestrator'),
        );
      }
    }

    return this.toSnapshot(runtime);
  }

  private appendRecord(
    runtime: RunRuntime,
    sequence: number,
    decision: ProposedDecision,
    referee: RefereeResult,
    transition: TransitionRecord | null,
  ): SimulationRecord {
    const record: SimulationRecord = Object.freeze({
      sequence,
      decision,
      referee,
      transition,
      recordedAt: this.nowIso(),
    });
    runtime.records.push(record);
    runtime.updatedAt = record.recordedAt;
    return record;
  }

  private finishRun(
    runtime: RunRuntime,
    status: SimulationStatus,
    outcome: SimulationEvaluationOutcome,
    reasonCode: string,
    summary: string,
    error: SimulationErrorInfo | null,
  ): void {
    if (isTerminalStatus(runtime.status)) return;

    const completedAt = this.nowIso();
    runtime.status = status;
    runtime.completedAt = completedAt;
    runtime.updatedAt = completedAt;
    runtime.error = error;
    runtime.evaluation = buildSimulationEvaluation(
      runtime,
      outcome,
      reasonCode,
      summary,
      completedAt,
    );
    runtime.controller?.abort();
  }

  private isActive(
    runtime: RunRuntime,
    generation: number,
    controller: AbortController,
  ): boolean {
    return (
      runtime.status === 'RUNNING' &&
      runtime.generation === generation &&
      !controller.signal.aborted
    );
  }

  private nowIso(): string {
    const value = this.clock.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw new SimulationConfigurationError(
        'The simulation clock returned an invalid date',
      );
    }
    return value.toISOString();
  }

  private toSnapshot(runtime: RunRuntime): SimulationRunSnapshot {
    return Object.freeze({
      runId: runtime.runId,
      scenarioId: runtime.scenario.id,
      providerId: runtime.provider.id,
      providerProvenance: runtime.provider.provenance ?? null,
      status: runtime.status,
      createdAt: runtime.createdAt,
      updatedAt: runtime.updatedAt,
      startedAt: runtime.startedAt,
      completedAt: runtime.completedAt,
      narrative: runtime.narrative,
      records: Object.freeze([...runtime.records]),
      evaluation: runtime.evaluation,
      error: runtime.error,
      decisionCount: runtime.records.length,
      maxDecisions: runtime.maxDecisions,
      policySetId: runtime.policySet.id,
      policySetVersion: runtime.policySet.version,
    });
  }
}

export function createInMemorySimulationOrchestrator(
  options: InMemorySimulationOrchestratorOptions = {},
): InMemorySimulationOrchestrator {
  return new InMemorySimulationOrchestrator(options);
}
