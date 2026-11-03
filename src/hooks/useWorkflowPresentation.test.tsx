import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { useWorkflowPresentation, workflowPresentation, WORKFLOW_FRAME_MS } from "./useWorkflowPresentation";
import { beginnerGraph } from "../data/graph";
import { scenarioSources } from "../data/backendPresentation";
import { runFixture, idOne } from "../api/testFixtures";
import type { AuditEvent, DurableRun } from "../api/types";
import { beginnerScenario, beginnerInitialStates, beginnerEdges } from "../../backend/src/domain/narrative/scenarios/ssh-beginner";
import NodeDetails from "../components/NodeDetails";
import { GraphCameraController } from "../components/GraphCameraController";
import { advanceNarrative, initializeScenario } from "../../backend/src/domain/narrative/engine";
import { evaluateDecision } from "../../backend/src/domain/referee/evaluator";

function fixture(rejected = false) {
  let state = initializeScenario(beginnerScenario, rejected ? beginnerInitialStates.protectedInternalSource : beginnerInitialStates.externalSource);
  for (let index = 0; index < 4; index++) {
    const next = advanceNarrative(state, beginnerScenario, { outcomeId: "recorded" });
    if (next.status === "advanced") state = next.state;
  }
  const proposal = { decisionId: "demo-decision", providerId: "gemini", actionType: "perimeter_block" as const,
    storyletId: rejected ? "beginner-escalate-response" : "beginner-block-response", outcomeId: rejected ? "escalation-approved" : "block-approved",
    parameters: { sourceId: "203.0.113.25" }, reasoning: "The outside address repeatedly failed to sign in." };
  const referee = evaluateDecision(proposal, state, beginnerScenario);
  const run: DurableRun = { ...runFixture(idOne, "COMPLETED"),
    configuration: { ...runFixture().configuration, scenario: beginnerScenario, providerId: "gemini", modelId: "gemini-2.5-flash" },
    narrative: state, records: [{ sequence: 1, decision: proposal, referee, transition: null, recordedAt: new Date().toISOString() }],
    workflow: { proposal, transitions: [] },
  };
  const path = ["N-01", "N-02", "N-03", rejected ? "N-05" : "N-04", "N-06", rejected ? "N-10" : "N-07", "N-08", "N-09"];
  const events: AuditEvent[] = [];
  function event(eventType: string, nodeId: string | null, payload = {}) {
    events.push({ id: `event-${events.length}`, runId: idOne, sequence: events.length + 1, eventType, nodeId,
      storyletId: null, stateVersion: 0, payload, createdAt: new Date().toISOString() });
  }
  for (const nodeId of path) {
    event("step.started", nodeId);
    if (nodeId === "N-04" || nodeId === "N-05") event("decision.proposed", nodeId, { proposal, availableActions: ["perimeter_block", "soc_escalation"] });
    if (nodeId === "N-06") event("decision.evaluated", nodeId, { verdict: referee.verdict });
    event("transition.committed", nodeId);
  }
  event("run.finished", null);
  return { run, events, path };
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("beginner workflow presentation and explanation", () => {
  it("keeps reference topology, finite stable positions and backend-executable Explorer entries", () => {
    expect(beginnerGraph.steps).toHaveLength(10);
    expect(beginnerGraph.edges.filter(edge => edge.kind === "workflow").map(edge => [edge.source, edge.target])).toEqual(beginnerEdges);
    expect(beginnerGraph.nodes.every(node => node.position.every(Number.isFinite))).toBe(true);
    const sources = scenarioSources([{ id: beginnerScenario.id, title: beginnerScenario.title, version: "1.0.0", initialVariants: ["externalSource", "protectedInternalSource"] }]);
    expect(sources).toHaveLength(2);
    expect(sources[0].originalFormat).toBe("Backend executable scenario");
    expect(sources[0].rawContent).toContain("N-10");
  });

  it.each([false, true])("presents every committed branch node in order without losing fast events (rejected=%s)", rejected => {
    vi.useFakeTimers();
    const { run, events, path } = fixture(rejected);
    const { result } = renderHook(() => useWorkflowPresentation(run, events));
    expect(result.current?.ready).toBe(false);
    for (const node of path) {
      expect(result.current?.activeNodeId).toBe(node);
      act(() => vi.advanceTimersByTime(WORKFLOW_FRAME_MS));
    }
    expect(result.current?.ready).toBe(true);
    expect(result.current?.statuses[rejected ? "N-04" : "N-05"]).toBe("skipped");
    expect(result.current?.statuses[rejected ? "N-07" : "N-10"]).toBe("skipped");
    expect(result.current?.statuses["N-06"]).toBe(rejected ? "rejected" : "complete");
  });

  it("cannot progress without a committed event and hides future verdicts", () => {
    vi.useFakeTimers();
    const { run, events } = fixture();
    const { result, rerender } = renderHook(({ feed }) => useWorkflowPresentation(run, feed), { initialProps: { feed: events.slice(0, 1) } });
    act(() => vi.advanceTimersByTime(10000));
    expect(result.current?.activeNodeId).toBe("N-01");
    expect(result.current?.verdict).toBeUndefined();
    rerender({ feed: events });
    act(() => vi.advanceTimersByTime(WORKFLOW_FRAME_MS));
    expect(result.current?.activeNodeId).toBe("N-02");
  });

  it("feeds the existing camera controller each active ID and preserves manual interruption", () => {
    const { run, events, path } = fixture();
    const camera = new PerspectiveCamera(40, 1.5, 0.1, 200); camera.position.set(0, 1, 40);
    const controller = new GraphCameraController(camera, id => {
      const node = beginnerGraph.nodeById.get(id); return node ? new Vector3(...node.position) : undefined;
    }, () => 40, 15);
    controller.initializeDistance(40);
    path.forEach((id, index) => {
      const frame = workflowPresentation(run, events, index);
      controller.syncExecution(`${idOne}:${frame.frameSequence}`, frame.activeNodeId, true, false);
      for (let i = 0; i < 45; i++) controller.update(1 / 60, performance.now(), false, false);
      expect(controller.target.distanceTo(new Vector3(...beginnerGraph.nodeById.get(id)!.position))).toBeLessThan(1e-10);
    });
    controller.beginManualControl(); controller.pan(0.01, 0.02); controller.endManualControl();
    const manual = controller.target.clone();
    const last = workflowPresentation(run, events, path.length - 1);
    controller.syncExecution(`${idOne}:${last.frameSequence}`, last.activeNodeId, true, false);
    controller.update(1, performance.now(), false, false);
    expect(controller.target.equals(manual)).toBe(true);
  });

  it("renders persisted proposal explanations and independent rejection policy messages in the Inspector", () => {
    const { run, events } = fixture(true);
    const frame = workflowPresentation(run, events, 5);
    const view = render(<NodeDetails id="N-10" dataset={beginnerGraph} run={run} events={frame.visibleEvents}
      nodeStatuses={frame.statuses} demoIndex={5} onSelect={() => undefined} />);
    expect(view.getByRole("heading", { name: "6B. Review rejected action" })).toBeTruthy();
    expect(view.getByTestId("node-execution-evidence").textContent).toContain("REJECTED");
    expect(view.getByTestId("node-execution-evidence").textContent).toContain("POLICY-002");
    expect(view.getByTestId("node-execution-evidence").textContent).toContain("Direct blocking of a protected or internal source is prohibited.");
    expect(view.getByTestId("node-execution-evidence").textContent).toContain("Supporting information only.");
    view.rerender(<NodeDetails id="N-04" dataset={beginnerGraph} run={run} events={events} nodeStatuses={frame.statuses} demoIndex={5} onSelect={() => undefined} />);
    expect(view.queryByText("AI proposal")).toBeNull();
    expect(view.getByText("This branch was not selected. No action was executed here.")).toBeTruthy();
  });
});
