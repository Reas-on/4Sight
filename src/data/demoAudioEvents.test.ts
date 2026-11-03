import { describe, expect, it } from "vitest";
import { demoAudioEvents } from "./demoAudioEvents";
describe("actual demo state audio events", () => {
  it("maps enter, consecutive completion and final completion distinctly", () => {
    expect(demoAudioEvents(-1, 0)).toEqual([
      { event: "NODE_ENTERED", nodeId: "N-01" },
    ]);
    expect(demoAudioEvents(0, 1)).toEqual([
      { event: "NODE_COMPLETED", nodeId: "N-01" },
      { event: "NODE_ENTERED", nodeId: "N-02" },
    ]);
    expect(demoAudioEvents(4, 5)).toEqual([
      { event: "NODE_COMPLETED", nodeId: "N-05" },
      { event: "SIMULATION_COMPLETED" },
    ]);
  });
  it("does not treat skipped, reset or paused nodes as successful", () => {
    expect(demoAudioEvents(0, 3)).toEqual([
      { event: "NODE_ENTERED", nodeId: "N-04" },
    ]);
    expect(demoAudioEvents(1, 1)).toEqual([]);
    expect(demoAudioEvents(3, -1)).toEqual([]);
    expect(demoAudioEvents(5, 0)).toEqual([
      { event: "NODE_ENTERED", nodeId: "N-01" },
    ]);
  });
});
