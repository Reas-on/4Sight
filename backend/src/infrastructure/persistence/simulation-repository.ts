import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { and, asc, eq, gt } from 'drizzle-orm';
import * as tables from '../../db/schema.js';
import { advanceNarrative, initializeScenario, resolveNextStorylet } from '../../domain/narrative/engine.js';
import { beginnerContext, isBeginner, isProposal } from '../../domain/narrative/scenarios/ssh-beginner.js';
import { evaluateDecision } from '../../domain/referee/evaluator.js';
import type { TransitionRecord } from '../../domain/narrative/types.js';
import type { ProposedDecision } from '../../domain/referee/types.js';
import { redact } from '../../ai/prompt.js';
import { validateNarrativeState } from '../../domain/narrative/schemas.js';
import { DEFAULT_REFEREE_POLICY_SET } from '../../domain/referee/policies.js';
import { validateProposedDecision } from '../../domain/referee/schemas.js';
import { assertLifecycleTransition, isTerminalStatus, type SimulationLifecycleAction } from '../../domain/simulation/lifecycle.js';
import { buildSimulationEvaluation } from '../../domain/simulation/evaluation.js';
import { evaluateSimulationStep } from '../../domain/simulation/step.js';
import type { SimulationEvaluationOutcome, SimulationStatus } from '../../domain/simulation/types.js';
import { ApplicationError, type AuditEvent, type DurableRun, type RunConfiguration, type SimulationRepository } from '../../application/simulation/contracts.js';
import { TransactionManager, type Transaction } from './transaction-manager.js';
import { scenarioRegistry } from '../../domain/narrative/scenarios/registry.js';
import { graphMetadata, graphReveals, projectGraph } from '../../domain/simulation/graph-projection.js';

type RunRow = typeof tables.simulationRuns.$inferSelect;
const tokenHash = (value: string): string => createHash('sha256').update(value).digest('hex');

export class PostgresSimulationRepository implements SimulationRepository {
  constructor(private readonly transactions: TransactionManager) {}

  private async row(tx: Transaction, id: string, lock = false): Promise<RunRow> {
    const query = tx.select().from(tables.simulationRuns).where(eq(tables.simulationRuns.id, id));
    const [row] = await (lock ? query.for('update') : query);
    if (!row) throw new ApplicationError('RUN_NOT_FOUND', 404);
    return row;
  }

  private async hydrate(tx: Transaction, row: RunRow, finalizing = false): Promise<DurableRun> {
    const [snapshot] = await tx.select().from(tables.simulationSnapshots).where(and(
      eq(tables.simulationSnapshots.runId, row.id), eq(tables.simulationSnapshots.stateVersion, row.currentStateVersion),
    ));
    if (!snapshot) throw new ApplicationError('SNAPSHOT_MISSING', 500);
    const records = await tx.select().from(tables.simulationDecisions)
      .where(eq(tables.simulationDecisions.runId, row.id)).orderBy(asc(tables.simulationDecisions.stepSequence));
    const [evaluation] = await tx.select().from(tables.simulationEvaluations).where(eq(tables.simulationEvaluations.runId, row.id));
    const allEvents = await tx.select().from(tables.simulationEvents)
      .where(eq(tables.simulationEvents.runId, row.id)).orderBy(asc(tables.simulationEvents.sequence));
    const workflowEvents = isBeginner(row.configuration.scenario) ? allEvents : null;
    const workflow = workflowEvents ? {
      proposal: (workflowEvents.find(event => event.eventType === 'decision.proposed')?.payload.proposal ?? null) as ProposedDecision | null,
      transitions: workflowEvents.filter(event => event.eventType === 'transition.committed').map(event => event.payload.transition as TransitionRecord),
    } : undefined;
    if (workflow) {
      let replay = initializeScenario(row.configuration.scenario, snapshot.narrative.initialWorld);
      for (const transition of workflow.transitions) {
        const gate = resolveNextStorylet(replay, row.configuration.scenario);
        const record = records[0]?.record;
        if (gate.status !== 'eligible' || gate.storylet.id !== transition.storyletId) throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
        if (gate.storylet.graphNodeId === 'N-06') {
          if (!workflow.proposal || !record || !isDeepStrictEqual(record.decision, workflow.proposal) ||
              !isDeepStrictEqual(record.referee, evaluateDecision(workflow.proposal, replay, row.configuration.scenario)) ||
              transition.outcomeId !== (record.referee.approved ? record.decision.outcomeId : 'response-rejected') ||
              record.referee.approved && !isDeepStrictEqual(record.transition, transition) ||
              !record.referee.approved && record.transition !== null) throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
        }
        const next = advanceNarrative(replay, row.configuration.scenario, { storyletId: transition.storyletId, outcomeId: transition.outcomeId });
        if (next.status !== 'advanced' || !isDeepStrictEqual(next.record, transition)) throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
        replay = next.state;
      }
      if (!isDeepStrictEqual(replay, snapshot.narrative)) throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
    }
    if (row.configuration.scenario.storylets.some(storylet => storylet.rejectionOutcomeId)) {
      let replay = initializeScenario(row.configuration.scenario, snapshot.narrative.initialWorld);
      for (const { record } of records) {
        const verified = evaluateSimulationStep(record.decision, replay, row.configuration.scenario,
          DEFAULT_REFEREE_POLICY_SET, record.sequence, record.recordedAt);
        if (verified.error || !isDeepStrictEqual(verified.record, record)) throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
        replay = verified.state;
      }
      if (!isDeepStrictEqual(replay, snapshot.narrative)) throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
    }
    if (!finalizing && isTerminalStatus(row.status) !== Boolean(evaluation)) {
      throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
    }
    if (snapshot.narrative.version !== row.currentStateVersion || snapshot.narrative.step !== row.currentStep ||
        snapshot.narrative.scenarioId !== row.scenarioId || records.some((item, index) => item.stepSequence !== index + 1) ||
        (workflow ? workflow.transitions.length : records.filter((item) => item.record.transition !== null || item.record.rejectionTransition).length) !== row.currentStateVersion ||
        evaluation && (evaluation.evaluation.status !== row.status || evaluation.evaluation.finalStateVersion !== row.currentStateVersion)) {
      throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500);
    }
    if (evaluation) {
      try {
        const verified = buildSimulationEvaluation({
          runId: row.id, scenario: row.configuration.scenario, provider: {}, status: row.status,
          narrative: snapshot.narrative, records: records.map((item) => item.record),
          startedAt: row.startedAt, policySet: DEFAULT_REFEREE_POLICY_SET,
          ...(workflow ? { workflowTransitions: workflow.transitions } : {}),
        }, evaluation.evaluation.outcome, evaluation.evaluation.reasonCode, evaluation.evaluation.summary, evaluation.createdAt);
        if (verified.outcome !== row.evaluationOutcome || verified.totalDecisions !== evaluation.evaluation.totalDecisions ||
            verified.approvedDecisions !== evaluation.evaluation.approvedDecisions || verified.rejectedDecisions !== evaluation.evaluation.rejectedDecisions) {
          throw new Error('Counts differ');
        }
      } catch { throw new ApplicationError('PERSISTED_EVIDENCE_MISMATCH', 500); }
    }
    return {
      id: row.id, configuration: row.configuration, status: row.status, revision: row.revision,
      eventSequence: row.eventSequence, narrative: validateNarrativeState(snapshot.narrative),
      records: records.map((item) => item.record), evaluation: evaluation?.evaluation ?? null,
      error: row.failure, createdAt: row.createdAt, startedAt: row.startedAt,
      completedAt: row.completedAt, updatedAt: row.updatedAt,
      ...(workflow ? { workflow } : {}),
      graph: projectGraph(graphMetadata(row.configuration.scenario, snapshot.narrative.initialWorld).root, allEvents),
    };
  }

  private async append(tx: Transaction, row: RunRow, type: string, payload: Record<string, unknown>,
    storyletId: string | null = null, nodeId: string | null = null): Promise<void> {
    row.eventSequence += 1;
    await tx.insert(tables.simulationEvents).values({
      id: randomUUID(), runId: row.id, sequence: row.eventSequence, eventType: type,
      stateVersion: row.currentStateVersion, storyletId, nodeId, payload,
    });
  }

  private async saveRow(tx: Transaction, row: RunRow): Promise<void> {
    await tx.update(tables.simulationRuns).set({
      status: row.status, evaluationOutcome: row.evaluationOutcome,
      currentStateVersion: row.currentStateVersion, currentStep: row.currentStep,
      revision: row.revision + 1, eventSequence: row.eventSequence,
      startedAt: row.startedAt, completedAt: row.completedAt, failure: row.failure,
      updatedAt: new Date().toISOString(),
    }).where(eq(tables.simulationRuns.id, row.id));
  }

  private async finish(tx: Transaction, row: RunRow, status: SimulationStatus,
    outcome: SimulationEvaluationOutcome, code: string): Promise<void> {
    row.status = status;
    row.evaluationOutcome = outcome;
    row.completedAt = new Date().toISOString();
    const run = await this.hydrate(tx, row, true);
    const evaluation = buildSimulationEvaluation({
      runId: row.id, scenario: row.configuration.scenario,
      provider: row.modelId ? { provenance: { provider: row.providerId, model: row.modelId } } : {},
      status, records: run.records, narrative: run.narrative,
      startedAt: row.startedAt, policySet: DEFAULT_REFEREE_POLICY_SET,
      ...(run.workflow ? { workflowTransitions: run.workflow.transitions } : {}),
    }, outcome, code, code, row.completedAt);
    await tx.insert(tables.simulationEvaluations).values({ runId: row.id, evaluation });
    await this.append(tx, row, 'run.finished', { status, outcome, reasonCode: code });
  }

  create(configuration: RunConfiguration, token: string): Promise<DurableRun> {
    return this.transactions.transaction(async (tx) => {
      const initial = scenarioRegistry.find(entry => entry.scenario.id === configuration.scenario.id)?.initialStates[configuration.initialVariant];
      if (!initial) throw new ApplicationError('SCENARIO_NOT_FOUND', 404);
      const narrative = initializeScenario(configuration.scenario, initial);
      const id = randomUUID();
      const [row] = await tx.insert(tables.simulationRuns).values({
        id, accessHash: tokenHash(token), scenarioId: configuration.scenario.id,
        scenarioVersion: configuration.scenarioVersion, providerId: configuration.providerId,
        modelId: configuration.modelId, status: 'CREATED', configuration,
      }).returning();
      if (!row) throw new ApplicationError('RUN_CREATE_FAILED', 500);
      await tx.insert(tables.simulationSnapshots).values({ id: randomUUID(), runId: id, stateVersion: 0, narrative });
      await this.append(tx, row, 'run.created', { status: 'CREATED' });
      await this.append(tx, row, 'graph.revealed', { nodes: [graphMetadata(configuration.scenario, initial).root] });
      await this.saveRow(tx, row);
      return this.hydrate(tx, await this.row(tx, id));
    });
  }

  read(id: string): Promise<DurableRun> {
    return this.transactions.transaction(async (tx) => this.hydrate(tx, await this.row(tx, id)));
  }

  authorize(id: string, token: string): Promise<void> {
    return this.transactions.transaction(async (tx) => {
      const row = await this.row(tx, id);
      if (Date.parse(row.accessExpiresAt) <= Date.now() ||
          !timingSafeEqual(Buffer.from(row.accessHash, 'hex'), Buffer.from(tokenHash(token), 'hex'))) {
        throw new ApplicationError('RUN_NOT_FOUND', 404);
      }
    });
  }

  lifecycle(id: string, action: SimulationLifecycleAction): Promise<DurableRun> {
    return this.transactions.transaction(async (tx) => {
      const row = await this.row(tx, id, true);
      try { assertLifecycleTransition(row.status, action); }
      catch { throw new ApplicationError('INVALID_LIFECYCLE_TRANSITION', 409); }
      if (action === 'cancel') await this.finish(tx, row, 'CANCELLED', 'INCONCLUSIVE', 'RUN_CANCELLED');
      else {
        row.status = action === 'pause' ? 'PAUSED' : 'RUNNING';
        if (!row.startedAt) row.startedAt = new Date().toISOString();
        await this.append(tx, row, `run.${action}`, { status: row.status });
      }
      await this.saveRow(tx, row);
      return this.hydrate(tx, await this.row(tx, id));
    });
  }

  commitDecision(id: string, revision: number, stateVersion: number, decision: unknown): Promise<DurableRun> {
    return this.transactions.transaction(async (tx) => {
      const row = await this.row(tx, id, true);
      if (isBeginner(row.configuration.scenario)) throw new ApplicationError('WORKFLOW_COMMIT_REQUIRED', 409);
      if (row.status !== 'RUNNING' || row.revision !== revision || row.currentStateVersion !== stateVersion) {
        throw new ApplicationError('STALE_RUN_REVISION', 409);
      }
      const run = await this.hydrate(tx, row);
      const proposed = validateProposedDecision(decision);
      const selected = resolveNextStorylet(run.narrative, row.configuration.scenario);
      const decisionId = `run-${id}-step-${run.records.length + 1}`;
      const result = evaluateSimulationStep({ ...proposed, providerId: row.providerId, decisionId }, run.narrative, row.configuration.scenario,
        DEFAULT_REFEREE_POLICY_SET, run.records.length + 1, new Date().toISOString());
      const record = { ...result.record, decision: {
        decisionId: result.record.decision.decisionId, providerId: row.providerId,
        actionType: result.record.decision.actionType, storyletId: result.record.decision.storyletId,
        outcomeId: result.record.decision.outcomeId,
        ...(proposed.parameters ? { parameters: Object.fromEntries(Object.entries(proposed.parameters)
          .map(([key, value]) => [key, `sha256:${tokenHash(value)}`])) } : {}),
      } };
      await tx.insert(tables.simulationDecisions).values({
        id: randomUUID(), runId: id, stepSequence: record.sequence,
        providerId: row.providerId, modelId: row.modelId, record,
      });
      await this.append(tx, row, 'decision.evaluated', {
        decisionSequence: record.sequence, verdict: record.referee.verdict,
        violatedPolicyIds: record.referee.violatedPolicies.map((policy) => policy.policyId),
      }, selected.status === 'eligible' ? selected.storylet.id : record.decision.storyletId,
        selected.status === 'eligible' ? selected.storylet.graphNodeId ?? selected.storylet.id : null);
      const committedTransition = record.transition ?? record.rejectionTransition;
      if (committedTransition) {
        await tx.insert(tables.simulationSnapshots).values({ id: randomUUID(), runId: id,
          stateVersion: result.state.version, narrative: result.state });
        row.currentStateVersion = result.state.version;
        row.currentStep = result.state.step;
        await this.append(tx, row, 'transition.committed', { transition: committedTransition },
          committedTransition.storyletId, committedTransition.graphNodeId ?? null);
        await this.append(tx, row, 'graph.revealed', { nodes: graphReveals(row.configuration.scenario, result.state,
          committedTransition.graphNodeId ?? committedTransition.storyletId) });
      }
      if (!record.referee.approved && !record.rejectionTransition) await this.finish(tx, row, 'COMPLETED', 'FAIL', 'POLICY_REJECTION');
      else if (result.error) {
        row.failure = { code: result.error.code, message: 'Narrative transition failed.', phase: 'narrative' };
        await this.finish(tx, row, 'FAILED', 'INCONCLUSIVE', 'NARRATIVE_ERROR');
      } else if (result.state.terminal) {
        const rejected = !record.referee.approved || run.records.some(item => !item.referee.approved);
        await this.finish(tx, row, 'COMPLETED', rejected ? 'FAIL' : 'PASS', rejected ? 'POLICY_REJECTION' : 'RUN_COMPLETED');
      }
      await this.saveRow(tx, row);
      return this.hydrate(tx, await this.row(tx, id));
    });
  }

  commitWorkflow(id: string, revision: number, rawProposal?: unknown): Promise<DurableRun> {
    return this.transactions.transaction(async (tx) => {
      const row = await this.row(tx, id, true);
      if (!isBeginner(row.configuration.scenario) || row.status !== 'RUNNING' || row.revision !== revision) {
        throw new ApplicationError('STALE_RUN_REVISION', 409);
      }
      const run = await this.hydrate(tx, row);
      const resolution = resolveNextStorylet(run.narrative, row.configuration.scenario);
      if (resolution.status !== 'eligible') throw new ApplicationError('NARRATIVE_DEAD_END', 409);
      const storylet = resolution.storylet;
      let outcomeId = 'recorded';
      let decisionRecord: import('../../domain/simulation/types.js').SimulationRecord | undefined;
      if (isProposal(storylet)) {
        // Validate before committing any proposal-stage effect. Only known simulated
        // identifiers and a bounded public explanation leave the backend.
        const proposed = validateProposedDecision(rawProposal);
        const parameters = proposed.parameters ? Object.fromEntries(Object.entries(proposed.parameters).map(([key, value]) =>
          [key, value === beginnerContext.sourceId || value === beginnerContext.incidentId ? value : `sha256:${tokenHash(value)}`])) : undefined;
        const proposal = validateProposedDecision({ ...proposed, decisionId: `run-${id}-step-1`, providerId: row.providerId,
          ...(parameters ? { parameters } : {}),
          ...(proposed.reasoning ? { reasoning: redact(proposed.reasoning, [process.env.GEMINI_API_KEY ?? '']).slice(0, 600) } : {}),
        });
        await this.append(tx, row, 'decision.proposed', { proposal,
          context: { incident: beginnerContext.incident, targetAsset: beginnerContext.targetAsset,
            sourceClassification: run.narrative.world.sourceClassification, sourceProtected: run.narrative.world.sourceProtected,
            assetProtected: run.narrative.world.assetProtected, threatConfidence: run.narrative.world.threatConfidence },
          availableActions: ['perimeter_block', 'soc_escalation'],
        }, storylet.id, storylet.graphNodeId ?? null);
      } else if (storylet.graphNodeId === 'N-06') {
        const proposal = run.workflow?.proposal;
        if (!proposal) throw new ApplicationError('PROPOSAL_MISSING', 500);
        const referee = evaluateDecision(proposal, run.narrative, row.configuration.scenario);
        outcomeId = referee.approved ? proposal.outcomeId : 'response-rejected';
        decisionRecord = { sequence: 1, decision: proposal, referee, transition: null, recordedAt: new Date().toISOString() };
      } else if (storylet.graphNodeId === 'N-07') {
        if (run.records.length !== 1 || !run.records[0]?.referee.approved || !run.records[0].transition) {
          throw new ApplicationError('APPROVED_RESPONSE_REQUIRED', 409);
        }
      } else if (storylet.graphNodeId === 'N-10' && (run.records.length !== 1 || run.records[0]?.referee.approved)) {
        throw new ApplicationError('REJECTED_RESPONSE_REQUIRED', 409);
      }
      const applied = advanceNarrative(run.narrative, row.configuration.scenario, { storyletId: storylet.id, outcomeId });
      if (applied.status !== 'advanced') throw new ApplicationError('NARRATIVE_NOT_ADVANCED', 500);
      if (decisionRecord) {
        decisionRecord = { ...decisionRecord, transition: decisionRecord.referee.approved ? applied.record : null };
        await tx.insert(tables.simulationDecisions).values({ id: randomUUID(), runId: id, stepSequence: 1,
          providerId: row.providerId, modelId: row.modelId, record: decisionRecord });
        await this.append(tx, row, 'decision.evaluated', { decisionSequence: 1, verdict: decisionRecord.referee.verdict,
          violatedPolicyIds: decisionRecord.referee.violatedPolicies.map(policy => policy.policyId) }, storylet.id, 'N-06');
      }
      await tx.insert(tables.simulationSnapshots).values({ id: randomUUID(), runId: id,
        stateVersion: applied.state.version, narrative: applied.state });
      row.currentStateVersion = applied.state.version;
      row.currentStep = applied.state.step;
      await this.append(tx, row, 'transition.committed', { transition: applied.record }, storylet.id, storylet.graphNodeId ?? null);
      await this.append(tx, row, 'graph.revealed', { nodes: graphReveals(row.configuration.scenario, applied.state, storylet.graphNodeId ?? storylet.id) });
      if (applied.state.terminal) {
        const rejected = run.records.some(record => !record.referee.approved);
        await this.finish(tx, row, 'COMPLETED', rejected ? 'FAIL' : 'PASS', rejected ? 'POLICY_REJECTION' : 'RUN_COMPLETED');
      }
      await this.saveRow(tx, row);
      return this.hydrate(tx, await this.row(tx, id));
    });
  }

  startStep(id: string, revision: number): Promise<DurableRun> {
    return this.transactions.transaction(async (tx) => {
      const row = await this.row(tx, id, true);
      if (row.status !== 'RUNNING' || row.revision !== revision) throw new ApplicationError('STALE_RUN_REVISION', 409);
      const run = await this.hydrate(tx, row);
      const next = resolveNextStorylet(run.narrative, row.configuration.scenario);
      if (next.status !== 'eligible') throw new ApplicationError('NARRATIVE_DEAD_END', 409);
      await this.append(tx, row, 'step.started', { decisionSequence: run.records.length + 1 },
        next.storylet.id, next.storylet.graphNodeId ?? null);
      await this.saveRow(tx, row);
      return this.hydrate(tx, await this.row(tx, id));
    });
  }

  fail(id: string, revision: number, code: string): Promise<DurableRun> {
    return this.transactions.transaction(async (tx) => {
      const row = await this.row(tx, id, true);
      if (row.revision !== revision || row.status !== 'RUNNING') throw new ApplicationError('STALE_RUN_REVISION', 409);
      row.failure = { code, message: 'Simulation execution failed.',
        phase: code.startsWith('PROVIDER_') || code === 'INVALID_AI_OUTPUT' || code === 'MODEL_NOT_FOUND' || code === 'DECISION_TIMEOUT'
          ? 'provider' : 'orchestrator' };
      await this.finish(tx, row, 'FAILED', 'INCONCLUSIVE', code);
      await this.saveRow(tx, row);
      return this.hydrate(tx, await this.row(tx, id));
    });
  }

  events(id: string, after: number, limit = 50): Promise<readonly AuditEvent[]> {
    return this.transactions.transaction(async (tx) => tx.select().from(tables.simulationEvents)
      .where(and(eq(tables.simulationEvents.runId, id), gt(tables.simulationEvents.sequence, after)))
      .orderBy(asc(tables.simulationEvents.sequence)).limit(Math.min(50, Math.max(1, limit))));
  }

  recover(): Promise<number> {
    return this.transactions.transaction(async (tx) => {
      const rows = await tx.select().from(tables.simulationRuns).where(eq(tables.simulationRuns.status, 'RUNNING')).for('update');
      for (const row of rows) {
        if (isTerminalStatus(row.status)) continue;
        row.failure = { code: 'PROCESS_INTERRUPTED', message: 'Executor stopped before completion.', phase: 'orchestrator' };
        await this.finish(tx, row, 'FAILED', 'INCONCLUSIVE', 'PROCESS_INTERRUPTED');
        await this.saveRow(tx, row);
      }
      return rows.length;
    });
  }
}
