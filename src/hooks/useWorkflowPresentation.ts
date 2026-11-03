import { useEffect, useState } from "react";
import type { AuditEvent, DurableRun } from "../api/types";
import type { StepStatus } from "../data/graph";
import { beginnerNodes, isBeginner } from "../../backend/src/domain/narrative/scenarios/ssh-beginner";

// Presentation pacing only. Frames require committed backend step.started
// events; this never advances the backend or invents execution.
export const WORKFLOW_FRAME_MS = 1800;
export function workflowPresentation(run: DurableRun, events: readonly AuditEvent[], index: number) {
  const starts = events.filter(event => event.runId === run.id && event.eventType === "step.started" && event.nodeId);
  const start = starts[index];
  const statuses: Record<string, StepStatus> = Object.fromEntries(beginnerNodes.map(node => [node[0], "ready"]));
  const boundary = starts[index + 1]?.sequence ?? Infinity;
  const visible = events.filter(event => event.runId === run.id && event.sequence < boundary);
  for (const event of visible) {
    if (event.eventType === "transition.committed" && event.nodeId && statuses[event.nodeId] !== "rejected") statuses[event.nodeId] = "complete";
    if (event.eventType === "decision.evaluated" && event.nodeId && event.payload.verdict === "REJECTED") statuses[event.nodeId] = "rejected";
  }
  const proposal = visible.find(event => event.eventType === "decision.proposed");
  const verdict = visible.find(event => event.eventType === "decision.evaluated");
  if (visible.some(event => event.eventType === "step.started" && event.nodeId === "N-04")) statuses["N-05"] = "skipped";
  if (visible.some(event => event.eventType === "step.started" && event.nodeId === "N-05")) statuses["N-04"] = "skipped";
  if (verdict) statuses[verdict.payload.verdict === "APPROVED" ? "N-10" : "N-07"] = "skipped";
  const terminal = ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status);
  const caughtUp = terminal && index >= starts.length;
  const node = caughtUp ? null : start?.nodeId ?? null;
  if (node) statuses[node] = "active";
  if (caughtUp) {
    if (run.status === "FAILED" && starts.at(-1)?.nodeId) statuses[starts.at(-1)!.nodeId!] = "failed";
    for (const id of Object.keys(statuses)) if (statuses[id] === "ready") statuses[id] = "not-evaluated";
  }
  return { statuses, activeNodeId: node, ready: caughtUp && events.some(event => event.eventType === "run.finished"),
    frameSequence: start?.sequence ?? 0, proposal, verdict, visibleEvents: visible };
}

export function useWorkflowPresentation(run: DurableRun | null, events: readonly AuditEvent[]) {
  const [frame, setFrame] = useState({ runId: "", index: 0 });
  const enabled = !!run && isBeginner(run.configuration.scenario);
  const index = frame.runId === run?.id ? frame.index : 0;
  const presentation = enabled ? workflowPresentation(run!, events, index) : null;
  const starts = enabled ? events.filter(event => event.runId === run!.id && event.eventType === "step.started") : [];
  const lastSequence = starts[index]?.sequence;
  const canAdvance = enabled && lastSequence !== undefined && events.some(event => event.sequence > lastSequence &&
    (event.eventType === "transition.committed" || event.eventType === "run.finished"));
  useEffect(() => {
    if (!canAdvance || !run) return;
    const timer = setTimeout(() => setFrame({ runId: run.id, index: index + 1 }), WORKFLOW_FRAME_MS);
    return () => clearTimeout(timer);
  }, [run?.id, index, canAdvance]);
  return presentation;
}
