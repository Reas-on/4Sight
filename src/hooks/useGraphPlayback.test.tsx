import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GRAPH_STEP_MS, useGraphPlayback } from './useGraphPlayback';
import { eventFixture, idOne, idTwo, runFixture } from '../api/testFixtures';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const events = [
  eventFixture(1),
  { ...eventFixture(2), eventType: 'transition.committed' as const },
  { ...eventFixture(3), eventType: 'graph.revealed' as const, payload: { nodes: [] } },
  { ...eventFixture(4), nodeId: 'N-04' },
  { ...eventFixture(5), eventType: 'transition.committed' as const, nodeId: 'N-04' },
  { ...eventFixture(6), eventType: 'run.finished' as const },
];

it('presents consecutive committed starts from one SSE burst even when REST is already terminal', () => {
  vi.useFakeTimers();
  const run = { ...runFixture(idOne, 'COMPLETED'), eventSequence: 6 };
  const { result } = renderHook(() => useGraphPlayback(run, events, true, false));
  expect(result.current.activeNodeId).toBe('N-01');
  expect(result.current.events.map(event => event.sequence)).toEqual([1]);
  act(() => vi.advanceTimersByTime(GRAPH_STEP_MS));
  expect(result.current.activeNodeId).toBe('N-04');
  expect(result.current.events.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
  expect(result.current.playing).toBe(true);
  act(() => vi.advanceTimersByTime(GRAPH_STEP_MS));
  expect(result.current.playing).toBe(false);
  expect(result.current.events).toEqual(events);
});

it('does not replay refresh/reconnect, reduced-motion, paused or cancelled evidence', () => {
  for (const [live, reduced, status] of [[false, false, 'COMPLETED'], [true, true, 'COMPLETED'],
    [true, false, 'CANCELLED'], [true, false, 'PAUSED']] as const) {
    const { result, unmount } = renderHook(() => useGraphPlayback(runFixture(idOne, status), events, live, reduced));
    expect(result.current.playing).toBe(false);
    expect(result.current.activeNodeId).toBeNull();
    expect(result.current.events).toEqual(events);
    unmount();
  }
});

it('waits for committed completion, then resets pending playback on retry and rejects old-run events', () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ run, feed }) => useGraphPlayback(run, feed, true, false), {
    initialProps: { run: runFixture(), feed: events.slice(0, 1) },
  });
  act(() => vi.advanceTimersByTime(GRAPH_STEP_MS * 3));
  expect(result.current.activeNodeId).toBe('N-01');
  rerender({ run: runFixture(), feed: events });
  act(() => vi.advanceTimersByTime(GRAPH_STEP_MS));
  expect(result.current.activeNodeId).toBe('N-04');
  rerender({ run: runFixture(idTwo), feed: [...events, eventFixture(1, idTwo)] });
  expect(result.current.activeNodeId).toBe('N-01');
  expect(result.current.events.map(event => event.runId)).toEqual([idTwo]);
  act(() => vi.advanceTimersByTime(GRAPH_STEP_MS * 2));
  expect(result.current.activeNodeId).toBe('N-01');
});

it('does not replay earlier steps when resuming after pause or reduced motion', () => {
  const { result, rerender } = renderHook(({ run, reduced }) => useGraphPlayback(run, events, true, reduced), {
    initialProps: { run: runFixture(idOne, 'PAUSED'), reduced: false },
  });
  rerender({ run: runFixture(), reduced: false });
  expect(result.current.activeNodeId).toBeNull();
  rerender({ run: runFixture(), reduced: true });
  rerender({ run: runFixture(), reduced: false });
  expect(result.current.activeNodeId).toBeNull();
});
