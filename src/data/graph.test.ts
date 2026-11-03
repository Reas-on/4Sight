import { describe, expect, it } from "vitest";
import { graph, neighbors, nodeById, statusFor, steps } from "./graph";

describe("graph integrity", () => {
  it("keeps precisely five stable executable states and a valid directed workflow", () => {
    expect(steps.map((s) => s.id)).toEqual([
      "N-01",
      "N-02",
      "N-03",
      "N-04",
      "N-05",
    ]);
    expect(graph.nodes.filter((n) => n.kind === "workflow")).toHaveLength(5);
    expect(graph.edges.filter((e) => e.kind === "workflow")).toEqual(
      steps.slice(1).map((s, i) => ({
        source: steps[i].id,
        target: s.id,
        kind: "workflow",
      })),
    );
  });
  it("has unique namespaced metadata IDs and valid relationships", () => {
    expect(new Set(graph.nodes.map((n) => n.id)).size).toBe(graph.nodes.length);
    graph.nodes
      .filter((n) => n.kind === "metadata")
      .forEach((n) => {
        expect(n.id.startsWith("M-")).toBe(true);
        expect(steps.some((s) => s.id === n.parentId)).toBe(true);
      });
    graph.edges.forEach((e) => {
      expect(nodeById.has(e.source)).toBe(true);
      expect(nodeById.has(e.target)).toBe(true);
      expect(e.source).not.toBe(e.target);
      expect(neighbors.get(e.source)?.has(e.target)).toBe(true);
    });
  });
  it("has finite, balanced, nondegenerate 3D coordinates", () => {
    for (let axis = 0; axis < 3; axis++) {
      const coords = graph.nodes.map((n) => n.position[axis]);
      expect(coords.every(Number.isFinite)).toBe(true);
      expect(
        Math.abs(coords.reduce((sum, v) => sum + v, 0) / coords.length),
      ).toBeLessThan(0.00001);
      expect(Math.max(...coords) - Math.min(...coords)).toBeGreaterThan(8);
    }
  });
  it("keeps all statuses unevaluated until a local demonstration advances", () => {
    steps.forEach((s) => expect(statusFor(s.id, -1)).toBe("ready"));
    expect(statusFor("N-01", 0)).toBe("active");
    expect(statusFor("N-01", 1)).toBe("complete");
    expect(statusFor("N-02", 1)).toBe("active");
  });
});
