import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  demoReducer,
  initialDemo,
  simulationStatus,
  type RunConfiguration,
} from "../data/demoLifecycle";

export const DEMO_STEP_DURATION = 1600;
/** Owns the original demo progression and its single run-scoped execution timer. */
export function useDemonstration(
  executionBlock: string | null,
  configuration: RunConfiguration,
  stopAudio: () => void,
) {
  const [state, dispatch] = useReducer(demoReducer, initialDemo);
  const current = useRef({ state, executionBlock, configuration, stopAudio });
  current.current = { state, executionBlock, configuration, stopAudio };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const generation = useRef(0);
  const starting = useRef(false);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    generation.current++;
  }, []);
  useEffect(() => {
    starting.current = false;
  }, [state.runId, state.running]);
  useEffect(() => {
    if (!state.running || executionBlock) return;
    const token = ++generation.current;
    timer.current = setTimeout(() => {
      if (token !== generation.current) return;
      dispatch({
        type: "tick",
        runId: state.runId,
        index: state.demoIndex,
        at: performance.now(),
        iso: new Date().toISOString(),
      });
    }, DEMO_STEP_DURATION);
    return cancel;
  }, [state.running, state.demoIndex, state.runId, executionBlock, cancel]);
  const pause = useCallback(() => {
    if (!current.current.state.running) return;
    cancel();
    current.current.stopAudio();
    dispatch({ type: "pause", at: performance.now() });
  }, [cancel]);
  const stop = useCallback(() => {
    if (current.current.state.evaluationResult) return;
    cancel();
    starting.current = false;
    current.current.stopAudio();
    dispatch({ type: "stop" });
  }, [cancel]);
  const start = useCallback(
    (retry = false) => {
      const value = current.current;
      // Retry is deliberately unavailable while a run is already executing.
      if (
        value.executionBlock ||
        value.state.running ||
        starting.current ||
        (!retry && value.state.evaluationResult)
      )
        return;
      if (retry && value.state.runId === 0) return;
      starting.current = true;
      cancel();
      if (retry) value.stopAudio();
      dispatch({
        type: "start",
        retry,
        configuration: value.configuration,
        at: performance.now(),
        iso: new Date().toISOString(),
      });
    },
    [cancel],
  );
  const run = useCallback(() => start(), [start]);
  const retry = useCallback(() => start(true), [start]);
  const setResultsOpen = useCallback(
    (open: boolean) => dispatch({ type: "results", open }),
    [],
  );
  const toggleResults = useCallback(() => dispatch({ type: "results" }), []);
  return {
    ...state,
    simulationStatus: simulationStatus(state),
    pause,
    stop,
    run,
    retry,
    setResultsOpen,
    toggleResults,
    canRetry: state.runId > 0 && !state.running && !executionBlock,
  };
}
