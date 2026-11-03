import { steps } from "./graph";

export type AuditEvent = {
  id: number;
  elapsedMs: number;
  subject: string;
  description: string;
  outcome: "INFO" | "PASS" | "FULL PASS" | "SKIPPED";
  kind:
    | "started"
    | "entered"
    | "completed"
    | "paused"
    | "resumed"
    | "skipped"
    | "finished";
};
export type RunConfiguration = {
  sourceId: string;
  sourceName: string;
  agent: string;
  additionalContext: string;
};
export type EvaluationResult = {
  runId: number;
  startedAt: string;
  completedAt: string;
  configuration: RunConfiguration;
  overall: "FULL PASS";
  simulated: true;
  backendVerified: false;
  hallucinationRate: 0;
  ruleAdherence: 100;
  totalSteps: number;
  executedNodeIds: string[];
  auditTrail: AuditEvent[];
};
export type DemoLifecycle = {
  running: boolean;
  demoIndex: number;
  runId: number;
  startedAt: number;
  startedAtIso: string;
  configuration: RunConfiguration | null;
  auditTrail: AuditEvent[];
  evaluationResult: EvaluationResult | null;
  isResultsOpen: boolean;
};
export const initialDemo: DemoLifecycle = {
  running: false,
  demoIndex: -1,
  runId: 0,
  startedAt: 0,
  startedAtIso: "",
  configuration: null,
  auditTrail: [],
  evaluationResult: null,
  isResultsOpen: false,
};
export type DemoAction =
  | {
      type: "start";
      at: number;
      iso: string;
      configuration: RunConfiguration;
      retry?: boolean;
    }
  | { type: "tick"; runId: number; index: number; at: number; iso: string }
  | { type: "pause"; at: number }
  | { type: "stop" }
  | { type: "results"; open?: boolean };
export function simulationStatus(state: DemoLifecycle) {
  return state.evaluationResult
    ? "completed"
    : state.running
      ? "running"
      : state.demoIndex >= 0
        ? "paused"
        : "idle";
}
export function executedNodes(auditTrail: AuditEvent[]) {
  return [
    ...new Set(
      auditTrail
        .filter(
          (event) => event.kind === "completed" && event.outcome === "PASS",
        )
        .map((event) => event.subject),
    ),
  ];
}
export function demoReducer(
  state: DemoLifecycle,
  action: DemoAction,
): DemoLifecycle {
  const append = (
    kind: AuditEvent["kind"],
    subject: string,
    description: string,
    outcome: AuditEvent["outcome"],
    at: number,
    trail = state.auditTrail,
  ): AuditEvent[] => [
    ...trail,
    {
      id: trail.length,
      elapsedMs: Math.max(0, at - state.startedAt),
      kind,
      subject,
      description,
      outcome,
    },
  ];
  switch (action.type) {
    case "start": {
      if (state.running || (state.evaluationResult && !action.retry))
        return state;
      if (!action.retry && state.demoIndex >= 0)
        return {
          ...state,
          running: true,
          auditTrail: append(
            "resumed",
            "SYSTEM",
            "Demonstration resumed",
            "INFO",
            action.at,
          ),
        };
      const runId = state.runId + 1;
      return {
        ...initialDemo,
        running: true,
        demoIndex: 0,
        runId,
        startedAt: action.at,
        startedAtIso: action.iso,
        configuration: { ...action.configuration },
        auditTrail: [
          {
            id: 0,
            elapsedMs: 0,
            subject: "SYSTEM",
            description: "Local demonstration started",
            outcome: "INFO",
            kind: "started",
          },
          {
            id: 1,
            elapsedMs: 0,
            subject: steps[0].id,
            description: `${steps[0].name} — entered`,
            outcome: "INFO",
            kind: "entered",
          },
        ],
      };
    }
    case "tick": {
      if (
        !state.running ||
        state.runId !== action.runId ||
        state.demoIndex !== action.index ||
        !state.configuration
      )
        return state;
      const step = steps[state.demoIndex];
      if (!step) return state;
      let trail = append(
        "completed",
        step.id,
        `${step.name} — simulated execution completed`,
        "PASS",
        action.at,
      );
      const next = state.demoIndex + 1;
      if (next < steps.length) {
        trail = append(
          "entered",
          steps[next].id,
          `${steps[next].name} — entered`,
          "INFO",
          action.at,
          trail,
        );
        return { ...state, demoIndex: next, auditTrail: trail };
      }
      trail = append(
        "finished",
        "SYSTEM",
        "Evaluation fixture finalized — no backend referee or AI validation performed",
        "FULL PASS",
        action.at,
        trail,
      );
      const executedNodeIds = executedNodes(trail);
      const result: EvaluationResult = {
        runId: state.runId,
        startedAt: state.startedAtIso,
        completedAt: action.iso,
        configuration: { ...state.configuration },
        overall: "FULL PASS",
        simulated: true,
        backendVerified: false,
        hallucinationRate: 0,
        ruleAdherence: 100,
        totalSteps: executedNodeIds.length,
        executedNodeIds,
        auditTrail: trail,
      };
      return {
        ...state,
        running: false,
        demoIndex: next,
        auditTrail: trail,
        evaluationResult: result,
        isResultsOpen: true,
      };
    }
    case "pause":
      return state.running
        ? {
            ...state,
            running: false,
            auditTrail: append(
              "paused",
              "SYSTEM",
              "Demonstration paused",
              "INFO",
              action.at,
            ),
          }
        : state;
    case "stop":
      return state.evaluationResult
        ? state
        : { ...initialDemo, runId: state.runId };
    case "results":
      return state.evaluationResult
        ? { ...state, isResultsOpen: action.open ?? !state.isResultsOpen }
        : state;
  }
}
export function formatAuditTime(ms: number) {
  const tenths = Math.floor(ms / 100);
  return `${String(Math.floor(tenths / 600)).padStart(2, "0")}:${String(Math.floor(tenths / 10) % 60).padStart(2, "0")}.${tenths % 10}`;
}
