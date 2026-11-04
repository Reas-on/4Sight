import { useEffect, useState } from 'react';
import type { AuditEvent, DurableRun } from '../api/types';

// Presentation only: never block the SSE reader, persistence or execution.
// A normal fixture can finish between two browser frames. Keep each committed
// step visible long enough for the existing 600ms camera and 360ms entrance.
export const GRAPH_STEP_MS = 1000;

export function useGraphPlayback(run: DurableRun | null, events: readonly AuditEvent[], live: boolean, reduced: boolean) {
  const [frame, setFrame] = useState({ runId: '', index: 0 });
  const index = frame.runId === run?.id ? frame.index : 0;
  const enabled = !!run && live && !reduced && !['PAUSED', 'CANCELLED'].includes(run.status);
  const feed = events.filter(event => event.runId === run?.id);
  const starts = feed.filter(event => event.eventType === 'step.started' && event.nodeId);
  const current = enabled ? starts[index] : undefined;
  const settled = !!current && feed.some(event => event.sequence > current.sequence &&
    (event.eventType === 'transition.committed' || event.eventType === 'run.finished'));
  useEffect(() => {
    // Resuming a paused run or disabling reduced motion must not replay the
    // historical starts that were already hydrated while playback was bypassed.
    if (!enabled && run) setFrame(previous => previous.runId === run.id && previous.index === starts.length
      ? previous : { runId: run.id, index: starts.length });
  }, [enabled, run?.id, starts.length]);
  useEffect(() => {
    if (!run || !current || !settled) return;
    const timer = setTimeout(() => setFrame({ runId: run.id, index: index + 1 }), GRAPH_STEP_MS);
    return () => clearTimeout(timer);
  }, [run?.id, index, current?.sequence, settled]);
  const terminal = !!run && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status);
  const playing = enabled && (!!current || !terminal || (feed.at(-1)?.sequence ?? 0) < run.eventSequence);
  return {
    // Include the previous step's committed reveal before focusing this step.
    // Snapshots/Results retain the complete, immediate authoritative evidence.
    events: current ? feed.filter(event => event.sequence <= current.sequence) : events,
    activeNodeId: current?.nodeId ?? null,
    activeSequence: current?.sequence,
    playing,
  };
}
