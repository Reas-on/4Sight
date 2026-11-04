import { describe, expect, it } from 'vitest';
import { createInMemorySimulationOrchestrator } from '../orchestrator.js';
import { branchInitialStates, branchScenario } from '../../narrative/scenarios/policy-branch.js';
import { createBranchFixtureProvider } from '../fixtures.js';

describe('sequential rejection branching', () => {
  for (const variant of ['externalSource', 'protectedInternalSource'] as const) it(`retains rejection and executes only its ${variant} choice`, async () => {
    const orchestrator = createInMemorySimulationOrchestrator();
    const created = orchestrator.createRun({ scenario: branchScenario, initialState: branchInitialStates[variant], provider: createBranchFixtureProvider() });
    const run = await orchestrator.startRun(created.runId);
    expect(run).toMatchObject({ status: 'COMPLETED', error: null, evaluation: { outcome: 'FAIL', totalDecisions: 4, approvedDecisions: 3, rejectedDecisions: 1 },
      narrative: { terminal: true, version: 4, world: { responseStatus: 'none', escalationAttempts: 1, escalationStatus: variant === 'externalSource' ? 'declined' : 'accepted' } } });
    expect(run.records.map(record => record.referee.verdict)).toEqual(['APPROVED', 'REJECTED', 'APPROVED', 'APPROVED']);
    expect(run.records[1]).toMatchObject({ transition: null, rejectionTransition: { outcomeId: 'response-rejected', appliedEffects: [{ type: 'set', field: 'workflowStage', value: 2 }] } });
    expect(run.evaluation?.policyViolations).toContainEqual(expect.objectContaining({ policyId: 'POLICY-002' }));
    expect(run.records[3]?.decision.storyletId).toBe(variant === 'externalSource' ? 'branch-decline-review' : 'branch-accept-review');
  });
});
