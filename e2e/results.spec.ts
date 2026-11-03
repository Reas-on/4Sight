import { expect, test, type Page } from "@playwright/test";

test.setTimeout(45000);
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const list: string[] = [];
  errors.set(page, list);
  page.on("pageerror", (error) => list.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") list.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
});
test.afterEach(async ({ page }) => expect(errors.get(page) ?? []).toEqual([]));
async function complete(page: Page) {
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Simulation Results" }),
  ).toBeVisible({ timeout: 14000 });
}

test("completion opens simulated FULL PASS with actual executed steps and retained audit data", async ({
  page,
}, testInfo) => {
  await complete(page);
  const panel = page.getByRole("dialog", { name: "Simulation Results" });
  await expect(page.locator(".app")).toHaveAttribute(
    "data-simulation-status",
    "completed",
  );
  await expect(panel).toContainText("FULL PASS");
  await expect(panel).toContainText("0.0%");
  await expect(panel).toContainText("100%");
  await expect(panel.getByTestId("results-step-count")).toHaveText("5");
  expect(
    await page
      .locator('[data-audit-kind="completed"]')
      .evaluateAll((elements) =>
        elements.map((el) => el.getAttribute("data-node-id")),
      ),
  ).toEqual(["N-01", "N-02", "N-03", "N-04", "N-05"]);
  await expect(panel).toContainText("not backend-verified");
  await expect(
    panel.getByRole("button", { name: "Export SOAR JSON" }),
  ).toBeDisabled();
  const audit = await page.locator(".results-audit ol").innerText();
  const run = await panel.getAttribute("data-run-id");
  const screenshot = testInfo.outputPath("simulation-results-desktop.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("results desktop", {
    path: screenshot,
    contentType: "image/png",
  });
  await page.screenshot({ path: "/tmp/opencode/4sight-results-desktop.png" });
  await page.getByRole("button", { name: "Close simulation results" }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "5");
  await page.getByRole("button", { name: "Show simulation results" }).click();
  await expect(panel).toHaveAttribute("data-run-id", run!);
  expect(await page.locator(".results-audit ol").innerText()).toBe(audit);
  await page.getByRole("button", { name: "Hide simulation results" }).click();
  await expect(panel).toHaveCount(0);
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Space");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Control+Space");
  await expect(panel).toHaveCount(0);
  await expect(page.locator(".app")).toHaveAttribute("data-run-id", run!);
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "false",
  );
});

test("results toggle and Escape preserve immersive mode, camera and canvas identity", async ({
  page,
}, testInfo) => {
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await page.locator("canvas").evaluate((el) => {
    (window as unknown as { savedCanvas: Element }).savedCanvas = el;
  });
  await page.locator(".immersive-simulation-button").click();
  await expect(
    page.getByRole("dialog", { name: "Simulation Results" }),
  ).toBeVisible({ timeout: 14000 });
  await expect(page.locator(".immersive-simulation-button")).toHaveAttribute(
    "aria-label",
    "Hide simulation results",
  );
  await expect(
    page.locator(".immersive-simulation-button svg"),
  ).toHaveAttribute("class", /file-check/);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Simulation Results" }),
  ).toHaveCount(0);
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
  await page.locator(".immersive-simulation-button").click();
  await page.keyboard.press("Control+Space");
  await expect(
    page.getByRole("dialog", { name: "Simulation Results" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Show simulation results" }).click();
  const run = await page.locator(".results-panel").getAttribute("data-run-id");
  await page.getByRole("button", { name: "Close simulation results" }).click();
  const before = await page
    .locator(".graph-label")
    .first()
    .evaluate((el) => el.style.transform);
  await page.getByRole("button", { name: "Show simulation results" }).click();
  await page.getByRole("button", { name: "Close simulation results" }).click();
  expect(
    await page
      .locator(".graph-label")
      .first()
      .evaluate((el) => el.style.transform),
  ).toBe(before);
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await page.locator(".immersive-simulation-button").click();
  await expect(page.locator(".results-panel")).toHaveAttribute(
    "data-run-id",
    run!,
  );
  await page.screenshot({ path: "/tmp/opencode/4sight-results-immersive.png" });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { savedCanvas: Element }).savedCanvas ===
        document.querySelector("canvas"),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
});

test("Retry restarts once with latest configuration and never leaks old result/audit", async ({
  page,
}) => {
  await complete(page);
  const old = await page.locator(".results-panel").getAttribute("data-run-id");
  await page.getByRole("button", { name: "Close simulation results" }).click();
  await page
    .getByRole("combobox", { name: "AI Agent / Model" })
    .selectOption("none");
  const retry = page.getByRole("button", {
    name: "Retry Demonstration",
    exact: true,
  });
  await retry.click();
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "0");
  await expect(retry).toBeDisabled();
  await expect(page.locator(".results-panel")).toHaveCount(0);
  const run = await page.locator(".app").getAttribute("data-run-id");
  expect(Number(run)).toBe(Number(old) + 1);
  await page.evaluate(() => {
    const retry = document.querySelector<HTMLButtonElement>(
      ".demo-control-title button",
    )!;
    retry.click();
    retry.click();
    retry.click();
  });
  await expect(page.locator(".app")).toHaveAttribute("data-run-id", run!);
  await expect(page.locator(".results-panel")).toBeVisible({ timeout: 14000 });
  await expect(page.locator(".results-panel")).toHaveAttribute(
    "data-run-id",
    run!,
  );
  await expect(page.locator(".results-run-meta")).toContainText(
    "No live model connected",
  );
  await expect(page.locator('[data-audit-kind="completed"]')).toHaveCount(5);
  await expect(page.getByTestId("results-step-count")).toHaveText("5");
});

test("immersive Retry matches main control and original zoom/legend layout remains untouched", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  const retry = page.locator(".immersive-retry-button");
  await expect(retry).toBeDisabled();
  const toolbar = (await page.locator(".zoom-controls").boundingBox())!,
    simulation = (await page
      .locator(".immersive-simulation-button:not(.immersive-retry-button)")
      .boundingBox())!,
    restart = (await retry.boundingBox())!;
  expect(toolbar.width).toBe(87);
  expect(toolbar.height).toBe(29);
  expect(simulation.width).toBe(42);
  expect(restart.width).toBe(42);
  expect(restart.height).toBe(simulation.height);
  expect(restart.x - simulation.x - simulation.width).toBe(10);
  expect(restart.y).toBe(simulation.y);
  expect(toolbar.y - simulation.y - simulation.height).toBe(10);
  await page
    .locator(".immersive-simulation-button:not(.immersive-retry-button)")
    .click();
  await expect(retry).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pause demonstration" }).click();
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "0");
  await expect(retry).toBeDisabled();
  await page.screenshot({
    path: "/tmp/opencode/4sight-results-retry-toolbar.png",
  });
});

test("mobile Results has accessible header/footer and scrollable audit without horizontal overflow", async ({
  page,
}) => {
  await complete(page);
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 568 });
    await page.waitForTimeout(100);
    const panel = page.locator(".results-panel");
    const rect = (await panel.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.width).toBeLessThanOrEqual(width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(568);
    expect(await panel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      false,
    );
    await expect(
      page.getByRole("button", { name: "Close simulation results" }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Export SOAR JSON" }),
    ).toBeInViewport();
    await page.locator(".results-content").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  }
  await page.screenshot({ path: "/tmp/opencode/4sight-results-mobile.png" });
});
