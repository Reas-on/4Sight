import type { Condition, Effect, ScenarioDefinition, StoryletDefinition } from '../types.js';
import { sshBruteForceInitialStates } from './ssh-brute-force.js';

export const BRANCH_SCENARIO_ID = 'policy-rejection-branches';
const eq = (field: 'workflowStage' | 'sourceProtected', value: number | boolean): Condition => ({ op: 'equals', field, value });
const stage = (value: number): Effect => ({ type: 'set', field: 'workflowStage', value });
function step(id: string, graphNodeId: string, current: number, action: string, effects: Effect[], terminal = false): StoryletDefinition {
  return { id, graphNodeId, description: id.replaceAll('-', ' '), priority: 100 - current, oneShot: true, terminal,
    preconditions: eq('workflowStage', current), action: { id: action, description: id.replaceAll('-', ' ') },
    outcomes: [{ id: 'recorded', description: 'Record the approved simulated action.', effects }] };
}
export const branchInitialStates = {
  externalSource: { ...sshBruteForceInitialStates.protectedInternalSource, assetProtected: false, sourceProtected: false, workflowStage: 0 },
  protectedInternalSource: { ...sshBruteForceInitialStates.protectedInternalSource, workflowStage: 0 },
};
export const branchScenario: ScenarioDefinition = {
  id: BRANCH_SCENARIO_ID, title: 'Policy Rejection — Alternative Responses', technique: 'T1110.001', maxTransitions: 5,
  description: 'Sequential triage, a prohibited internal-source block, independent SOC escalation and one deterministic follow-up. All actions are simulated.',
  storylets: [
    step('branch-triage', 'N-01', 0, 'triage-alert', [stage(1), { type: 'set', field: 'incidentStatus', value: 'triaged' }]),
    { ...step('branch-unsafe-block', 'N-02', 1, 'block-source', [stage(2), { type: 'set', field: 'responseStatus', value: 'blocked' }]),
      rejectionOutcomeId: 'response-rejected', outcomes: [
        { id: 'recorded', description: 'Apply the proposed block only if the Referee approves.', effects: [stage(2), { type: 'set', field: 'responseStatus', value: 'blocked' }] },
        { id: 'response-rejected', description: 'Withhold the block and continue the independent workflow.', effects: [stage(2)] },
      ] },
    step('branch-independent-escalation', 'N-03', 2, 'escalate-soc', [stage(3),
      { type: 'set', field: 'incidentStatus', value: 'escalated' }, { type: 'set', field: 'escalationStatus', value: 'requested' },
      { type: 'increment', field: 'escalationAttempts', by: 1 }]),
    ...([true, false] as const).map(protectedSource => ({
      ...step(protectedSource ? 'branch-accept-review' : 'branch-decline-review', protectedSource ? 'N-04' : 'N-05', 3,
        'acknowledge-escalation', [stage(4), { type: 'set', field: 'escalationStatus', value: protectedSource ? 'accepted' : 'declined' }], true),
      preconditions: { op: 'all' as const, conditions: [eq('workflowStage', 3), eq('sourceProtected', protectedSource)] },
    })),
  ],
};
