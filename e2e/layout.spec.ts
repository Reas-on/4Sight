import { expect, test, type Page, type TestInfo } from "@playwright/test";

test.setTimeout(45000);
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

async function capture(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await page.screenshot({path:`/tmp/opencode/4sight-refinement-${name}.png`});
  await testInfo.attach(name, { path, contentType: "image/png" });
}
async function shell(page: Page) {
  return page.locator(".scenario-explorer").evaluate((dialog) => {
    const rect = dialog.getBoundingClientRect();
    const header = dialog
      .querySelector(".explorer-header")!
      .getBoundingClientRect();
    const footer = dialog
      .querySelector(".explorer-actions")!
      .getBoundingClientRect();
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      top: rect.top,
      bottom: rect.bottom,
      headerHeight: header.height,
      footerTop: footer.top,
      footerBottom: footer.bottom,
      overflow: dialog.scrollWidth > dialog.clientWidth,
      scrollTop: dialog.scrollTop,
    };
  });
}
const ssh = {
  name: "SSH Brute Force — T1110.001",
  description:
    "Repeated SSH authentication failures from an unexpected source. Review the source identity before response.",
  mitreTechniqueIds: ["T1110.001"],
  events: Array.from({ length: 80 }, (_, i) => ({
    timestamp: `2026-11-02T10:${String(i % 60).padStart(2, "0")}:00Z`,
    host: "ssh-gateway",
    message: "Failed password for account analyst from 192.0.2.40",
  })),
};

test("Explorer fixed shell is readable, independently scrollable and stable across content/tabs", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  const baseline = await shell(page);
  expect(baseline.width).toBe(1100);
  expect(baseline.height).toBe(760);
  expect(baseline.overflow).toBe(false);
  const columns = await page
    .locator(".explorer-columns")
    .evaluate((el) =>
      getComputedStyle(el)
        .gridTemplateColumns.split(" ")
        .map(Number.parseFloat),
    );
  expect(columns[0] / columns[1]).toBeCloseTo(2 / 3, 1);
  await page.getByRole("tab", { name: "Import File" }).click();
  await page
    .getByLabel("Import source file")
    .setInputFiles({
      name: "ssh-brute-force.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(ssh)),
    });
  await expect(page.locator(".source-preview-name")).toHaveText(ssh.name);
  await expect(page.getByLabel("Source text preview")).toContainText(
    '"events": [\n',
  );
  const code = page.getByLabel("Source text preview");
  expect(
    await code.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(12);
  await code.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await code.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const imported = await shell(page);
  expect(imported.width).toBe(baseline.width);
  expect(imported.height).toBe(baseline.height);
  expect(imported.footerTop).toBe(baseline.footerTop);
  expect(imported.scrollTop).toBe(0);
  await code.evaluate((el) => {
    el.scrollTop = 0;
  });
  await capture(page, testInfo, "explorer-desktop-ssh");
  await page.getByRole("button", { name: "Use Scenario" }).click();
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("tab", { name: "Import File" }).click();
  await page
    .getByLabel("Import source file")
    .setInputFiles({
      name: "long.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          ...ssh,
          name: "SSH Brute Force — protected internal infrastructure scenario with an exceptionally long scenario title for multi-line layout verification ".repeat(
            2,
          ),
          description: "Context detail. ".repeat(100),
        }),
      ),
    });
  const long = await shell(page);
  expect(long.width).toBe(baseline.width);
  expect(long.height).toBe(baseline.height);
  expect(long.footerTop).toBe(baseline.footerTop);
  expect(long.overflow).toBe(false);
  await page.getByRole("button", { name: "Use Scenario" }).click();
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page
    .getByLabel("Source category", { exact: true })
    .selectOption("local_file");
  const title = page.locator(".source-list-item strong").last();
  expect(await title.evaluate((el) => el.clientHeight)).toBeLessThanOrEqual(43);
  await expect(page.locator(".source-list-item").last()).toHaveAttribute(
    "title",
    /SSH Brute Force/,
  );
  await page.locator(".source-list-item").first().click();
  await page.locator(".source-list-item").last().click();
  const afterSelection = await shell(page);
  expect(afterSelection.width).toBe(baseline.width);
  expect(afterSelection.height).toBe(baseline.height);
  for (const tab of ["From URL", "Import File", "Library"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const box = await shell(page);
    expect(box.height).toBe(baseline.height);
    expect(box.footerTop).toBe(baseline.footerTop);
  }
});

test("Explorer fits tablet, mobile and zoom-equivalent viewports with accessible shell/actions", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 900, height: 600 },
    { width: 768, height: 650 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 720, height: 480 },
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => {
      const rect = document
        .querySelector(".scenario-explorer")!
        .getBoundingClientRect();
      return rect.width <= innerWidth && rect.height <= innerHeight;
    });
    const box = await shell(page);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(viewport.height);
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.overflow).toBe(false);
    expect(box.footerBottom).toBeLessThanOrEqual(box.bottom);
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Use Scenario" }),
    ).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Browse sources", exact: true })
    .click();
  await page.locator(".source-list-item").click();
  await expect(
    page.getByRole("button", { name: "Preview source", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".source-preview")).toBeVisible();
  await capture(page, testInfo, "explorer-mobile-preview");
  await page
    .getByRole("button", { name: "Browse sources", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search scenarios" }),
  ).toBeVisible();
});

test("agent selector is first, preserves workspace state, and header Settings sits beside profile", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  const sections = page.locator(".sidebar-form > .sidebar-section");
  await expect(sections.nth(0)).toContainText("AI AGENT / MODEL");
  await expect(sections.nth(1)).toContainText("SCENARIO SOURCE");
  await expect(sections.nth(2)).toContainText("ADDITIONAL CONTEXT");
  const agent = page.getByRole("combobox", { name: "AI Agent / Model" });
  await expect(agent).toHaveValue("demo-runner");
  await page
    .getByRole("textbox", { name: "Additional Context", exact: true })
    .fill("Protected source context");
  await agent.selectOption("none");
  await expect(page.locator("#agent-availability")).toContainText(
    "No agents/models configured",
  );
  await expect(
    page.getByRole("textbox", { name: "Additional Context", exact: true }),
  ).toHaveValue("Protected source context");
  await expect(
    page.getByRole("button", { name: "Open Scenario Explorer" }),
  ).toContainText("Endpoint compromise");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(agent).toHaveValue("none");
  await page
    .getByRole("textbox", { name: "Additional Context", exact: true })
    .fill("");
  await agent.selectOption("demo-runner");
  const settings = page.getByRole("button", { name: "Open settings" });
  await expect(settings).toHaveCount(1);
  expect(
    await settings.evaluate(
      (el) =>
        el.closest(".top-header") !== null &&
        el.nextElementSibling?.classList.contains("avatar"),
    ),
  ).toBe(true);
  const hit = (await settings.boundingBox())!;
  expect(hit.width).toBeGreaterThanOrEqual(40);
  expect(hit.height).toBeGreaterThanOrEqual(40);
  await capture(page, testInfo, "application-desktop");
  await page.getByRole("button", { name: "Collapse scenario drawer" }).click();
  await page.getByRole("button", { name: "Collapse node inspector" }).click();
  await settings.click();
  await expect(
    page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("switch", { name: "Context relationships" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.getByRole("button", { name: "Open settings" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(settings).toBeInViewport();
});

test("short sidebar keeps header and Run visible while form scrolls", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  const form = page.locator(".sidebar-form");
  expect(await form.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
    true,
  );
  await form.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(page.locator(".left-drawer .drawer-title")).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Run demonstration" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Run demonstration" }).click();
  await page.getByRole("button", { name: "Pause demonstration" }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.getByRole("button", { name: "Expand scenario drawer" }).click();
  await expect(
    page.getByRole("button", { name: "Resume demo" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await expect(
    page.getByRole("button", { name: "Open settings" }),
  ).toBeInViewport();
  await capture(page, testInfo, "application-mobile-drawer");
});
