import { expect, test, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) =>
  expect(browserErrors.get(page) ?? []).toEqual([]),
);

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
});
test("one immersive button shares run, pause/resume and stop/reset with normal controls", async ({
  page,
}) => {
  await expect(page.locator(".immersive-simulation-button")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  const button = page.locator(".immersive-simulation-button");
  await expect(button).toHaveAttribute("aria-label", "Stop demonstration");
  await expect(button.locator(".lucide-square")).toHaveCount(1);
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "true",
  );
  await expect
    .poll(() => page.locator(".app").getAttribute("data-demo-index"))
    .not.toBe("0");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Pause demonstration" }).click();
  const paused = await page.locator(".app").getAttribute("data-demo-index");
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(button).toHaveAttribute("aria-label", "Resume demonstration");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-index",
    paused!,
  );
  await button.click();
  await expect(button).toHaveAttribute("aria-label", "Stop demonstration");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-index",
    paused!,
  );
  await button.click();
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "false",
  );
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await expect(button).toHaveAttribute("aria-label", "Run demonstration");
  await page.waitForTimeout(1800);
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Run demonstration", exact: true }),
  ).toBeVisible();
});

test("Ctrl+Space is received by browser, starts/stops/resumes once, and plain Space never runs", async ({
  page,
}) => {
  await page.locator("canvas").focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await page.keyboard.down("Control");
  await page.keyboard.down("Space");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "true",
  );
  await page.keyboard.down("Space");
  await page.keyboard.up("Control");
  await page.waitForTimeout(1000);
  await page.keyboard.up("Space");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "true",
  );
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "false",
  );
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .focus();
  await page.keyboard.press("Space");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "false",
  );
  await page.keyboard.press("Control+Space");
  await page.getByRole("button", { name: "Pause demonstration" }).click();
  const paused = await page.locator(".app").getAttribute("data-demo-index");
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "true",
  );
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-index",
    paused!,
  );
});

test("modifier changes cancel pending hold and never count toward double Space", async ({
  page,
}) => {
  await page.locator("canvas").focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(300);
  await page.keyboard.down("Control");
  await page.waitForTimeout(650);
  await page.keyboard.up("Control");
  await page.keyboard.up("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await page.keyboard.down("Space");
  await page.waitForTimeout(850);
  await page.keyboard.up("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
  await page.keyboard.down("Control");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  await page.keyboard.up("Control");
  await page.keyboard.press("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-cursor", "hidden");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
});

test("execution guard and focused text/dialogs block Ctrl+Space and the immersive button", async ({
  page,
}) => {
  const input = page.getByRole("textbox", {
    name: "Additional Context",
    exact: true,
  });
  await input.fill("Protected source");
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator(".immersive-simulation-button")).toBeDisabled();
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await page.keyboard.press("Escape");
  await input.fill("");
  await input.focus();
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await page.getByRole("button", { name: "Open settings" }).click();
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "-1");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("tab", { name: "Import File" }).click();
  await page.getByLabel("Import source file").setInputFiles({
    name: "source.log",
    mimeType: "text/plain",
    buffer: Buffer.from("Untrusted source content"),
  });
  await page.getByRole("button", { name: "Use Scenario" }).click();
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator(".immersive-simulation-button")).toBeDisabled();
  await page.locator("canvas").focus();
  await page.keyboard.press("Control+Space");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "false",
  );
});

test("completed demonstration toggles Results and only Retry starts a fresh instance", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Run demonstration", exact: true })
    .click();
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "5", {
    timeout: 12000,
  });
  await expect(page.locator(".immersive-simulation-button")).toHaveAttribute(
    "aria-label",
    "Hide simulation results",
  );
  await page.locator(".immersive-simulation-button").click();
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "5");
  await expect(page.locator(".results-panel")).toHaveCount(0);
  await page.locator(".immersive-retry-button").click();
  await expect(page.locator(".app")).toHaveAttribute("data-demo-index", "0");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-demo-running",
    "true",
  );
});

test("immersive button is above left edge, horizontal toolbar/legend retain dimensions and positions", async ({
  page,
}, testInfo) => {
  await page.evaluate(() => document.fonts.ready);
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 768, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "Enter immersive mode" }).click();
    await expect(page.locator(".app")).toHaveAttribute(
      "data-phase",
      "immersive",
    );
    await expect(page.locator(".top-header")).toHaveCSS("height", "0px");
    const toolbar = (await page.locator(".zoom-controls").boundingBox())!;
    const button = (await page
      .locator(".immersive-simulation-button")
      .boundingBox())!;
    expect(toolbar.width).toBe(87);
    expect(toolbar.height).toBe(29);
    expect(button.width).toBe(42);
    expect(button.height).toBe(42);
    expect(button.x).toBe(toolbar.x);
    expect(toolbar.y - button.y - button.height).toBe(10);
    const controls = page.locator(".zoom-controls button");
    expect(await controls.allTextContents()).toEqual(["", "", ""]);
    const boxes = await Promise.all(
      (await controls.all()).map((control) => control.boundingBox()),
    );
    expect(boxes.map((box) => box!.y)).toEqual([
      toolbar.y + 1,
      toolbar.y + 1,
      toolbar.y + 1,
    ]);
    expect(boxes.map((box) => box!.width)).toEqual([28, 28, 28]);
    expect(boxes.map((box) => box!.x - toolbar.x)).toEqual([1, 29, 58]);
    expect(
      await page
        .locator(".zoom-controls")
        .evaluate((el) => getComputedStyle(el).flexDirection),
    ).toBe("row");
    const legend = (await page.locator(".graph-legend").boundingBox())!;
    if (viewport.width > 600) {
      expect(legend.x - toolbar.x).toBe(104);
    } else {
      expect(legend.x).toBe(toolbar.x);
      expect(legend.y - toolbar.y).toBe(40);
    }
    await expect(page.locator(".immersive-simulation-button")).toHaveCount(1);
    await expect(page.locator(".immersive-simulation-button")).toHaveCSS(
      "cursor",
      "none",
    );
    if (viewport.width === 1440) {
      const screenshot = testInfo.outputPath("immersive-simulation.png");
      await page.screenshot({ path: screenshot });
      await testInfo.attach("immersive controls", {
        path: screenshot,
        contentType: "image/png",
      });
      await page.screenshot({
        path: "/tmp/opencode/4sight-immersive-simulation.png",
      });
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(".immersive-simulation-button")).toHaveCount(0);
  }
});
