import { describe, expect, it } from 'vitest';
import { dynamicGraph } from './dynamicGraph';
import { graphMetadata, projectGraph, type ProjectedNode } from '../../backend/src/domain/simulation/graph-projection';
import { branchScenario, branchInitialStates } from '../../backend/src/domain/narrative/scenarios/policy-branch';
import { beginnerScenario, beginnerInitialStates } from '../../backend/src/domain/narrative/scenarios/ssh-beginner';
import { eventFixture, runFixture } from '../api/testFixtures';

describe('authoritative dynamic graph', () => {
  const metadata = graphMetadata(branchScenario, branchInitialStates.protectedInternalSource);
  const n2: ProjectedNode = { nodeId: 'N-02', storyletId: 'branch-unsafe-block', parentNodeId: 'N-01', status: 'PENDING' };
  it('initializes exactly one scenario-derived entry and resets across selections', () => {
    for (const meta of [metadata, graphMetadata(beginnerScenario, beginnerInitialStates.externalSource)]) {
      const graph = dynamicGraph(meta, null, []);
      expect(graph.dataset.nodes.map(node => node.id)).toEqual([meta.root.nodeId]);
      expect(graph.dataset.edges).toEqual([]);
    }
    expect(dynamicGraph(null, null, []).dataset.nodes).toEqual([]);
    const preview = dynamicGraph(null, null, [], { id: 'import:one', name: 'Untrusted', description: 'Preview only' });
    expect(preview.dataset.nodes).toHaveLength(1);
    expect(preview.dataset.steps[0].category).toBe('Preview only');
  });
  it('deduplicates, orders and rejects stale or cross-run projection updates', () => {
    const reveal = { ...eventFixture(1), eventType: 'graph.revealed', nodeId: null, payload: { nodes: [n2, n2] } };
    const verdict = { ...eventFixture(2), nodeId: 'N-02', eventType: 'decision.evaluated', payload: { verdict: 'REJECTED' } };
    const graph = projectGraph(metadata.root, [verdict, reveal, reveal]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[1].status).toBe('REJECTED');
    const snapshot = { ...runFixture(), configuration: { ...runFixture().configuration, scenario: branchScenario }, graph };
    const projected = dynamicGraph(metadata, snapshot, [reveal, { ...verdict, runId: 'other-run' }]);
    expect(projected.statuses['N-02']).toBe('rejected');
    expect(projected.dataset.edges).toEqual([{ source: 'N-01', target: 'N-02', kind: 'workflow' }]);
    expect(dynamicGraph(metadata, snapshot, []).dataset).toEqual(projected.dataset);
  });
});
