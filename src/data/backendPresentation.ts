import type { AuditEvent, DurableRun, ScenarioOption } from "../api/types";
import type { ImportedSource } from "./scenario";
import { steps, type StepStatus } from "./graph";
import { BEGINNER_SCENARIO_ID, beginnerNodes } from "../../backend/src/domain/narrative/scenarios/ssh-beginner";
import { BRANCH_SCENARIO_ID } from "../../backend/src/domain/narrative/scenarios/policy-branch";
import { ruleAdherence } from '../../backend/src/domain/simulation/rule-adherence';

export const storyletNodes: Record<string, string> = {
  "triage-ssh-brute-force": "N-01", "block-external-source": "N-04",
  "escalate-protected-source": "N-04", "soc-escalation-follow-up": "N-04", "close-ssh-incident": "N-05",
};

export function scenarioSources(scenarios: ScenarioOption[]): ImportedSource[] {
  return scenarios.flatMap((scenario) => scenario.initialVariants
    .filter((variant) => ["externalSource", "protectedInternalSource"].includes(variant))
    .map((variant) => ({
      id: `backend:${scenario.id}:${variant}`, name: `${scenario.title} · ${scenario.id === BRANCH_SCENARIO_ID
        ? variant === 'externalSource' ? 'Internal source · decline review' : 'Protected internal · accept review'
        : variant === "externalSource" ? "External source" : "Protected internal"}`,
      sourceType: "builtin" as const, originalFormat: "Backend executable scenario", materialType: "reference_scenario" as const,
      description: `Backend scenario ${scenario.id}, version ${scenario.version}. Narrative and Referee execution is persisted; no real security commands run.`,
       mitreTechniqueIds: ["T1110.001"], rawContent: scenario.id === BRANCH_SCENARIO_ID
         ? `${scenario.title}\nBackend executable · ${scenario.version}\nSequential workflow: N-01 triage → N-02 prohibited internal block → N-03 independent SOC escalation.\nRejection reveals N-04 accept review and N-05 decline review. Source protection deterministically selects one; the other is skipped.\nActual Referee checks, simulated actions only.`
         : scenario.id === BEGINNER_SCENARIO_ID
         ? `${scenario.title}\nBackend executable · ${scenario.version}\n${variant}\n25 unsuccessful SSH sign-ins in 2 minutes. Documentation-only source 203.0.113.25.\n${beginnerNodes.map(node => `${node[0]} ${node[1]} — ${node[3]}`).join("\n")}\nN-03 → N-04 (external) or N-05 (protected/internal) → N-06 → N-07 (approved) or N-10 (rejected) → N-08 → N-09.\nAll actions are simulated.`
         : `${scenario.title}\n${variant}\nN-01 triage → N-04 containment/escalation → N-05 review.\nN-02 and N-03 remain contextual and are not evaluated.`,
    })));
}

export function nodePresentation(run: DurableRun | null, events: readonly AuditEvent[]) {
  const statuses: Record<string, StepStatus> = Object.fromEntries(steps.map((step) => [step.id,
    step.id === "N-02" || step.id === "N-03" ? "skipped" : "ready"]));
  for (const record of run?.records ?? []) {
    const node = record.transition?.graphNodeId ?? storyletNodes[record.decision.storyletId];
    if (!node) continue;
    statuses[node] = !record.referee.approved ? "rejected" : record.transition ? "complete" : "failed";
  }
  const lastStart = [...events].reverse().find((event) => event.eventType === "step.started" && event.runId === run?.id);
  const committed = run?.records.length ?? 0;
  const inFlight = lastStart && Number(lastStart.payload.decisionSequence) > committed;
  const node = lastStart?.nodeId ?? (lastStart?.storyletId ? storyletNodes[lastStart.storyletId] : null);
  const activeNodeId = run?.status === "RUNNING" && inFlight ? node ?? null : null;
  if (activeNodeId) statuses[activeNodeId] = "active";
  if (run && ["COMPLETED", "FAILED", "CANCELLED"].includes(run.status)) {
    for (const id of Object.keys(statuses)) if (statuses[id] === "ready") statuses[id] = "not-evaluated";
    if (run.status === "FAILED" && inFlight && node) statuses[node] = "failed";
  }
  return { statuses, activeNodeId };
}

export type BackendResult = {
  run: DurableRun;
  events: readonly AuditEvent[];
  ruleAdherence: number | null;
  measurementError?: boolean;
};
export function backendResult(run: DurableRun | null, events: readonly AuditEvent[]): BackendResult | null {
  if (!run?.evaluation) return null;
  try {
    if (run.records.length !== run.evaluation.totalDecisions ||
        run.records.filter(record => record.referee.approved).length !== run.evaluation.approvedDecisions) throw new Error('Missing decision evidence');
    return { run, events, ruleAdherence: ruleAdherence(run.evaluation) };
  } catch { return { run, events, ruleAdherence: null, measurementError: true }; }
}
