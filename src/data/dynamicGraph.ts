import type { AuditEvent, DurableRun, ScenarioOption } from '../api/types';
import { projectGraph, type ScenarioGraphMetadata } from '../../backend/src/domain/simulation/graph-projection';
import type { GraphDataset, GraphEntity, StepStatus } from './graph';

export function scenarioMetadata(scenarios: ScenarioOption[], sourceId?: string): ScenarioGraphMetadata | null {
  if (!sourceId?.startsWith('backend:')) return null;
  const [, id, variant] = sourceId.split(':');
  const scenario = scenarios.find(item => item.id === id);
  return scenario?.graph?.[variant as 'externalSource' | 'protectedInternalSource'] ?? null;
}
export function dynamicGraph(metadata: ScenarioGraphMetadata | null, run: DurableRun | null, events: readonly AuditEvent[], preview?: { id: string; name: string; description: string }) {
  const root = metadata?.root ?? (preview ? { nodeId: 'PREVIEW', storyletId: preview.id, parentNodeId: null, status: 'PENDING' as const } : null);
  const projection = root ? projectGraph(root, events.filter(event => event.runId === run?.id), run?.graph) : { nodes: [], sequence: 0 };
  const definitions = metadata?.nodes ?? (preview ? [{ nodeId: 'PREVIEW', name: preview.name, description: preview.description }] : []);
  const nodes: GraphEntity[] = projection.nodes.map(node => {
    const definitionIndex = definitions.findIndex(item => item.nodeId === node.nodeId);
    const index = definitionIndex < 0 ? projection.nodes.findIndex(item => item.nodeId === node.nodeId) : definitionIndex;
    const definition = definitions[definitionIndex];
    return { id: node.nodeId, name: definition?.name ?? node.nodeId, description: definition?.description ?? '', kind: 'workflow',
      parentId: node.parentNodeId ?? node.nodeId, position: [index % 3 * 4.5, -Math.floor(index / 3) * 4.5, index % 2 * 1.5] };
  });
  const ids = new Set(nodes.map(node => node.id));
  const edges = projection.nodes.filter(node => node.parentNodeId && node.nodeId !== node.parentNodeId && ids.has(node.parentNodeId))
    .map(node => ({ source: node.parentNodeId!, target: node.nodeId, kind: 'workflow' as const }));
  const statusMap: Record<string, StepStatus> = { PENDING: 'ready', RUNNING: 'active', APPROVED: 'complete', REJECTED: 'rejected', SKIPPED: 'skipped', FAILED: 'failed' };
  const statuses = Object.fromEntries(projection.nodes.map(node => [node.nodeId,
    node.status === 'RUNNING' && run?.status === 'FAILED' ? 'failed' : node.status === 'RUNNING' && run?.status === 'CANCELLED' ? 'not-evaluated'
      : node.status === 'RUNNING' && run?.status === 'PAUSED' ? 'ready' : statusMap[node.status]])) as Record<string, StepStatus>;
  const dataset: GraphDataset = { nodes, edges, steps: nodes.map(node => ({ ...node, category: preview ? 'Preview only' : 'Workflow', technique: '', tool: 'Narrative Engine' })),
    nodeById: new Map(nodes.map(node => [node.id, node])), neighbors: new Map(nodes.map(node => [node.id, new Set(edges.flatMap(edge =>
      edge.source === node.id ? [edge.target] : edge.target === node.id ? [edge.source] : []))])) };
  return { dataset, statuses, activeNodeId: run?.status === 'RUNNING' ? projection.nodes.find(node => node.status === 'RUNNING')?.nodeId ?? null : null };
}
