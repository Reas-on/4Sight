import { beginnerNodes, isBeginner } from '../narrative/scenarios/ssh-beginner.js';
import { BRANCH_SCENARIO_ID } from '../narrative/scenarios/policy-branch.js';
import { initializeScenario, resolveNextStorylet } from '../narrative/engine.js';
import type { NarrativeState, ScenarioDefinition, WorldState } from '../narrative/types.js';

export type GraphStatus = 'PENDING' | 'RUNNING' | 'APPROVED' | 'REJECTED' | 'SKIPPED' | 'FAILED';
export interface ProjectedNode {
  nodeId: string; storyletId: string; parentNodeId: string | null; status: GraphStatus;
}
export interface GraphProjection { sequence: number; nodes: ProjectedNode[] }
export interface ScenarioGraphMetadata { root: ProjectedNode; nodes: { nodeId: string; name: string; description: string }[] }
export function graphMetadata(scenario: ScenarioDefinition, initial: WorldState): ScenarioGraphMetadata {
  const entry = resolveNextStorylet(initializeScenario(scenario, initial), scenario);
  if (entry.status !== 'eligible') throw new Error('Scenario has no entry');
  return { root: { nodeId: entry.storylet.graphNodeId ?? entry.storylet.id, storyletId: entry.storylet.id, parentNodeId: null, status: 'PENDING' },
    nodes: [...new Map(scenario.storylets.map(storylet => {
      const nodeId = storylet.graphNodeId ?? storylet.id;
      const beginner = isBeginner(scenario) ? beginnerNodes.find(node => node[0] === nodeId) : null;
      const branchNames: Record<string, string> = { 'N-01': 'Triage alert', 'N-02': 'Prohibited internal block', 'N-03': 'Independent SOC escalation',
        'N-04': 'Accept analyst review', 'N-05': 'Decline analyst review' };
      return [nodeId, { nodeId, name: beginner?.[1] ?? (scenario.id === BRANCH_SCENARIO_ID ? branchNames[nodeId] : storylet.action.description) ?? nodeId,
        description: storylet.description }] as const;
    })).values()] };
}
/** Topology only: eligibility and branch decisions stay in the Narrative Engine. */
export function graphReveals(scenario: ScenarioDefinition, state: NarrativeState, parentNodeId: string): ProjectedNode[] {
  const next = resolveNextStorylet(state, scenario);
  if (next.status !== 'eligible') return [];
  const reveal = (storyletId: string, parent = parentNodeId): ProjectedNode => {
    const storylet = scenario.storylets.find(item => item.id === storyletId)!;
    return { nodeId: storylet.graphNodeId ?? storylet.id, storyletId, parentNodeId: parent, status: 'PENDING' };
  };
  const nodes = [reveal(next.storylet.id)];
  if (scenario.id === BRANCH_SCENARIO_ID && parentNodeId === 'N-02') {
    nodes.push(reveal('branch-accept-review'), reveal('branch-decline-review'));
  }
  if (scenario.id === BRANCH_SCENARIO_ID && state.world.workflowStage === 3) {
    const alternative = next.storylet.id === 'branch-accept-review' ? 'branch-decline-review' : 'branch-accept-review';
    nodes[0]!.parentNodeId = 'N-02';
    nodes.push({ ...reveal(alternative, 'N-02'), status: 'SKIPPED' });
  }
  return nodes;
}
export function projectGraph(root: ProjectedNode, events: readonly { sequence: number; eventType: string; storyletId?: string | null; nodeId: string | null; payload: Record<string, unknown> }[], initial?: GraphProjection): GraphProjection {
  const nodes = new Map((initial?.nodes ?? [root]).map(node => [node.nodeId, { ...node }]));
  let sequence = initial?.sequence ?? 0;
  let previousNodeId = [...nodes.values()].reverse().find(node => node.status === 'APPROVED' || node.status === 'REJECTED')?.nodeId ?? root.nodeId;
  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (event.sequence <= sequence) continue;
    sequence = event.sequence;
    // Existing persisted runs predate reveal events. Their committed starts are
    // sufficient to reconstruct the actually visited path without a migration.
    if (event.eventType === 'step.started' && event.nodeId && event.storyletId && !nodes.has(event.nodeId)) {
      nodes.set(event.nodeId, { nodeId: event.nodeId, storyletId: event.storyletId, parentNodeId: previousNodeId, status: 'PENDING' });
    }
    if (event.eventType === 'graph.revealed') for (const node of event.payload.nodes as ProjectedNode[]) {
      const previous = nodes.get(node.nodeId);
      if (!previous || node.status === 'SKIPPED') nodes.set(node.nodeId, { ...node });
    }
    const node = event.nodeId ? nodes.get(event.nodeId) : event.storyletId ? [...nodes.values()].find(node => node.storyletId === event.storyletId) : undefined;
    if (!node) continue;
    if (event.eventType === 'step.started') {
      node.status = 'RUNNING';
      if (event.storyletId) node.storyletId = event.storyletId;
    }
    if (event.eventType === 'decision.evaluated') node.status = event.payload.verdict as GraphStatus;
    if (event.eventType === 'transition.committed') {
      if (node.status !== 'REJECTED') node.status = 'APPROVED';
      previousNodeId = node.nodeId;
    }
  }
  return { sequence, nodes: [...nodes.values()] };
}
