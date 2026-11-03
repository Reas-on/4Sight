import { useEffect, useState } from "react";
import { simulationApi } from "../api/simulation";
import type { ModelOption, ScenarioOption } from "../api/types";

export function useBackendCatalog() {
  const [scenarios, setScenarios] = useState<ScenarioOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [catalogError, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([simulationApi.scenarios(controller.signal), simulationApi.models(controller.signal)])
      .then(([source, available]) => { if (!controller.signal.aborted) { setScenarios(source.scenarios); setModels(available.models); } })
      .catch((error) => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Backend unavailable"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  return { scenarios, models, catalogError, loading };
}
