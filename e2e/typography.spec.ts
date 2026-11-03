import { expect, test, type Page } from "@playwright/test";

async function size(page: Page, selector: string, pseudo?: string) {
  return page
    .locator(selector)
    .first()
    .evaluate(
      (element, pseudo) =>
        parseFloat(getComputedStyle(element, pseudo).fontSize),
      pseudo,
    );
}
async function selectNode(page: Page, name = "Assess threat") {
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: new RegExp(name) }).click();
}
async function checkOverflow(page: Page, selector: string) {
  return page.locator(selector).evaluate((root) =>
    [root, ...root.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const el = element as HTMLElement;
        const style = getComputedStyle(el);
        if (
          !el.clientWidth ||
          style.display === "none" ||
          el.closest("[inert]") ||
          el instanceof HTMLSelectElement ||
          el instanceof HTMLTextAreaElement
        )
          return false;
        return el.scrollWidth > el.clientWidth + 1;
      })
      .map((element) => ({
        tag: element.tagName,
        class: element.className,
        text: element.textContent?.slice(0, 90),
      })),
  );
}

test("sidebar fonts scale 30%, workspace fonts 5%, and dialogs/header remain at original sizes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  for (const [selector, original] of [
    [".drawer-title", 12],
    [".agent-section .section-label", 9],
    ["#agent-model", 11],
    [".scenario-source-selector strong", 11],
    [".scenario-source-selector small", 8],
    ["#additional-context", 11],
    ["#context-count", 8],
    [".demo-controls .run-button", 11],
  ] as const)
    expect(await size(page, selector)).toBeCloseTo(original * 1.3, 2);
  expect(await size(page, "#additional-context", "::placeholder")).toBeCloseTo(
    14.3,
    2,
  );
  for (const [selector, original] of [
    [".stage-title-main h1", 23],
    [".stage-title-main p", 11],
    [".view-tabs button", 10],
    [".graph-label", 9],
    [".graph-label small", 7],
    [".drag-hint", 8],
    [".graph-legend", 8],
  ] as const)
    expect(await size(page, selector)).toBeCloseTo(original * 1.05, 2);
  expect(await size(page, ".brand")).toBe(25);
  await selectNode(page);
  for (const [selector, original] of [
    [".right-drawer .node-detail h2", 20],
    [".right-drawer .detail-description", 11],
    [".right-drawer .status-pill", 8],
    [".right-drawer .detail-properties dd", 9],
    [".right-drawer .related-nodes button", 9],
  ] as const)
    expect(await size(page, selector)).toBeCloseTo(original * 1.3, 2);
  expect(await size(page, ".agent-select-value")).toBeCloseTo(14.3, 2);
  expect(
    await page
      .locator(".agent-select-value")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  expect(await checkOverflow(page, ".left-drawer-inner")).toEqual([]);
  expect(await checkOverflow(page, ".right-drawer-inner")).toEqual([]);
  await page.getByRole("button", { name: "Open settings" }).click();
  expect(await size(page, ".settings-dialog h2")).toBe(23);
  expect(await size(page, ".settings-dialog .section-label")).toBe(9);
  expect(await size(page, ".settings-dialog .switch-row")).toBe(10);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  expect(await size(page, ".explorer-header h2")).toBe(23);
  expect(await size(page, ".source-preview-name")).toBe(19);
  expect(await size(page, ".source-raw-preview")).toBe(12);
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "/tmp/opencode/4sight-typography-desktop.png",
  });
  const label = page
    .locator(".graph-label")
    .filter({ hasText: "Assess threat" });
  const labelRect = (await label.boundingBox())!;
  await page.mouse.move(labelRect.x - 13, labelRect.y + 13);
  await expect(page.getByRole("tooltip")).toBeVisible();
  expect(await size(page, ".node-tooltip strong")).toBeCloseTo(10 * 1.05, 2);
  expect(await size(page, ".node-tooltip p")).toBeCloseTo(8 * 1.05, 2);
  await page.mouse.move(1, 1);
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await selectNode(page);
  expect(await size(page, ".immersive-detail h2")).toBeCloseTo(18 * 1.05, 2);
  expect(await size(page, ".immersive-detail .detail-description")).toBeCloseTo(
    10 * 1.05,
    2,
  );
  expect(await checkOverflow(page, ".immersive-detail")).toEqual([]);
});

test("responsive typography preserves scrollable drawers, wrapping and workspace controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto("/");
  await selectNode(page, "Review & report");
  await expect(
    page.getByRole("button", { name: "Run demonstration" }),
  ).toBeInViewport();
  const form = page.locator(".sidebar-form");
  await form.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await form.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const inspector = page.locator(".inspector-scroll");
  await inspector.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await inspector.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".left-drawer .drawer-title")).toBeInViewport();
  for (const width of [768, 390, 320]) {
    await page.setViewportSize({ width, height: 568 });
    await page.waitForFunction(
      (width) =>
        innerWidth === width && !document.querySelector(".left-drawer.is-open"),
      width,
    );
    if (
      await page.getByRole("button", { name: "Expand scenario drawer" }).count()
    )
      await page
        .getByRole("button", { name: "Expand scenario drawer" })
        .click();
    expect(await checkOverflow(page, ".left-drawer-inner")).toEqual([]);
    await expect(
      page.getByRole("button", { name: "Run demonstration" }),
    ).toBeInViewport();
    if (width === 320) {
      await page
        .getByRole("textbox", { name: "Additional Context", exact: true })
        .fill("Protected internal source context.");
      await page.screenshot({
        path: "/tmp/opencode/4sight-typography-mobile-sidebar.png",
      });
    }
    await page
      .getByRole("button", { name: "Collapse scenario drawer" })
      .click();
    await page.getByRole("button", { name: "Expand node inspector" }).click();
    expect(await checkOverflow(page, ".right-drawer-inner")).toEqual([]);
    expect(await size(page, ".right-drawer .detail-description")).toBeCloseTo(
      11 * 1.3,
      2,
    );
    if (width === 320)
      await page.screenshot({
        path: "/tmp/opencode/4sight-typography-mobile-inspector.png",
      });
    await page.getByRole("button", { name: "Collapse node inspector" }).click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    expect(
      await page.locator(".stage-top").evaluate((root) => {
        const bounds = root.getBoundingClientRect();
        return [...root.querySelectorAll<HTMLElement>("h1,p,.stage-subtoolbar")]
          .map((el) => ({
            text: el.textContent,
            bottom: el.getBoundingClientRect().bottom,
            limit: bounds.bottom,
          }))
          .filter((item) => item.bottom > item.limit + 1);
      }),
    ).toEqual([]);
    if (width <= 600) {
      expect(await size(page, ".stage-title-main h1")).toBeCloseTo(
        22 * 1.05,
        2,
      );
      expect(await size(page, ".graph-label")).toBeCloseTo(8 * 1.05, 2);
    }
  }
  await page.screenshot({ path: "/tmp/opencode/4sight-typography-mobile.png" });
});
