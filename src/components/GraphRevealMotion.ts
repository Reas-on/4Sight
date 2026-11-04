export const NODE_ENTRANCE_MS = 360;
type RevealNode = { id: string; parentId: string };
const easeOut = (value: number) => 1 - (1 - Math.max(0, Math.min(1, value))) ** 3;

/** Visual state only, driven by the renderer's existing animation loop. */
export class GraphRevealMotion {
  private identity = '';
  private seen = new Set<string>();
  private entrances = new Map<string, number>();
  private parents = new Map<string, number>();
  count = 0;

  register(identity: string, nodes: readonly RevealNode[], liveIds: readonly string[], now: number, reduced: boolean) {
    if (identity !== this.identity) {
      this.identity = identity; this.seen.clear(); this.entrances.clear(); this.parents.clear(); this.count = 0;
    }
    const eligible = new Set(liveIds);
    const added = nodes.filter(node => !this.seen.has(node.id));
    for (const node of added) {
      this.seen.add(node.id);
      // Recovered snapshots and large bursts settle immediately; topology and
      // authoritative statuses never wait for motion.
      if (reduced || added.length > 12 || !eligible.has(node.id)) continue;
      this.entrances.set(node.id, now); this.count++;
      if (node.parentId !== node.id) this.parents.set(node.parentId, now);
    }
    if (reduced) { this.entrances.clear(); this.parents.clear(); }
  }

  sample(id: string, now: number, reduced: boolean) {
    const start = this.entrances.get(id);
    const elapsed = start === undefined || reduced ? NODE_ENTRANCE_MS : Math.max(0, now - start);
    const progress = Math.min(1, elapsed / NODE_ENTRANCE_MS);
    const child = start === undefined || reduced ? 1 : easeOut((elapsed - 40) / (NODE_ENTRANCE_MS - 40));
    const parentStart = this.parents.get(id);
    const emphasis = parentStart === undefined || reduced ? 0 : 1 - easeOut((now - parentStart) / NODE_ENTRANCE_MS);
    if (progress === 1) this.entrances.delete(id);
    if (!emphasis) this.parents.delete(id);
    return { progress, opacity: child, scale: 0.7 + child * 0.3,
      edge: easeOut(elapsed / (NODE_ENTRANCE_MS * 0.8)), emphasis };
  }
}
