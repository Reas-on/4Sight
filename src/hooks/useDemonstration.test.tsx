import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDemonstration, DEMO_STEP_DURATION } from "./useDemonstration";
import {
  demoReducer,
  initialDemo,
  executedNodes,
  type RunConfiguration,
  type AuditEvent,
} from "../data/demoLifecycle";
import { steps } from "../data/graph";

const configuration: RunConfiguration = {
  sourceId: "builtin:endpoint-compromise",
  sourceName: "Endpoint compromise",
  agent: "demo-runner",
  additionalContext: "",
};
describe("single demo/results lifecycle", () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "performance", "Date"],
    }),
  );
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });
  const advance = () => act(() => vi.advanceTimersByTime(DEMO_STEP_DURATION));
  const finish = () => {
    for (let i = 0; i < steps.length; i++) advance();
  };
  it("records actual completed path, fixture metrics and chronological elapsed times, then opens results", () => {
    const { result } = renderHook(() =>
      useDemonstration(null, configuration, () => {}),
    );
    act(() => result.current.run());
    finish();
    expect(result.current.simulationStatus).toBe("completed");
    expect(result.current.isResultsOpen).toBe(true);
    const evaluation = result.current.evaluationResult!;
    expect(evaluation.overall).toBe("FULL PASS");
    expect(evaluation.backendVerified).toBe(false);
    expect(evaluation.simulated).toBe(true);
    expect(evaluation.totalSteps).toBe(5);
    expect(evaluation.executedNodeIds).toEqual(steps.map((step) => step.id));
    expect(
      evaluation.auditTrail
        .filter((event) => event.kind === "completed")
        .map((event) => event.subject),
    ).toEqual(steps.map((step) => step.id));
    expect(evaluation.auditTrail.at(-1)?.elapsedMs).toBe(8000);
    expect(
      evaluation.auditTrail.every(
        (entry, i, list) => i === 0 || entry.elapsedMs >= list[i - 1].elapsedMs,
      ),
    ).toBe(true);
    act(() => result.current.setResultsOpen(false));
    const snapshot = result.current.evaluationResult;
    act(() => result.current.run());
    expect(result.current.running).toBe(false);
    expect(result.current.evaluationResult).toBe(snapshot);
    act(() => result.current.toggleResults());
    expect(result.current.isResultsOpen).toBe(true);
    expect(result.current.evaluationResult).toBe(snapshot);
  });
  it("pause/resume preserves progress; stop keeps reset-to-idle semantics", () => {
    const stopAudio = vi.fn();
    const { result } = renderHook(() =>
      useDemonstration(null, configuration, stopAudio),
    );
    act(() => result.current.run());
    advance();
    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.demoIndex).toBe(1);
    act(() => result.current.run());
    advance();
    expect(result.current.demoIndex).toBe(2);
    act(() => result.current.stop());
    advance();
    expect(result.current.demoIndex).toBe(-1);
    expect(result.current.evaluationResult).toBeNull();
    expect(result.current.auditTrail).toEqual([]);
    expect(stopAudio).toHaveBeenCalled();
  });
  it("retry clears prior output, starts fresh exactly once and snapshots latest config", () => {
    const { result, rerender } = renderHook(
      ({ config }) => useDemonstration(null, config, () => {}),
      { initialProps: { config: configuration } },
    );
    act(() => result.current.run());
    finish();
    const old = result.current.evaluationResult!;
    rerender({ config: { ...configuration, agent: "none" } });
    act(() => {
      result.current.retry();
      result.current.retry();
      result.current.retry();
    });
    expect(result.current.runId).toBe(old.runId + 1);
    expect(result.current.demoIndex).toBe(0);
    expect(result.current.isResultsOpen).toBe(false);
    expect(result.current.evaluationResult).toBeNull();
    expect(result.current.auditTrail).toHaveLength(2);
    advance();
    expect(result.current.demoIndex).toBe(1);
    act(() => result.current.retry());
    expect(result.current.demoIndex).toBe(1);
    for (let i = 1; i < steps.length; i++) advance();
    expect(result.current.evaluationResult?.configuration.agent).toBe("none");
    expect(result.current.evaluationResult?.totalSteps).toBe(5);
    expect(result.current.evaluationResult?.runId).not.toBe(old.runId);
  });
  it("execution guard blocks retry/start and unmount cancels outstanding work", () => {
    const { result, unmount } = renderHook(() =>
      useDemonstration("unsupported", configuration, () => {}),
    );
    act(() => {
      result.current.run();
      result.current.retry();
    });
    advance();
    expect(result.current.runId).toBe(0);
    unmount();
    const next = renderHook(() =>
      useDemonstration(null, configuration, () => {}),
    );
    act(() => next.result.current.run());
    next.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stale timer tokens, duplicate ticks and canceled runs cannot advance or leak prior results", () => {
    const first = demoReducer(initialDemo, {
      type: "start",
      at: 100,
      iso: "first",
      configuration,
    });
    const tick = {
      type: "tick" as const,
      runId: first.runId,
      index: 0,
      at: 1700,
      iso: "tick",
    };
    const advanced = demoReducer(first, tick);
    expect(demoReducer(advanced, tick)).toBe(advanced);
    const stopped = demoReducer(advanced, { type: "stop" });
    const retry = demoReducer(stopped, {
      type: "start",
      retry: true,
      at: 2000,
      iso: "second",
      configuration,
    });
    expect(demoReducer(retry, tick)).toBe(retry);
  });
  it("executed count excludes skipped, entered-only and duplicated branch entries", () => {
    const trail: AuditEvent[] = [
      {
        id: 0,
        elapsedMs: 0,
        subject: "N-01",
        kind: "completed",
        outcome: "PASS",
        description: "executed",
      },
      {
        id: 1,
        elapsedMs: 1,
        subject: "branch-unused",
        kind: "skipped",
        outcome: "SKIPPED",
        description: "not selected",
      },
      {
        id: 2,
        elapsedMs: 2,
        subject: "N-02",
        kind: "entered",
        outcome: "INFO",
        description: "not completed",
      },
      {
        id: 3,
        elapsedMs: 3,
        subject: "N-01",
        kind: "completed",
        outcome: "PASS",
        description: "same identity",
      },
    ];
    expect(executedNodes(trail)).toEqual(["N-01"]);
  });
});
