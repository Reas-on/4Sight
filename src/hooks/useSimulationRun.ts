import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, isTerminal } from "../api/client";
import { consumeRunEvents, type EventConsumer } from "../api/events";
import { simulationApi, type SimulationApi } from "../api/simulation";
import type { AuditEvent, DurableRun, RunInput } from "../api/types";

const STORAGE_KEY = "4sight.backend-run-id";
const savedRun = () => { try { const id = sessionStorage.getItem(STORAGE_KEY); return id && /^[a-f0-9-]{36}$/i.test(id) ? id : null; } catch { return null; } };
const saveRun = (id: string | null) => { try { if (id) sessionStorage.setItem(STORAGE_KEY, id); else sessionStorage.removeItem(STORAGE_KEY); } catch { /* Session recovery optional. */ } };
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
  const timer = setTimeout(done, ms); signal.addEventListener("abort", done, { once: true });
});

export function useSimulationRun(input: RunInput | null, executionBlock: string | null,
  api: SimulationApi = simulationApi, consume: EventConsumer = consumeRunEvents) {
  const [runId, setRunId] = useState<string | null>(savedRun);
  const [snapshot, setSnapshot] = useState<DurableRun | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [liveGraph, setLiveGraph] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [isResultsOpen, setResultsOpen] = useState(false);
  const [subscriptionEpoch, setSubscriptionEpoch] = useState(0);
  const latest = useRef({ input, executionBlock, snapshot }); latest.current = { input, executionBlock, snapshot };
  const generation = useRef(0);
  const activeId = useRef(runId); activeId.current = runId;
  const mounted = useRef(true);
  const busy = useRef(false);
  const streamAbort = useRef<AbortController | null>(null);
  const operationAbort = useRef<AbortController | null>(null);

  const accept = useCallback((run: DurableRun) => {
    if (!mounted.current || run.id !== activeId.current) return;
    setSnapshot((previous) => {
      if (previous?.id === run.id && (previous.revision > run.revision || isTerminal(previous.status) && !isTerminal(run.status))) return previous;
      return run;
    });
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; streamAbort.current?.abort(); operationAbort.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController(); streamAbort.current = controller;
    const { signal } = controller;
    let cursor = 0;
    let reconciling: Promise<DurableRun> | null = null;
    const reconcile = () => {
      if (!reconciling) reconciling = api.snapshot(runId, signal).then((run) => { if (!signal.aborted) accept(run); return run; }).finally(() => { reconciling = null; });
      return reconciling;
    };
    const timer = setInterval(() => { void reconcile().catch(() => undefined); }, 2000);
    void (async () => {
      let retries = 0;
      while (!signal.aborted) {
        try {
          await reconcile();
          cursor = await consume(runId, cursor, signal, async (event) => {
            if (signal.aborted || activeId.current !== runId) return;
            if (event.runId !== runId) return;
            setEvents((previous) => previous.some((item) => item.sequence === event.sequence) ? previous : [...previous, event].sort((a, b) => a.sequence - b.sequence));
            cursor = Math.max(cursor, event.sequence);
            // Do not stall the SSE reader behind snapshot round-trips. A snapshot
            // may already be several steps ahead of the event being delivered.
            if (event.eventType === "run.finished") void reconcile().catch(() => undefined);
          });
          const current = await reconcile();
          if (signal.aborted) return;
          setError(null); retries = 0;
          if (isTerminal(current.status) && cursor >= current.eventSequence) return;
        } catch (failure) {
          if (signal.aborted) return;
          // After a gap, hydrate topology from the latest durable snapshot rather
          // than replaying missed entrances or waiting on a broken stream.
          setLiveGraph(false);
          if (failure instanceof ApiError && [401, 404].includes(failure.status)) {
            saveRun(null); setRunId(null); setSnapshot(null); setEvents([]);
            setError("Saved run is unavailable or access expired."); return;
          }
          setError(failure instanceof ApiError && ["INVALID_BACKEND_RESPONSE", "INVALID_EVENT_STREAM"].includes(failure.code)
            ? "Backend response validation failed — execution evidence is unavailable." : "Connection interrupted — reconnecting to the persisted run.");
          retries++;
        }
        await sleep(Math.min(500 * 2 ** Math.min(retries, 3), 5000), signal);
      }
    })().finally(() => clearInterval(timer));
    return () => { clearInterval(timer); controller.abort(); };
  }, [runId, subscriptionEpoch, api, consume, accept]);

  useEffect(() => {
    if (snapshot?.evaluation && isTerminal(snapshot.status)) setResultsOpen(true);
  }, [snapshot?.id, snapshot?.evaluation?.completedAt]);

  const perform = useCallback(async (action: "run" | "retry" | "pause" | "cancel") => {
    if (busy.current) return;
    const value = latest.current;
    if ((action === "run" || action === "retry") && (!value.input || value.executionBlock)) return;
    if (activeId.current && !value.snapshot) return;
    busy.current = true; setPending(true); setError(null);
    const controller = new AbortController(); operationAbort.current = controller;
    const token = ++generation.current;
    const valid = () => mounted.current && token === generation.current;
    try {
      const old = value.snapshot;
      if (action === "run" && old?.status === "PAUSED" && value.input) {
        const provider = old.configuration.providerId.startsWith("fixture-") ? "fixture" : old.configuration.providerId;
        if (old.configuration.scenario.id !== value.input.scenarioId || old.configuration.initialVariant !== value.input.initialVariant ||
            provider !== value.input.providerId || old.configuration.modelId !== value.input.modelId) {
          throw new Error("Selection changed. Use Retry to start a new run with this configuration.");
        }
      }
      if (action === "pause" || action === "cancel" || action === "run" && old?.status === "PAUSED") {
        if (!old || isTerminal(old.status)) return;
        const result = await api.control(old.id, action === "run" ? "resume" : action, controller.signal);
        if (valid()) { accept(result); if (action === "cancel") {
          streamAbort.current?.abort();
          // Reattach once to replay the committed cancellation event, then the terminal stream closes.
          setSubscriptionEpoch((epoch) => epoch + 1);
        } }
        return;
      }
      if (action === "run" && old) return;
      setResultsOpen(false);
      streamAbort.current?.abort();
      if (old && !isTerminal(old.status)) {
        try { await api.control(old.id, "cancel", controller.signal); }
        catch (failure) {
          if (!(failure instanceof ApiError && failure.status === 409 && isTerminal((await api.snapshot(old.id, controller.signal)).status))) throw failure;
        }
      }
      if (!valid()) return;
      setSnapshot(null); setEvents([]); setLiveGraph(true); setRunId(null); activeId.current = null; saveRun(null);
      const created = await api.create(value.input!, controller.signal);
      if (!valid()) return;
      activeId.current = created.id; saveRun(created.id); setRunId(created.id); accept(created);
    } catch (failure) {
      if (!valid()) return;
      if (failure instanceof ApiError && failure.status === 409 && value.snapshot) {
        try { accept(await api.snapshot(value.snapshot.id, controller.signal)); } catch { /* Show original conflict. */ }
      }
      setError(failure instanceof Error ? failure.message : "Backend request failed.");
      if (value.snapshot && activeId.current === value.snapshot.id) setSubscriptionEpoch((epoch) => epoch + 1);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }, [api, accept]);

  return {
    runId, snapshot, events, error, pending, isResultsOpen, setResultsOpen, liveGraph,
    clearPresentation: () => {
      if (busy.current || latest.current.snapshot && !isTerminal(latest.current.snapshot.status) || activeId.current && !latest.current.snapshot) return false;
      generation.current++; streamAbort.current?.abort(); activeId.current = null;
      setRunId(null); saveRun(null); setSnapshot(null); setEvents([]); setLiveGraph(false); setResultsOpen(false); setError(null);
      return true;
    },
    run: () => void perform("run"), retry: () => void perform("retry"),
    pause: () => void perform("pause"), stop: () => void perform("cancel"),
    toggleResults: () => { if (latest.current.snapshot?.evaluation) setResultsOpen((open) => !open); },
    running: snapshot?.status === "RUNNING" || snapshot?.status === "CREATED",
    completed: !!snapshot && isTerminal(snapshot.status),
    canRetry: !!snapshot && !pending && !executionBlock,
  };
}
