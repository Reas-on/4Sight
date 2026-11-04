import { expect, it } from 'vitest';
import { GraphRevealMotion, NODE_ENTRANCE_MS } from './GraphRevealMotion';

it('reveals child scale/opacity and parent edge once, without replay or snapshot animation', () => {
  const motion = new GraphRevealMotion();
  const root = { id: 'N-01', parentId: 'N-01' };
  const child = { id: 'N-02', parentId: 'N-01' };
  motion.register('run-1', [root], [], 0, false);
  motion.register('run-1', [root, child], ['N-02'], 100, false);
  expect(motion.sample('N-02', 100, false)).toMatchObject({ scale: 0.7, opacity: 0, edge: 0 });
  expect(motion.sample('N-01', 100, false).emphasis).toBe(1);
  const middle = motion.sample('N-02', 200, false);
  expect(middle.scale).toBeGreaterThan(0.7); expect(middle.scale).toBeLessThan(1);
  expect(middle.edge).toBeGreaterThan(middle.opacity);
  expect(motion.sample('N-02', 100 + NODE_ENTRANCE_MS, false)).toMatchObject({ scale: 1, opacity: 1, edge: 1 });
  motion.register('run-1', [root, child], ['N-02', 'N-02'], 500, false);
  expect(motion.count).toBe(1);
  expect(motion.sample('N-02', 500, false).progress).toBe(1);
  motion.register('restored-run', [root, child], [], 600, false);
  expect(motion.count).toBe(0);
  motion.register('retry', [root], [], 700, false);
  motion.register('retry', [root, child], ['N-02'], 800, false);
  expect(motion.count).toBe(1);
});
it('respects reduced motion and settles large bursts immediately', () => {
  const motion = new GraphRevealMotion();
  const nodes = Array.from({ length: 20 }, (_, i) => ({ id: `N-${i}`, parentId: 'N-0' }));
  motion.register('burst', nodes, nodes.map(node => node.id), 0, false);
  expect(motion.count).toBe(0);
  motion.register('reduced', nodes.slice(0, 2), ['N-1'], 100, true);
  expect(motion.sample('N-1', 100, true)).toMatchObject({ scale: 1, opacity: 1, edge: 1, emphasis: 0 });
});
