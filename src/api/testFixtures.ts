import { initializeScenario } from "../../backend/src/domain/narrative/engine";
import { sshBruteForceScenario, sshBruteForceInitialStates } from "../../backend/src/domain/narrative/scenarios/ssh-brute-force";
import { evaluateSimulationStep } from "../../backend/src/domain/simulation/step";
import { DEFAULT_REFEREE_POLICY_SET } from "../../backend/src/domain/referee/policies";
import { EXTERNAL_SOURCE_DECISIONS } from "../../backend/src/domain/simulation/fixtures";
import { buildSimulationEvaluation } from "../../backend/src/domain/simulation/evaluation";
import type { AuditEvent, DurableRun } from "./types";

export const idOne = "11111111-1111-4111-8111-111111111111";
export const idTwo = "22222222-2222-4222-8222-222222222222";
export function runFixture(id = idOne, status: DurableRun["status"] = "RUNNING"): DurableRun {
  const now = "2026-11-03T12:00:00.000Z";
  const run: DurableRun = {
    id, status, revision: 2, eventSequence: 2,
    configuration: { scenario: sshBruteForceScenario, scenarioVersion: "1.0.0", initialVariant: "externalSource",
      providerId: "fixture-external-source", modelId: null, decisionTimeoutMs: 1000 },
    narrative: initializeScenario(sshBruteForceScenario, sshBruteForceInitialStates.externalSource),
    records: [], evaluation: null, error: null, createdAt: now, startedAt: now, completedAt: null, updatedAt: now,
  };
  if (status === "COMPLETED") {
    for (const [index, decision] of EXTERNAL_SOURCE_DECISIONS.entries()) {
      const step = evaluateSimulationStep(decision, run.narrative, sshBruteForceScenario, DEFAULT_REFEREE_POLICY_SET, index + 1, now);
      Object.assign(run, { narrative: step.state, records: [...run.records, step.record] });
    }
    Object.assign(run, { revision: 9, eventSequence: 12, completedAt: now });
  }
  if (["COMPLETED", "FAILED", "CANCELLED"].includes(status)) {
    Object.assign(run, { evaluation: buildSimulationEvaluation({
      runId: id, scenario: sshBruteForceScenario, provider: {}, status, narrative: run.narrative,
      records: run.records, startedAt: now, policySet: DEFAULT_REFEREE_POLICY_SET,
    }, status === "COMPLETED" ? "PASS" : "INCONCLUSIVE", status === "COMPLETED" ? "RUN_COMPLETED" : status,
    status, now), completedAt: now });
  }
  return run;
}
export function eventFixture(sequence = 1, runId = idOne, eventType = "step.started"): AuditEvent {
  return { id: `${String(sequence).padStart(8, "0")}-1111-4111-8111-111111111111`, runId, sequence, eventType,
    storyletId: "triage-ssh-brute-force", nodeId: "N-01", stateVersion: 0,
    payload: { decisionSequence: 1 }, createdAt: "2026-11-03T12:00:00.000Z" };
}
