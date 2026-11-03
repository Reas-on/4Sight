import { expect, test } from "@playwright/test";

test("execution focus, manual takeover, retry and Results presence form one continuous scene", async ({
  page,
}) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => /\/\.vite\/deps\/three\.js\?/.test(name))!;
    const three = await import(/* @vite-ignore */ url);
    const update = three.PerspectiveCamera.prototype.updateMatrixWorld;
    three.PerspectiveCamera.prototype.updateMatrixWorld = function (
      force?: boolean,
    ) {
      (window as unknown as { overviewError: number }).overviewError =
        this.position
          .clone()
          .normalize()
          .cross(new three.Vector3(0, 0, 1).applyQuaternion(this.quaternion))
          .length();
      return update.call(this, force);
    };
    (window as unknown as { savedCanvas: Element | null }).savedCanvas =
      document.querySelector("canvas");
  });
  const graph = page.getByTestId("graph-renderer");
  const app = page.locator(".app");
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  await expect(graph).toHaveAttribute("data-execution-node", "N-01");
  await expect(graph).toHaveAttribute("data-execution-phase", "processing");
  const label = page
    .locator(".graph-label")
    .filter({ hasText: "Receive alert" });
  const before = await label.evaluate((el) => el.style.transform);
  const box = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 15,
    { steps: 4 },
  );
  await page.mouse.up();
  expect(await label.evaluate((el) => el.style.transform)).not.toBe(before);
  await expect(graph).toHaveAttribute("data-execution-node", "N-02");
  await page.getByRole("button", { name: "Pause demonstration" }).click();
  await expect(graph).toHaveAttribute("data-execution-phase", "idle");
  await page
    .getByRole("button", { name: "Retry Demonstration", exact: true })
    .click();
  await expect(app).toHaveAttribute("data-demo-index", "0");
  await expect(graph).toHaveAttribute("data-execution-node", "N-01");
  await expect(page.locator(".results-panel")).toBeVisible({ timeout: 13000 });
  const panel = page.locator(".results-panel");
  await expect(panel).toHaveAttribute("data-presence", "open");
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { overviewError: number }).overviewError,
      ),
    )
    .toBeLessThan(0.001);
  expect(
    await panel.evaluate(
      (el) => el.getAnimations()[0]?.effect?.getComputedTiming().duration,
    ),
  ).toBe(250);
  const run = await app.getAttribute("data-run-id");
  await page.evaluate(() => {
    document
      .querySelector<HTMLButtonElement>(".results-header button")!
      .click();
  });
  await expect(panel).toHaveAttribute("data-presence", "exiting");
  await page.getByRole("button", { name: "Show simulation results" }).click();
  await expect(panel).toHaveAttribute("data-presence", "open");
  await expect(app).toHaveAttribute("data-run-id", run!);
  await page.evaluate(() => {
    document
      .querySelector<HTMLButtonElement>(".results-header button")!
      .click();
  });
  await expect(panel).toHaveAttribute("data-presence", "exiting");
  await expect(panel).toHaveCount(0);
  await page.getByRole("button", { name: "Show simulation results" }).click();
  await expect(panel).toHaveAttribute("data-presence", "open");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Close simulation results" }).click();
  await expect(panel).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { savedCanvas: Element | null }).savedCanvas ===
        document.querySelector("canvas"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
