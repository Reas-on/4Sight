import { describe, expect, it } from "vitest";
import { nodeColor } from "./nodeColors";
describe("existing category color hierarchy", () => {
  it("gives workflow categories distinct muted colors and metadata neutral gray", () => {
    expect(
      new Set(
        ["N-01", "N-02", "N-03", "N-04", "N-05"].map((id) => nodeColor(id, -1)),
      ).size,
    ).toBe(5);
    expect(nodeColor("M-1-01", -1)).toBe(0x7e8d99);
  });
  it("uses demo completion green without inventing evaluated or failure states", () => {
    expect(nodeColor("N-01", 1)).toBe(0x8bb69c);
    expect(nodeColor("N-02", 1)).toBe(0xc4ac80);
    expect(nodeColor("M-1-01", 5)).toBe(0x7e8d99);
  });
});
