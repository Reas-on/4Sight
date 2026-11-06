import { randomBytes } from 'node:crypto';
import { immutableDataSnapshot } from '../../domain/immutable.js';
import { getEligibleStorylets, resolveNextStorylet } from '../../domain/narrative/engine.js';
import { scenarioRegistry } from '../../domain/narrative/scenarios/registry.js';
import { beginnerContext, isBeginner, isProposal } from '../../domain/narrative/scenarios/ssh-beginner.js';
import { advanceNarrative } from '../../domain/narrative/engine.js';
import { requestDecision } from '../../domain/simulation/decision-provider.js';
import { SimulationError } from '../../domain/simulation/errors.js';
import { RefereeError, RefereeValidationError } from '../../domain/referee/errors.js';
import { assertLifecycleTransition } from '../../domain/simulation/lifecycle.js';
import type { DecisionProvider } from '../../domain/simulation/types.js';
import { ApplicationError, type DurableRun, type SimulationRepository } from './contracts.js';

export type InitialVariant = 'externalSource' | 'protectedInternalSource';
export interface ProviderSelection {
  readonly providerId: string;
  readonly modelId: string | null;
  readonly additionalContext?: string;
}

export type ProviderFactory = (variant: InitialVariant, scenarioId?: string, selection?: ProviderSelection) => DecisionProvider;

export class SimulationService {
  private readonly workers = new Map<string, { controller: AbortController; task: Promise<void> }>();
  private closing = false;
  private reservations = 0;
  private readonly controls = new Map<string, Promise<unknown>>();
  private pendingControls = 0;
  private readonly creations = new Set<Promise<{ run: DurableRun; accessToken: string }>>();

  constructor(readonly repository: SimulationRepository, private readonly providerFactory: ProviderFactory,
    private readonly reportFailure: (code: string) => void = () => undefined) {}

  create(scenarioId: string, initialVariant: InitialVariant,
    selection?: ProviderSelection): Promise<{ run: DurableRun; accessToken: string }> {
    const task = this.createRun(scenarioId, initialVariant, selection);
    this.creations.add(task);
    return task.finally(() => this.creations.delete(task));
  }

  private async createRun(scenarioId: string, initialVariant: InitialVariant,
    selection?: ProviderSelection): Promise<{ run: DurableRun; accessToken: string }> {
    const entry = scenarioRegistry.find(item => item.scenario.id === scenarioId);
    if (!entry) throw new ApplicationError('SCENARIO_NOT_FOUND', 404);
    const { scenario } = entry;
    this.checkCapacity();
    this.reservations += 1;
    try {
      const provider = this.providerFactory(initialVariant, scenario.id, selection);
      if (selection?.additionalContext?.trim()) throw new ApplicationError('UNSUPPORTED_ADDITIONAL_CONTEXT', 400);
      const selectedProvider = provider.id.startsWith('fixture-') ? 'fixture' : provider.id;
      if (selection && (selection.providerId !== selectedProvider || selection.modelId !== (provider.provenance?.model ?? null))) {
        throw new ApplicationError('PROVIDER_CONFIGURATION_CHANGED', 409);
      }
      const accessToken = randomBytes(32).toString('hex');
      const created = await this.repository.create({
        scenario: immutableDataSnapshot(scenario), scenarioVersion: entry.version, initialVariant,
        providerId: provider.id, modelId: provider.provenance?.model ?? null,
        decisionTimeoutMs: provider.decisionTimeoutMs ?? 1000,
        ...(isBeginner(scenario) ? { incidentContext: immutableDataSnapshot(beginnerContext) } : {}),
      }, accessToken);
      const run = await this.repository.lifecycle(created.id, 'start');
      if (this.closing) {
        await this.repository.fail(run.id, run.revision, 'PROCESS_INTERRUPTED');
        throw new ApplicationError('EXECUTOR_UNAVAILABLE', 503);
      }
      this.launch(run, provider);
      return { run, accessToken };
    } finally { this.reservations -= 1; }
  }

  private checkCapacity(): void {
    if (this.closing) throw new ApplicationError('EXECUTOR_UNAVAILABLE', 503);
    if (this.workers.size + this.reservations >= 16) throw new ApplicationError('RUN_CAPACITY_REACHED', 429);
  }

  control(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<DurableRun> {
    if (this.pendingControls >= 32) return Promise.reject(new ApplicationError('RUN_CAPACITY_REACHED', 429));
    this.pendingControls += 1;
    const task = (this.controls.get(id) ?? Promise.resolve()).catch(() => undefined)
      .then(() => this.controlRun(id, action));
    this.controls.set(id, task);
    return task.finally(() => {
      this.pendingControls -= 1;
      if (this.controls.get(id) === task) this.controls.delete(id);
    });
  }

  private async controlRun(id: string, action: 'pause' | 'resume' | 'cancel'): Promise<DurableRun> {
    if (this.closing) throw new ApplicationError('EXECUTOR_UNAVAILABLE', 503);
    let provider: DecisionProvider | undefined;
    if (action === 'resume') {
      this.checkCapacity();
      this.reservations += 1;
    }
    try {
      if (action === 'resume') {
        const previous = await this.repository.read(id);
        try { assertLifecycleTransition(previous.status, 'resume'); }
        catch { throw new ApplicationError('INVALID_LIFECYCLE_TRANSITION', 409); }
        provider = this.providerFactory(previous.configuration.initialVariant, previous.configuration.scenario.id, {
          providerId: previous.configuration.providerId, modelId: previous.configuration.modelId,
        });
        if (provider.id !== previous.configuration.providerId ||
            (provider.provenance?.model ?? null) !== previous.configuration.modelId) {
          throw new ApplicationError('PROVIDER_CONFIGURATION_CHANGED', 409);
        }
      }
      const run = await this.repository.lifecycle(id, action);
      this.workers.get(id)?.controller.abort();
      if (provider) {
        if (this.closing) {
          await this.repository.fail(run.id, run.revision, 'PROCESS_INTERRUPTED');
          throw new ApplicationError('EXECUTOR_UNAVAILABLE', 503);
        }
        this.launch(run, provider);
      }
      return run;
    } finally { if (action === 'resume') this.reservations -= 1; }
  }

  private launch(initial: DurableRun, provider: DecisionProvider): void {
    const controller = new AbortController();
    const worker = { controller, task: Promise.resolve() };
    this.workers.set(initial.id, worker);
    worker.task = this.execute(initial, provider, controller.signal).catch(() => {
      this.reportFailure('SIMULATION_WORKER_FAILURE');
    }).finally(() => {
      controller.abort();
      if (this.workers.get(initial.id) === worker) this.workers.delete(initial.id);
    });
  }

  private async execute(initial: DurableRun, provider: DecisionProvider, signal: AbortSignal): Promise<void> {
    let run = initial;
    try {
      while (run.status === 'RUNNING' && !signal.aborted) {
        const resolution = resolveNextStorylet(run.narrative, run.configuration.scenario);
        if (resolution.status !== 'eligible') {
          await this.repository.fail(run.id, run.revision, 'NARRATIVE_DEAD_END');
          return;
        }
        if (run.narrative.step >= run.configuration.scenario.maxTransitions) {
          await this.repository.fail(run.id, run.revision, 'DECISION_LIMIT');
          return;
        }
        const sequence = run.records.length + 1;
        run = await this.repository.startStep(run.id, run.revision);
        if (signal.aborted) return;
        const workflow = isBeginner(run.configuration.scenario);
        if (workflow && !isProposal(resolution.storylet)) {
          run = await this.repository.commitWorkflow(run.id, run.revision);
          continue;
        }
        // Advance only an in-memory preview to bind the proposal to the response gate.
        // Persisting it and applying any security effect remain separate transactions.
        const preview = workflow ? advanceNarrative(run.narrative, run.configuration.scenario, { outcomeId: 'recorded' }) : null;
        const decisionState = preview?.status === 'advanced' ? preview.state : run.narrative;
        const decisionResolution = resolveNextStorylet(decisionState, run.configuration.scenario);
        if (decisionResolution.status !== 'eligible') throw new ApplicationError('NARRATIVE_DEAD_END', 409);
        const raw = await requestDecision(provider, Object.freeze({
          runId: run.id, sequence, scenario: immutableDataSnapshot(run.configuration.scenario),
          state: immutableDataSnapshot(decisionState), selectedStorylet: immutableDataSnapshot(decisionResolution.storylet),
          eligibleStorylets: immutableDataSnapshot(getEligibleStorylets(decisionState, run.configuration.scenario)),
          eligibleStoryletIds: Object.freeze([...decisionResolution.eligibleStoryletIds]),
          records: immutableDataSnapshot(run.records), signal,
        }), { timeoutMs: run.configuration.decisionTimeoutMs, signal, sequence });
        if (signal.aborted) return;
        run = workflow ? await this.repository.commitWorkflow(run.id, run.revision, raw)
          : await this.repository.commitDecision(run.id, run.revision, run.narrative.version, raw);
      }
    } catch (error) {
      if (signal.aborted || error instanceof ApplicationError && error.statusCode === 409) return;
      const code = error instanceof SimulationError ? error.code
        : error instanceof RefereeValidationError ? 'INVALID_DECISION'
        : error instanceof RefereeError ? 'REFEREE_ERROR' : 'PERSISTENCE_OR_EXECUTION_FAILURE';
      try { await this.repository.fail(run.id, run.revision, code); }
      catch { this.reportFailure('DURABLE_FAILURE_WRITE_FAILED'); }
    }
  }

  async shutdown(): Promise<void> {
    this.abort();
    await Promise.allSettled([...this.creations, ...this.controls.values()]);
    const workers = [...this.workers.values()];
    workers.forEach((worker) => worker.controller.abort());
    await Promise.all(workers.map((worker) => worker.task));
    await this.repository.recover();
  }

  abort(): void {
    this.closing = true;
    this.workers.forEach((worker) => worker.controller.abort());
  }
}
