import { steps } from "./graph";
import type { AudioEvent } from "../audio/GraphAudioEngine";
/** Derive events only from committed local demo progression; reset/pause emit none. */
export function demoAudioEvents(
  previous: number,
  next: number,
): { event: AudioEvent; nodeId?: string }[] {
  if (next === previous || next < 0) return [];
  if (next === 0) return [{ event: "NODE_ENTERED", nodeId: steps[0].id }];
  if (next < previous) return [];
  const events: { event: AudioEvent; nodeId?: string }[] = [];
  if (previous >= 0 && previous < steps.length && next === previous + 1)
    events.push({ event: "NODE_COMPLETED", nodeId: steps[previous].id });
  if (next < steps.length)
    events.push({ event: "NODE_ENTERED", nodeId: steps[next].id });
  if (next === steps.length && previous === steps.length - 1)
    events.push({ event: "SIMULATION_COMPLETED" });
  return events;
}
