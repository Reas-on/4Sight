import type { Condition, Effect, ScenarioDefinition, StoryletDefinition, WorldState } from '../types.js';
import { sshBruteForceInitialStates } from './ssh-brute-force.js';

// Trusted mapping of 4sight_ssh_bruteforce_visual_scenario.json (proposal schema 1.0).
// Conditions are typed data, never evaluated JavaScript or imported expressions.
export const BEGINNER_SCENARIO_ID = 'ssh-login-investigation-beginner';
export const BEGINNER_SCENARIO_VERSION = '1.0.0';
export const beginnerNodes = [
  ['N-01', '1. Alert arrives', 'The system detects many failed SSH logins.', 'Something suspicious happened.', 'Detection'],
  ['N-02', '2. Collect facts', 'Read the source address, affected server and failed-login count.', 'What happened, where and how often?', 'Investigation'],
  ['N-03', '3. Check source', 'Determine whether the source is external or is a protected internal asset.', 'Is it safe to block this address?', 'Decision'],
  ['N-04', '4A. Propose IP block', 'AI proposes a simulated perimeter block for an external suspicious source.', 'AI suggests blocking the outside address.', 'Response'],
  ['N-05', '4B. Escalate to SOC', 'AI proposes notifying a security analyst rather than blocking a protected internal source.', 'Ask a human security analyst to review it.', 'Response'],
  ['N-06', '5. Referee checks', 'A deterministic policy checker approves or rejects the proposed action.', "Is the AI's suggestion allowed by the rules?", 'Validation'],
  ['N-07', '6A. Apply simulated response', 'Record the approved response in the scenario state. No real firewall or server is changed.', 'Practice the approved action safely.', 'Resolution'],
  ['N-08', '7. Save audit trail', 'Record the proposed decision, Referee verdict, state changes and timestamps.', 'Write down what happened and why.', 'Audit'],
  ['N-09', '8. Show results', 'Present the completed simulation, evaluated decisions and applicable rule adherence.', 'Show the final report.', 'Results'],
  ['N-10', '6B. Review rejected action', 'Do not apply a rejected action. Record the violation and route it for manual review.', 'The AI suggestion broke a rule; stop that action.', 'Resolution'],
] as const;
export const beginnerEdges = [
  ['N-01', 'N-02'], ['N-02', 'N-03'], ['N-03', 'N-04'], ['N-03', 'N-05'],
  ['N-04', 'N-06'], ['N-05', 'N-06'], ['N-06', 'N-07'], ['N-06', 'N-10'],
  ['N-07', 'N-08'], ['N-10', 'N-08'], ['N-08', 'N-09'],
] as const;
export const beginnerContext = {
  incident: 'A server received 25 unsuccessful SSH sign-in attempts within 2 minutes.',
  sourceId: '203.0.113.25', incidentId: 'demo-ssh-001', targetAsset: 'demo-web-server',
  failedLogins: 25, windowSeconds: 120,
};
export const beginnerInitialStates: Record<'externalSource' | 'protectedInternalSource', WorldState> = {
  externalSource: { ...sshBruteForceInitialStates.externalSource, threatConfidence: 93, workflowStage: 0 },
  protectedInternalSource: { ...sshBruteForceInitialStates.protectedInternalSource, assetClassification: 'server', assetProtected: false, threatConfidence: 93, workflowStage: 0 },
};
const eq = (field: 'workflowStage' | 'sourceClassification' | 'sourceProtected' | 'assetProtected' | 'responseStatus', value: number | string | boolean): Condition => ({ op: 'equals', field, value });
const stage = (value: number): Effect => ({ type: 'set', field: 'workflowStage', value });
const all = (...conditions: Condition[]): Condition => ({ op: 'all', conditions });
const internal: Condition = { op: 'any', conditions: [eq('sourceClassification', 'internal'), eq('sourceProtected', true), eq('assetProtected', true)] };
function node(id: string, nodeId: string, current: number, next: number, options: {
  condition?: Condition; action?: string; effects?: Effect[]; terminal?: boolean;
} = {}): StoryletDefinition {
  const metadata = beginnerNodes.find(item => item[0] === nodeId)!;
  return { id, graphNodeId: nodeId, description: `${metadata[2]} ${metadata[3]}`, priority: 100 - current,
    oneShot: true, terminal: options.terminal ?? false,
    preconditions: options.condition ? all(eq('workflowStage', current), options.condition) : eq('workflowStage', current),
    action: { id: options.action ?? 'record-workflow-step', description: metadata[2] },
    outcomes: [{ id: 'recorded', description: metadata[3], effects: [stage(next), ...(options.effects ?? []),
      { type: 'append', field: 'completedEvents', value: `event:${id}` }] }],
  };
}
export const beginnerScenario: ScenarioDefinition = {
  id: BEGINNER_SCENARIO_ID, title: 'Suspicious SSH Logins — Beginner Walkthrough',
  description: 'A server reports repeated failed logins, AI proposes a response, and an independent Referee checks it before the simulated incident is closed.',
  technique: 'T1110.001', maxTransitions: 10,
  storylets: [
    node('beginner-alert', 'N-01', 0, 1),
    node('beginner-facts', 'N-02', 1, 2),
    node('beginner-source', 'N-03', 2, 3, { effects: [{ type: 'set', field: 'incidentStatus', value: 'triaged' }] }),
    // Proposal stages never apply security effects. Referee checks the next eligible response storylet.
    node('beginner-propose-block', 'N-04', 3, 4, { condition: { op: 'not', condition: internal } }),
    node('beginner-propose-escalation', 'N-05', 3, 4, { condition: internal }),
    { ...node('beginner-block-response', 'N-06', 4, 5, { condition: { op: 'not', condition: internal }, action: 'block-source' }),
      outcomes: [{ id: 'block-approved', description: 'Authorize the proposed external block; application is a separate committed stage.', effects: [stage(5)] },
        { id: 'response-rejected', description: 'Withhold the proposed action and require manual review.', effects: [stage(6)] }] },
    { ...node('beginner-escalate-response', 'N-06', 4, 5, { condition: internal, action: 'escalate-soc' }),
      outcomes: [{ id: 'escalation-approved', description: 'Authorize SOC escalation; application is a separate committed stage.', effects: [stage(5)] },
        { id: 'response-rejected', description: 'Withhold the proposed action and require manual review.', effects: [stage(6)] }] },
    node('beginner-apply-block', 'N-07', 5, 7, { condition: { op: 'not', condition: internal }, effects: [
      { type: 'set', field: 'responseStatus', value: 'blocked' }, { type: 'set', field: 'incidentStatus', value: 'contained' }] }),
    node('beginner-apply-escalation', 'N-07', 5, 7, { condition: internal, effects: [
      { type: 'set', field: 'escalationStatus', value: 'requested' }, { type: 'increment', field: 'escalationAttempts', by: 1 },
      { type: 'set', field: 'incidentStatus', value: 'escalated' }, { type: 'set', field: 'responseStatus', value: 'escalated' }] }),
    node('beginner-review-rejection', 'N-10', 6, 7),
    node('beginner-audit', 'N-08', 7, 8),
    node('beginner-results', 'N-09', 8, 9, { terminal: true, condition: eq('responseStatus', 'blocked'),
      effects: [{ type: 'set', field: 'incidentStatus', value: 'resolved' }] }),
    node('beginner-escalated-results', 'N-09', 8, 9, { terminal: true, condition: eq('responseStatus', 'escalated') }),
    node('beginner-rejected-results', 'N-09', 8, 9, { terminal: true, condition: eq('responseStatus', 'none') }),
  ],
};
export const isBeginner = (scenario: Pick<ScenarioDefinition, 'id'>) => scenario.id === BEGINNER_SCENARIO_ID;
export const isProposal = (storylet: StoryletDefinition) => storylet.graphNodeId === 'N-04' || storylet.graphNodeId === 'N-05';
