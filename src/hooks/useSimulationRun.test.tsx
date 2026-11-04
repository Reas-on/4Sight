import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSimulationRun } from "./useSimulationRun";
import { ApiError, validate } from "../api/client";
import type { SimulationApi } from "../api/simulation";
import type { AuditEvent, DurableRun, RunInput } from "../api/types";
import type { EventConsumer } from "../api/events";
import { eventFixture, idOne, idTwo, runFixture } from "../api/testFixtures";
import { nodePresentation } from "../data/backendPresentation";

const input: RunInput = { scenarioId: "ssh-brute-force", initialVariant: "externalSource", providerId: "fixture", modelId: null, additionalContext: "" };
function harness(initial = runFixture()) {
  let current = initial;
  const callbacks: ((event: AuditEvent) => Promise<void>)[] = [];
  const api: SimulationApi = {
    scenarios: vi.fn(), models: vi.fn(), result: vi.fn(),
    create: vi.fn(async () => current), snapshot: vi.fn(async () => current),
    control: vi.fn(async (_id, action) => { current = { ...current, status: action === "pause" ? "PAUSED" : action === "resume" ? "RUNNING" : "CANCELLED", revision: current.revision + 1 }; return current; }),
  };
  const consume: EventConsumer = vi.fn(async (_id, after, signal, onEvent) => {
    callbacks.push(onEvent);
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    return after;
  });
  return { api, consume, callbacks, set: (run: DurableRun) => { current = run; } };
}

beforeEach(() => sessionStorage.clear());
afterEach(cleanup);
describe("authoritative frontend run integration", () => {
  it('does not block the SSE reader on snapshot fetches for intermediate events', async () => {
    const h = harness();
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, h.consume));
    act(() => result.current.run());
    await waitFor(() => expect(h.callbacks).toHaveLength(1));
    const calls = vi.mocked(h.api.snapshot).mock.calls.length;
    await act(async () => {
      await h.callbacks[0]({ ...eventFixture(1), eventType: 'graph.revealed', payload: { nodes: [] } });
      await h.callbacks[0](eventFixture(2));
      await h.callbacks[0]({ ...eventFixture(3), eventType: 'transition.committed' });
    });
    expect(result.current.events.map(event => event.sequence)).toEqual([1, 2, 3]);
    expect(h.api.snapshot).toHaveBeenCalledTimes(calls);
  });
  it('blocks presentation switching for active/paused runs and detaches completed runs without backend cancellation', async () => {
    const h = harness();
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, h.consume));
    act(() => result.current.run());
    await waitFor(() => expect(h.callbacks).toHaveLength(1));
    act(() => expect(result.current.clearPresentation()).toBe(false));
    act(() => result.current.pause());
    await waitFor(() => expect(result.current.snapshot?.status).toBe('PAUSED'));
    act(() => expect(result.current.clearPresentation()).toBe(false));
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.snapshot?.status).toBe('CANCELLED'));
    const calls = vi.mocked(h.api.control).mock.calls.length;
    act(() => expect(result.current.clearPresentation()).toBe(true));
    expect(result.current.snapshot).toBeNull();
    expect(result.current.events).toEqual([]);
    expect(result.current.runId).toBeNull();
    expect(h.api.control).toHaveBeenCalledTimes(calls);
  });
  it("creates one backend run and drives node/results from persisted evidence, not timers", async () => {
    const h = harness();
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, h.consume));
    act(() => { result.current.run(); result.current.run(); });
    await waitFor(() => expect(h.callbacks).toHaveLength(1));
    expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot?.id).toBe(idOne);
    await act(async () => h.callbacks[0](eventFixture()));
    expect(nodePresentation(result.current.snapshot, result.current.events).activeNodeId).toBe("N-01");
    h.set(runFixture(idOne, "COMPLETED"));
    await act(async () => h.callbacks[0]({ ...eventFixture(2, idOne, "run.finished"), payload: { status: "COMPLETED", outcome: "PASS", reasonCode: "RUN_COMPLETED" } }));
    expect(result.current.snapshot?.evaluation?.outcome).toBe("PASS");
    expect(result.current.isResultsOpen).toBe(true);
    expect(nodePresentation(result.current.snapshot, result.current.events).statuses["N-02"]).toBe("skipped");
    act(() => result.current.toggleResults());
    expect(result.current.isResultsOpen).toBe(false);
    act(() => result.current.toggleResults());
    expect(result.current.isResultsOpen).toBe(true);
    expect(h.api.create).toHaveBeenCalledTimes(1);
  });

  it("waits for pause confirmation and resumes the same run", async () => {
    const h = harness();
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, h.consume));
    act(() => result.current.run());
    await waitFor(() => expect(result.current.running).toBe(true));
    let resolve!: (run: DurableRun) => void;
    vi.mocked(h.api.control).mockImplementationOnce(() => new Promise((settle) => { resolve = settle; }));
    act(() => result.current.pause());
    expect(result.current.snapshot?.status).toBe("RUNNING");
    const paused = { ...runFixture(), status: "PAUSED" as const, revision: 3 };
    h.set(paused);
    await act(async () => resolve(paused));
    expect(result.current.snapshot?.status).toBe("PAUSED");
    act(() => result.current.run());
    await waitFor(() => expect(h.api.control).toHaveBeenCalledWith(idOne, "resume", expect.any(AbortSignal)));
    expect(h.api.create).toHaveBeenCalledTimes(1);
  });

  it("cancels stale progression and retry creates a fresh ID without prior events/results", async () => {
    const h = harness();
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, h.consume));
    act(() => result.current.run());
    await waitFor(() => expect(h.callbacks).toHaveLength(1));
    const stale = h.callbacks[0];
    act(() => result.current.stop());
    await waitFor(() => expect(result.current.snapshot?.status).toBe("CANCELLED"));
    await act(async () => stale(eventFixture()));
    expect(result.current.events).toHaveLength(0);
    h.set(runFixture(idTwo));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.runId).toBe(idTwo));
    await act(async () => stale(eventFixture(99)));
    expect(result.current.snapshot?.evaluation).toBeNull();
    expect(result.current.events).toEqual([]);
    expect(result.current.isResultsOpen).toBe(false);
    expect(h.api.create).toHaveBeenCalledTimes(2);
    expect(sessionStorage.getItem("4sight.backend-run-id")).toBe(idTwo);
    expect(JSON.stringify(sessionStorage)).not.toContain("accessToken");
  });

  it("restores a persisted completed run without creating another and ignores duplicates", async () => {
    sessionStorage.setItem("4sight.backend-run-id", idOne);
    const h = harness(runFixture(idOne, "COMPLETED"));
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, h.consume));
    await waitFor(() => expect(result.current.isResultsOpen).toBe(true));
    await act(async () => { await h.callbacks[0](eventFixture()); await h.callbacks[0](eventFixture()); });
    expect(result.current.events).toHaveLength(1);
    expect(h.api.create).not.toHaveBeenCalled();
  });

  it("clears a missing saved run and shows backend failure without fabricated PASS", async () => {
    sessionStorage.setItem("4sight.backend-run-id", idOne);
    const h = harness();
    vi.mocked(h.api.snapshot).mockRejectedValue(new ApiError("RUN_NOT_FOUND", 404));
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, h.consume));
    await waitFor(() => expect(result.current.error).toContain("unavailable"));
    expect(result.current.snapshot).toBeNull();
    expect(sessionStorage.getItem("4sight.backend-run-id")).toBeNull();
    vi.mocked(h.api.create).mockRejectedValue(new ApiError("PROVIDER_NOT_CONFIGURED", 503));
    act(() => result.current.run());
    await waitFor(() => expect(result.current.error).toContain("PROVIDER NOT CONFIGURED"));
    expect(result.current.isResultsOpen).toBe(false);
  });

  it("uses generated backend schema validation for malformed responses", () => {
    expect(validate("run", runFixture())).toBeTruthy();
    expect(() => validate("run", { status: "COMPLETED", evaluation: { outcome: "PASS" } })).toThrow(ApiError);
  });

  it("reconnects from the last committed sequence and reconciles persisted terminal state", async () => {
    const h = harness();
    let connections = 0;
    const consume: EventConsumer = vi.fn(async (_id, after, signal, onEvent) => {
      connections++;
      if (connections === 1) {
        await onEvent(eventFixture());
        throw new ApiError("BACKEND_UNAVAILABLE");
      }
      expect(after).toBe(1);
      h.set({ ...runFixture(idOne, "COMPLETED"), eventSequence: 2 });
      await onEvent({ ...eventFixture(2, idOne, "run.finished"), payload: { status: "COMPLETED", outcome: "PASS", reasonCode: "RUN_COMPLETED" } });
      return 2;
    });
    const { result } = renderHook(() => useSimulationRun(input, null, h.api, consume));
    act(() => result.current.run());
    await waitFor(() => expect(result.current.snapshot?.status).toBe("COMPLETED"), { timeout: 2500 });
    expect(result.current.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(result.current.liveGraph).toBe(false);
    expect(h.api.create).toHaveBeenCalledTimes(1);
    expect(result.current.isResultsOpen).toBe(true);
  });

  it("does not silently resume old configuration after the user changes scenario selection", async () => {
    sessionStorage.setItem("4sight.backend-run-id", idOne);
    const h = harness({ ...runFixture(), status: "PAUSED" });
    const { result } = renderHook(() => useSimulationRun({ ...input, initialVariant: "protectedInternalSource" }, null, h.api, h.consume));
    await waitFor(() => expect(result.current.snapshot?.status).toBe("PAUSED"));
    act(() => result.current.run());
    await waitFor(() => expect(result.current.error).toContain("Selection changed"));
    expect(h.api.control).not.toHaveBeenCalled();
    expect(h.api.create).not.toHaveBeenCalled();
  });
});
