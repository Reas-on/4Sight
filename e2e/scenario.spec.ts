import { expect, test, type Page } from "@playwright/test";

const browserErrors = new WeakMap<Page, string[]>();
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
});

test("Explorer search, technique filters, preview and cancel preserve committed source/context", async ({
  page,
}) => {
  const input = page.getByRole("textbox", {
    name: "Additional Context",
    exact: true,
  });
  await input.fill(
    "Assume the source IP belongs to a protected internal server.",
  );
  const selector = page.getByRole("button", { name: "Open Scenario Explorer" });
  await expect(selector).toContainText("Endpoint compromise");
  await selector.click();
  const explorer = page.getByRole("dialog", { name: "Scenario Explorer" });
  await expect(explorer).toBeVisible();
  await page.getByRole("tab", { name: "Library", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Import File" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("tab", { name: "Library", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("textbox", { name: "Search scenarios" }).fill("missing");
  await expect(page.locator(".source-list-item")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Search scenarios" })
    .fill("endPOINT");
  await expect(page.locator(".source-list-item")).toHaveCount(1);
  await page
    .getByLabel("MITRE technique", { exact: true })
    .selectOption("T1059");
  await page.locator(".source-list-item").click();
  await expect(page.locator(".source-preview")).toContainText(
    "Endpoint compromise",
  );
  await page
    .getByLabel("Source category", { exact: true })
    .selectOption("mitre_attack");
  await page.getByRole("textbox", { name: "Search scenarios" }).fill("ssh");
  await page
    .getByLabel("MITRE technique", { exact: true })
    .selectOption("T1110.001");
  await page.locator(".source-list-item").click();
  await expect(page.locator(".source-preview")).toContainText(
    "sample, not live",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(selector).toContainText("Endpoint compromise");
  await expect(input).toHaveValue(
    "Assume the source IP belongs to a protected internal server.",
  );
  await selector.click();
  await page
    .getByLabel("Source category", { exact: true })
    .selectOption("mitre_attack");
  await page.locator(".source-list-item").click();
  await page.getByRole("button", { name: "Use Scenario" }).click();
  await expect(selector).toContainText("SSH Brute Force");
  await expect(selector).toContainText("MITRE ATT&CK");
  await expect(input).toHaveValue(
    "Assume the source IP belongs to a protected internal server.",
  );
  await expect(
    page.getByRole("button", { name: "Evaluation unavailable" }),
  ).toBeDisabled();
  await input.fill("");
  await expect(page.locator("#composition-status")).toContainText(
    "preview-only",
  );
});

test("all external source adapters distinguish sample material from executable scenarios", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  for (const [category, material] of [
    ["mitre_attack", "technique metadata"],
    ["sigma", "detection rule"],
    ["atomic_red_team", "test definition"],
  ] as const) {
    await page
      .getByLabel("Source category", { exact: true })
      .selectOption(category);
    await page.locator(".source-list-item").click();
    await expect(page.locator(".source-preview")).toContainText(material);
    await expect(page.locator(".source-preview")).toContainText(
      "sample, not live",
    );
    await expect(page.locator(".source-capability")).toContainText(
      "Not a validated executable scenario",
    );
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Open Scenario Explorer" }),
  ).toContainText("Endpoint compromise");
});

test("local file import validates format/content and commits inert preview only on confirmation", async ({
  page,
}) => {
  await page
    .getByRole("textbox", { name: "Additional Context", exact: true })
    .fill("Retained context");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("tab", { name: "Import File" }).click();
  const upload = page.getByLabel("Import source file");
  const use = page.getByRole("button", { name: "Use Scenario" });
  for (const [name, content, error] of [
    ["invalid.json", "{bad}", "Invalid JSON"],
    ["test.exe", "file", "Choose a JSON"],
    ["blank.log", "  ", "contains no text"],
    ["binary.txt", "\0data", "binary"],
    ["alias.yaml", "a: &a [one]\nb: *a", "aliases"],
  ] as const) {
    await upload.setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
    await expect(page.getByRole("alert")).toContainText(error);
    await expect(use).toBeDisabled();
  }
  await upload.setInputFiles({
    name: "huge.log",
    mimeType: "text/plain",
    buffer: Buffer.alloc(256 * 1024 + 1, 97),
  });
  await expect(page.getByRole("alert")).toContainText("256 KiB");
  const content =
    "title: Imported SSH context\ndescription: Inert sample material\ntechnique: T1110.001\ncommand: echo not-executed";
  await upload.setInputFiles({
    name: "ssh.yml",
    mimeType: "text/yaml",
    buffer: Buffer.from(content),
  });
  await expect(page.locator(".source-preview")).toContainText(
    "Imported SSH context",
  );
  await expect(page.getByLabel("Source text preview")).toContainText(
    "command: echo not-executed",
  );
  await expect(use).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open Scenario Explorer" }),
  ).toContainText("Endpoint compromise");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("tab", { name: "Import File" }).click();
  await upload.setInputFiles({
    name: "evidence.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        name: "Imported evidence",
        description: "<script>window.bad=true</script>",
        technique: "T1110.001",
      }),
    ),
  });
  await expect(page.locator(".source-preview")).toContainText(
    "<script>window.bad=true</script>",
  );
  await use.click();
  await expect(
    page.getByRole("button", { name: "Open Scenario Explorer" }),
  ).toContainText("Imported evidence");
  await expect(
    page.getByRole("textbox", { name: "Additional Context", exact: true }),
  ).toHaveValue("Retained context");
  expect(
    await page.evaluate(() => (window as unknown as { bad?: boolean }).bad),
  ).toBeUndefined();
  await page
    .getByRole("textbox", { name: "Additional Context", exact: true })
    .fill("");
  await expect(
    page.getByRole("button", { name: "Evaluation unavailable" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page
    .getByLabel("Source category", { exact: true })
    .selectOption("local_file");
  await expect(page.locator(".source-list-item")).toContainText(
    "Imported evidence",
  );
});

test("URL validation reports unavailable retrieval and makes no outbound request", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("example.org")) requests.push(request.url());
  });
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("tab", { name: "From URL" }).click();
  const url = page.getByRole("textbox", { name: "Source URL" });
  await url.fill("javascript:alert(1)");
  await page.getByRole("button", { name: "Check URL" }).click();
  await expect(page.locator(".import-status")).toContainText("HTTP or HTTPS");
  await url.fill("https://example.org/scenario.yml");
  await page.getByRole("button", { name: "Check URL" }).click();
  await expect(page.locator(".import-status")).toContainText(
    "No request was sent",
  );
  await expect(
    page.getByRole("button", { name: "Use Scenario" }),
  ).toBeDisabled();
  expect(requests).toEqual([]);
});

test("TXT, LOG and YAML previews are supported, and imports cannot declare themselves executable", async ({
  page,
}) => {
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("tab", { name: "Import File" }).click();
  for (const [name, content] of [
    ["context.txt", "Literal context\nT1110.001"],
    ["sensor.log", "2026-11-02 SSH auth failure"],
    ["rule.yaml", "title: YAML source\ntags:\n  - attack.t1059.001"],
    [
      "forged.json",
      JSON.stringify({
        id: "builtin:endpoint-compromise",
        name: "Forged built-in",
        sourceType: "builtin",
        executable: true,
      }),
    ],
  ] as const) {
    await page.getByLabel("Import source file").setInputFiles({
      name,
      mimeType: "text/plain",
      buffer: Buffer.from(content),
    });
    await expect(page.getByLabel("Source text preview")).toContainText(
      name.endsWith(".json")
        ? JSON.stringify(JSON.parse(content), null, 2)
        : content,
    );
    await expect(page.locator(".source-capability")).toContainText(
      "Preview-only",
    );
  }
  await page.getByRole("button", { name: "Use Scenario" }).click();
  await expect(
    page.getByRole("button", { name: "Open Scenario Explorer" }),
  ).toContainText("Local file");
  await expect(
    page.getByRole("button", { name: "Evaluation unavailable" }),
  ).toBeDisabled();
});

test("Explorer remains within a mobile viewport and predefined demo still runs with empty context", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand scenario drawer" }).click();
  await expect(
    page.getByRole("textbox", { name: "Additional Context", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  const explorer = page.getByRole("dialog", { name: "Scenario Explorer" });
  const rect = (await explorer.boundingBox())!;
  expect(rect.width).toBeLessThanOrEqual(390);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  await page.locator(".source-list-item").click();
  await page.getByRole("button", { name: "Use Scenario" }).click();
  await page.getByRole("button", { name: "Run demonstration" }).click();
  await expect(
    page.getByRole("button", { name: "Pause demonstration" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause demonstration" }).click();
});
