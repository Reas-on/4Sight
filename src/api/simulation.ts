import { ApiError, request, validate } from "./client";
import type { DurableRun, ModelOption, RunInput, ScenarioOption, SimulationEvaluation } from "./types";

const idPath = (id: string) => {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new ApiError("INVALID_RUN_ID");
  return `/runs/${id}`;
};
async function runResponse(path: string, id: string, init: RequestInit, signal?: AbortSignal) {
  const run = await request<DurableRun>(path, "run", init, signal);
  if (run.id !== id || run.narrative.scenarioId !== run.configuration.scenario.id || run.evaluation && run.evaluation.runId !== id) {
    throw new ApiError("INVALID_BACKEND_RESPONSE");
  }
  return run;
}
export const simulationApi = {
  scenarios: (signal?: AbortSignal) => request<{ scenarios: ScenarioOption[] }>("/scenarios", "scenarios", {}, signal),
  models: (signal?: AbortSignal) => request<{ models: ModelOption[] }>("/models", "models", {}, signal),
  create: async (input: RunInput, signal?: AbortSignal) => {
    validate("create", input);
    const result = await request<{ run: DurableRun; accessToken: string }>("/runs", "created", { method: "POST", body: JSON.stringify(input) }, signal);
    return result.run;
  },
  snapshot: (id: string, signal?: AbortSignal) => runResponse(idPath(id), id, {}, signal),
  control: (id: string, action: "pause" | "resume" | "cancel", signal?: AbortSignal) => runResponse(`${idPath(id)}/${action}`, id, { method: "POST" }, signal),
  result: (id: string, signal?: AbortSignal) => request<{ evaluation: SimulationEvaluation; ruleAdherence: number | null }>(`${idPath(id)}/result`, "result", {}, signal),
};
export type SimulationApi = typeof simulationApi;
