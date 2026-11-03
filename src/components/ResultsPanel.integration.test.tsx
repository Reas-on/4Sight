import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ResultsPanel from "./ResultsPanel";
import { backendResult, nodePresentation } from "../data/backendPresentation";
import { runFixture } from "../api/testFixtures";

beforeAll(() => vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })));
afterEach(cleanup);
describe("backend Results Panel mapping", () => {
  it("renders real counts and N/A instead of fabricated hallucination metrics", () => {
    const run = runFixture(undefined, "COMPLETED");
    render(<ResultsPanel result={backendResult(run, [])} open onClose={() => undefined} onDismissFocus={() => undefined} />);
    expect(screen.getByTestId("results-step-count").textContent).toBe("3");
    expect(screen.getByText("N/A")).toBeTruthy();
    expect(screen.getByText(/3 evaluated · 3 approved · 0 rejected/)).toBeTruthy();
    expect(screen.queryByText("FULL PASS")).toBeNull();
    expect(nodePresentation(run, []).statuses).toMatchObject({ "N-01": "complete", "N-02": "skipped", "N-03": "skipped", "N-04": "complete", "N-05": "complete" });
  });
  it("keeps execution failure separate from INCONCLUSIVE and does not show PASS", () => {
    const run = { ...runFixture(undefined, "FAILED"), error: { code: "PROVIDER_TIMEOUT", message: "Provider timed out.", phase: "provider" as const } };
    render(<ResultsPanel result={backendResult(run, [])} open onClose={() => undefined} onDismissFocus={() => undefined} />);
    expect(screen.getByText("FAILED")).toBeTruthy();
    expect(screen.getAllByText("INCONCLUSIVE")).toHaveLength(2);
    expect(screen.getByText(/PROVIDER_TIMEOUT/)).toBeTruthy();
    expect(screen.queryByText("PASS")).toBeNull();
  });
});
