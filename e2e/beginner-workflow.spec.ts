import { expect, test } from "@playwright/test";

test("beginner committed events → branch/camera/Inspector → persisted results", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.getByLabel("AI Agent / Model", { exact: true })).toHaveValue("gemini:gemini-2.5-flash");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("button", { name: /Suspicious SSH Logins — Beginner Walkthrough · External source/ }).click();
  await page.getByRole("button", { name: "Use Scenario", exact: true }).click();
  await expect(page.locator(".graph-label")).toHaveCount(10);
  await page.evaluate(() => { (window as unknown as { savedCanvas: Element | null }).savedCanvas = document.querySelector("canvas"); });
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/runs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run demonstration", exact: true }).click();
  expect((await created).status()).toBe(202);
  for (const id of ["N-01", "N-02", "N-03", "N-04", "N-06", "N-07", "N-08", "N-09"]) {
    await expect(page.getByTestId("graph-renderer")).toHaveAttribute("data-execution-node", id, { timeout: 15000 });
    await expect(page.locator(".right-drawer .detail-id")).toHaveText(id);
  }
  const results = page.getByRole("dialog", { name: "Simulation Results" });
  await expect(results).toBeVisible({ timeout: 10000 });
  await expect(results.locator(".results-outcome strong")).toHaveText("PASS");
  await expect(results.getByTestId("results-step-count")).toHaveText("8");
  await expect(results).toContainText("1 evaluated · 1 approved · 0 rejected");
  for (const id of ["N-05", "N-10"]) await expect(page.locator(".graph-label").filter({ hasText: id })).toHaveAttribute("data-status", "skipped");
  expect(await page.evaluate(() => (window as unknown as { savedCanvas: Element }).savedCanvas === document.querySelector("canvas"))).toBe(true);

  await page.getByRole("button", { name: "Close simulation results" }).click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.locator('.step-card[data-node-id="N-06"]').click();
  await expect(page.getByTestId("node-execution-evidence")).toContainText("perimeter_block");
  await expect(page.getByTestId("node-execution-evidence")).toContainText("APPROVED");
  await expect(page.getByTestId("node-execution-evidence")).toContainText("POLICY-001");
});

test("rejected protected block takes manual-review branch and displays actual FAIL", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("button", { name: /Suspicious SSH Logins — Beginner Walkthrough · Protected internal/ }).click();
  await page.getByRole("button", { name: "Use Scenario", exact: true }).click();
  await page.getByRole("button", { name: "Run demonstration", exact: true }).click();
  await expect(page.getByTestId("graph-renderer")).toHaveAttribute("data-execution-node", "N-10", { timeout: 20000 });
  await expect(page.getByTestId("node-execution-evidence")).toContainText("REJECTED");
  await expect(page.getByTestId("node-execution-evidence")).toContainText("POLICY-002");
  const results = page.getByRole("dialog", { name: "Simulation Results" });
  await expect(results).toBeVisible({ timeout: 10000 });
  await expect(results.locator(".results-outcome strong")).toHaveText("FAIL");
  await expect(results).toContainText("1 evaluated · 0 approved · 1 rejected");
  await expect(results.getByTestId("results-step-count")).toHaveText("8");
  await expect(page.locator(".graph-label").filter({ hasText: "N-07" })).toHaveAttribute("data-status", "skipped");
  await expect(page.locator(".graph-label").filter({ hasText: "N-06" })).toHaveAttribute("data-status", "rejected");
});
