import { test, expect, type Page } from "@playwright/test";
import { HOLD_DURATION } from "../src/hooks/useHoldShortcut";
import { ADDITIONAL_CONTEXT_MAX_LENGTH } from "../src/data/scenario";
const consoleErrors = new WeakMap<Page, string[]>();

test.afterEach(async ({ page }) => {
  const errors = await page.evaluate(
    () =>
      (window as unknown as { runtimeErrors?: string[] }).runtimeErrors ?? [],
  );
  expect(errors).toEqual([]);
  expect(consoleErrors.get(page) ?? []).toEqual([]);
});
test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  consoleErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    const errors: string[] = [];
    (window as unknown as { runtimeErrors: string[] }).runtimeErrors = errors;
    window.addEventListener("error", (event) => errors.push(event.message));
    window.addEventListener("unhandledrejection", (event) =>
      errors.push(String(event.reason)),
    );
  });
});

test("3D picking, persistent selection, immersive transition, and drawer restoration", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator(".graph-error")).toHaveCount(0);
  await expect(page.locator(".graph-label")).toHaveCount(5);
  await page.evaluate(() => {
    (
      window as unknown as { savedCanvas: HTMLCanvasElement | null }
    ).savedCanvas = document.querySelector("canvas");
  });
  const label = page
    .locator(".graph-label")
    .filter({ hasText: "Receive alert" });
  await expect(label).toHaveCSS("opacity", "1");
  const rect = (await label.boundingBox())!;
  await page.mouse.move(rect.x - 13, rect.y + 13);
  await expect(page.locator(".node-tooltip")).toContainText("Receive alert");
  await page.mouse.click(rect.x - 13, rect.y + 13);
  await page.mouse.move(5, 5);
  await expect(page.locator(".right-drawer h2")).toHaveText("Receive alert");
  await page.getByRole("button", { name: "Collapse scenario drawer" }).click();
  await expect(page.locator(".left-drawer")).toHaveCSS("width", "0px");
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "immersive");
  await expect(page.locator(".top-header")).toHaveCSS("height", "0px");
  await expect(page.locator(".right-drawer")).toHaveCSS("width", "0px");
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: /Assess threat/ }).click();
  await expect(page.locator(".immersive-detail h2")).toHaveText(
    "Assess threat",
  );
  await page
    .locator(".immersive-detail")
    .getByRole("button", { name: "Dismiss node details" })
    .click();
  await expect(page.locator(".immersive-detail")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await expect(page.locator(".left-drawer")).toHaveCSS("width", "0px");
  await expect(page.locator(".inspector-empty")).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { savedCanvas: HTMLCanvasElement | null })
          .savedCanvas === document.querySelector("canvas"),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("Space hold toggles only once, supports a second hold, and excludes typing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await page.locator("body").click({ position: { x: 700, y: 400 } });
  // Exact 799/800ms boundaries are verified with the monotonic fake clock.
  // Keep this real input a tap: software GL can delay host-side waits heavily.
  await page.keyboard.press("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
  await page.keyboard.down("Space");
  await page.waitForTimeout(HOLD_DURATION + 100);
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
  await page.waitForTimeout(1900);
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
  await page.keyboard.up("Space");
  await page.keyboard.down("Space");
  await page.waitForTimeout(HOLD_DURATION + 100);
  await page.keyboard.up("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("textbox", { name: "Find a node" }).focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(HOLD_DURATION + 100);
  await page.keyboard.up("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
});

test("responsive overlays and step selection work without overflow", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await expect(page.locator(".step-card")).toHaveCount(5);
  await page.locator(".step-card").last().click();
  await expect(page.locator(".right-drawer h2")).toHaveText("Review & report");
  await page.getByRole("button", { name: "Graph", exact: true }).click();
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
  }
  await page.getByRole("button", { name: "Expand scenario drawer" }).click();
  await expect(page.locator(".left-drawer")).toHaveCSS("visibility", "visible");
  await page.getByRole("button", { name: "Collapse scenario drawer" }).click();
  await page.getByRole("button", { name: "Expand node inspector" }).click();
  await expect(page.locator(".right-drawer")).toHaveCSS(
    "visibility",
    "visible",
  );
});

test("intro finishes once, ambient camera orbits, and manual drag takes control", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  const label = page.locator(".graph-label").first();
  const initial = await label.evaluate((el) => el.style.transform);
  await page.waitForTimeout(1500);
  expect(await label.evaluate((el) => el.style.transform)).not.toBe(initial);
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "immersive");
  const canvas = (await page.locator("canvas").boundingBox())!;
  const beforeDrag = await label.evaluate((el) => el.style.transform);
  await page.mouse.move(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas.x + canvas.width / 2 + 120,
    canvas.y + canvas.height / 2 + 30,
    { steps: 8 },
  );
  await page.mouse.up();
  expect(await label.evaluate((el) => el.style.transform)).not.toBe(beforeDrag);
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await expect(page.locator(".intro-caption")).toHaveCount(0);
});

test("reduced motion holds the idle network still", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  const label = page.locator(".graph-label").first();
  await expect(label).toHaveCSS("opacity", "1");
  const initial = await label.evaluate((el) => el.style.transform);
  await page.waitForTimeout(1200);
  expect(await label.evaluate((el) => el.style.transform)).toBe(initial);
});

test("immersive cursor uses double short Space without interfering with hold or picking", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  const canvas = page.locator("canvas");
  await canvas.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(HOLD_DURATION + 100);
  await page.keyboard.up("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-cursor", "hidden");
  await expect(canvas).toHaveCSS("cursor", "none");
  // Queue trusted native events together: host round trips under software GL
  // must not stretch a deliberate double-tap beyond the 350ms gesture window.
  const keys = await page.context().newCDPSession(page);
  const doubleTap = () => Promise.all(["rawKeyDown", "keyUp", "rawKeyDown", "keyUp"].map(type => keys.send("Input.dispatchKeyEvent", {type: type as "rawKeyDown" | "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32})));
  await doubleTap();
  await expect(page.locator(".app")).toHaveAttribute("data-cursor", "visible");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
  await doubleTap();
  await expect(page.locator(".app")).toHaveAttribute("data-cursor", "hidden");
  await keys.detach();
  const label = page
    .locator(".graph-label")
    .filter({ hasText: "Receive alert" });
  const rect = (await label.boundingBox())!;
  await page.mouse.click(rect.x - 13, rect.y + 13);
  await expect(page.locator(".immersive-detail h2")).toHaveText(
    "Receive alert",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).toHaveAttribute("data-cursor", "visible");
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-cursor", "hidden");
});

test("empty-space and details close clear selection; details clicks are contained", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: /Assess threat/ }).click();
  await page.locator(".detail-description").click();
  await expect(page.locator(".right-drawer h2")).toHaveText("Assess threat");
  await page.getByRole("button", { name: "Dismiss node details" }).click();
  await expect(page.locator(".inspector-empty")).toBeVisible();
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: /Receive alert/ }).click();
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.click(canvas.x + 12, canvas.y + canvas.height / 2);
  await expect(page.locator(".inspector-empty")).toBeVisible();
  await expect(page.locator('.graph-label[data-active="true"]')).toHaveCount(0);
});

test("arrow keys orbit only while graph owns focus, not inspector controls", async ({
  page,
}) => {
  await page.goto("/");
  const label = page.locator(".graph-label").first();
  await expect(label).toHaveCSS("opacity", "1");
  const canvas = page.locator("canvas");
  await canvas.focus();
  const before = await label.evaluate((el) => el.style.transform);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowRight");
  expect(await label.evaluate((el) => el.style.transform)).not.toBe(before);
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  const settled = await label.evaluate((el) => el.style.transform);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(300);
  await page.keyboard.up("ArrowLeft");
  expect(await label.evaluate((el) => el.style.transform)).toBe(settled);
});

test("connected navigation and Center animate, retarget, and yield to manual drag", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: /Assess threat/ }).click();
  const label = page
    .locator(".graph-label")
    .filter({ hasText: "Enrich context" });
  await page
    .locator(".related-nodes button")
    .filter({ hasText: "Enrich context" })
    .click();
  await expect(page.locator(".right-drawer h2")).toHaveText("Enrich context");
  const early = await label.evaluate((el) => el.style.transform);
  await page.waitForTimeout(250);
  const middle = await label.evaluate((el) => el.style.transform);
  expect(middle).not.toBe(early);
  await page
    .locator(".related-nodes button")
    .filter({ hasText: "Receive alert" })
    .click();
  await expect(page.locator(".right-drawer h2")).toHaveText("Receive alert");
  const canvas = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(
    canvas.x + canvas.width / 2,
    canvas.y + canvas.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    canvas.x + canvas.width / 2 + 100,
    canvas.y + canvas.height / 2 + 15,
    { steps: 6 },
  );
  await page.mouse.up();
  await page.waitForTimeout(850);
  await page.getByRole("button", { name: "Recenter graph" }).click();
  const centerEarly = await label.evaluate((el) => el.style.transform);
  await page.waitForTimeout(250);
  expect(await label.evaluate((el) => el.style.transform)).not.toBe(
    centerEarly,
  );
  await page.getByRole("button", { name: "Recenter graph" }).click();
  await page.waitForTimeout(1100);
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(page.locator(".right-drawer h2")).toHaveText("Receive alert");
});

test("default-on layered audio produces output and ambience persists at idle", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.removeItem("4sight-intro-sound");
    const probe = { peak: 0, contexts: [] as AudioContext[] };
    (window as unknown as { audioProbe: typeof probe }).audioProbe = probe;
    const originalConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (
      destination: AudioNode | AudioParam,
      ...args: number[]
    ) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 256;
        originalConnect.call(this, analyser);
        originalConnect.call(analyser, destination);
        const samples = new Float32Array(256);
        const timer = setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          for (const sample of samples)
            probe.peak = Math.max(probe.peak, Math.abs(sample));
        }, 10);
        setTimeout(() => clearInterval(timer), 15000);
        return destination;
      }
      return (originalConnect as (...input: unknown[]) => AudioNode).call(
        this,
        destination,
        ...args,
      );
    } as typeof AudioNode.prototype.connect;
    const log: { stage: string | undefined; elapsed: number; state: string }[] =
      [];
    (window as unknown as { audioLog: typeof log }).audioLog = log;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const oscillator = original.call(this);
      if (!probe.contexts.includes(this)) probe.contexts.push(this);
      const start = oscillator.start.bind(oscillator);
      const audio = this;
      oscillator.start = (when?: number) => {
        log.push({
          stage:
            document.querySelector<HTMLElement>(".app")?.dataset.introStage,
          elapsed: performance.now(),
          state: audio.state,
        });
        start(when);
      };
      return oscillator;
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // A trusted early pointer gesture may unlock playback, but no cue is backfilled.
  await page.waitForSelector("canvas");
  await page.locator("canvas").click({ position: { x: 12, y: 120 } });
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  const log = await page.evaluate(
    () =>
      (window as unknown as { audioLog: { stage: string; state: string }[] })
        .audioLog,
  );
  expect(log.every((cue) => cue.state === "running")).toBe(true);
  expect(log.length).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { audioProbe: { peak: number } }).audioProbe
            .peak,
      ),
    )
    .toBeGreaterThan(0.001);
  console.log(
    "Measured intro output peak:",
    await page.evaluate(
      () =>
        (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak,
    ),
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak,
    ),
  ).toBeLessThan(0.9);
  await expect(
    page.getByRole("button", { name: "Mute intro sound" }),
  ).toHaveAttribute("aria-pressed", "true");
  const count = log.length;
  await page.waitForTimeout(800);
  expect(
    await page.evaluate(
      () => (window as unknown as { audioLog: unknown[] }).audioLog.length,
    ),
  ).toBe(count);
  await page.evaluate(() => {
    (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak = 0;
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { audioProbe: { peak: number } }).audioProbe
            .peak,
      ),
    )
    .toBeGreaterThan(0.00001);
  await page.getByRole("button", { name: "Mute intro sound" }).click();
  expect(
    await page.evaluate(() => localStorage.getItem("4sight-intro-sound")),
  ).toBe("off");
  await expect(
    page.getByRole("button", { name: "Enable intro sound" }),
  ).toBeVisible();
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak = 0;
  });
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { audioProbe: { peak: number } }).audioProbe.peak,
    ),
  ).toBeLessThan(0.0001);
  await page.getByRole("button", { name: "Enable intro sound" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { audioProbe: { peak: number } }).audioProbe
            .peak,
      ),
    )
    .toBeGreaterThan(0.00001);
});

test("saved audio mute remains effective and enabling after intro does not replay startup", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    localStorage.setItem("4sight-intro-sound", "off");
    let count = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      count++;
      return original.call(this);
    };
    Object.defineProperty(window, "audioCount", { get: () => count });
  });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  await expect(
    page.getByRole("button", { name: "Enable intro sound" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Enable intro sound" }).click();
  await expect(
    page.getByRole("button", { name: "Mute intro sound" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => (window as unknown as { audioCount: number }).audioCount,
    ),
  ).toBe(6); // Three drones and three LFOs; no intro replay.
});

async function observeCamera(page: Page) {
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => /\/\.vite\/deps\/three\.js\?/.test(name));
    if (!url) throw new Error("Three.js module not loaded");
    const three = await import(/* @vite-ignore */ url);
    const original = three.PerspectiveCamera.prototype.updateMatrixWorld;
    three.PerspectiveCamera.prototype.updateMatrixWorld = function (
      force?: boolean,
    ) {
      (
        window as unknown as {
          cameraProbe: {
            position: number[];
            quaternion: number[];
            up: number[];
            x: number;
            y: number;
            z: number;
            distance: number;
            theta: number;
            phi: number;
          };
        }
      ).cameraProbe = {
        position: this.position.toArray(),
        quaternion: this.quaternion.toArray(),
        up: this.up.toArray(),
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
        distance: this.position.length(),
        theta: Math.atan2(this.position.x, this.position.z),
        phi: Math.acos(this.position.y / this.position.length()),
      };
      return original.call(this, force);
    };
  });
  await page.waitForFunction(
    () => !!(window as unknown as { cameraProbe: unknown }).cameraProbe,
  );
}
async function cameraSnapshot(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          cameraProbe: {
            position: number[];
            distance: number;
            theta: number;
            phi: number;
            quaternion: number[];
            up: number[];
          };
        }
      ).cameraProbe,
  );
}

test("horizontal, vertical, diagonal, and mouse-line wheel inputs orbit without zoom", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await observeCamera(page);
  const canvas = page.locator("canvas");
  const start = await cameraSnapshot(page);
  await canvas.dispatchEvent("wheel", {
    deltaX: 60,
    deltaY: 0,
    deltaMode: 0,
    bubbles: true,
    cancelable: true,
  });
  await expect
    .poll(async () =>
      Math.abs((await cameraSnapshot(page)).theta - start.theta),
    )
    .toBeGreaterThan(0.03);
  await expect
    .poll(async () => (await cameraSnapshot(page)).theta - start.theta)
    .toBeCloseTo(0.108, 3);
  const horizontal = await cameraSnapshot(page);
  expect(horizontal.phi).toBeCloseTo(start.phi, 3);
  expect(horizontal.distance).toBeCloseTo(start.distance, 5);
  await canvas.dispatchEvent("wheel", {
    deltaX: 0,
    deltaY: 60,
    deltaMode: 0,
    bubbles: true,
    cancelable: true,
  });
  await expect
    .poll(async () => (await cameraSnapshot(page)).phi - horizontal.phi)
    .toBeGreaterThan(0.03);
  await expect
    .poll(async () => (await cameraSnapshot(page)).phi - horizontal.phi)
    .toBeCloseTo(0.108, 3);
  const vertical = await cameraSnapshot(page);
  expect(vertical.theta).toBeCloseTo(horizontal.theta, 2);
  expect(vertical.distance).toBeCloseTo(start.distance, 5);
  await canvas.dispatchEvent("wheel", {
    deltaX: 40,
    deltaY: -40,
    deltaMode: 0,
    bubbles: true,
    cancelable: true,
  });
  await expect
    .poll(async () => (await cameraSnapshot(page)).theta - vertical.theta)
    .toBeGreaterThan(0.02);
  await expect
    .poll(async () => vertical.phi - (await cameraSnapshot(page)).phi)
    .toBeGreaterThan(0.02);
  await page.waitForTimeout(600);
  const diagonal = await cameraSnapshot(page);
  await canvas.dispatchEvent("wheel", {
    deltaX: 0,
    deltaY: 3,
    deltaMode: 1,
    bubbles: true,
    cancelable: true,
  });
  await expect
    .poll(async () => (await cameraSnapshot(page)).phi - diagonal.phi)
    .toBeGreaterThan(0.02);
  expect((await cameraSnapshot(page)).distance).toBeCloseTo(start.distance, 5);
  const rect = (await canvas.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, 80);
  await page.waitForTimeout(500);
  expect((await cameraSnapshot(page)).distance).toBeCloseTo(start.distance, 5);
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect
    .poll(async () => (await cameraSnapshot(page)).distance)
    .toBeLessThan(start.distance - 1);
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "immersive");
  await page.waitForTimeout(300);
  const immersive = await cameraSnapshot(page);
  await canvas.dispatchEvent("wheel", {
    deltaX: -60,
    deltaY: 0,
    deltaMode: 0,
    bubbles: true,
    cancelable: true,
  });
  await expect
    .poll(async () => immersive.theta - (await cameraSnapshot(page)).theta)
    .toBeGreaterThan(0.03);
});

test("wheel does not intercept sidebar/menu/details scroll; explicit Ctrl+scroll zoom remains", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await observeCamera(page);
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: /Assess threat/ }).click();
  const inspector = page.locator(".inspector-scroll");
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.waitForTimeout(300);
  const before = await cameraSnapshot(page);
  const box = (await inspector.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 180);
  await expect
    .poll(() => inspector.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  const after = await cameraSnapshot(page);
  expect(after.theta).toBeCloseTo(before.theta, 5);
  expect(after.phi).toBeCloseTo(before.phi, 5);
  const canvas = page.locator("canvas");
  const rect = (await canvas.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  const distance = after.distance;
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -50);
  await page.keyboard.up("Control");
  await expect
    .poll(async () => (await cameraSnapshot(page)).distance)
    .toBeLessThan(distance - 0.1);
});

test("fullscreen button focus cannot turn a short Space tap into a native click", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.locator("canvas")).toBeFocused();
  for (const duration of [100, 400]) {
    await page.keyboard.down("Space");
    await page.waitForTimeout(duration);
    await page.keyboard.up("Space");
    await expect(page.locator(".app")).toHaveAttribute(
      "data-immersive",
      "true",
    );
  }
  await page.keyboard.press("Space");
  await page.keyboard.press("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "true");
});

test("drag crosses poles repeatedly, picks an inverted node, and preserves orientation through navigation and Center", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await observeCamera(page);
  const canvas = page.locator("canvas");
  const rect = (await canvas.boundingBox())!;
  const initial = await cameraSnapshot(page);
  for (let i = 0; i < 5; i++) {
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height - 5);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + 5, { steps: 12 });
    await page.mouse.up();
  }
  const rotated = await cameraSnapshot(page);
  expect(rotated.distance).toBeCloseTo(initial.distance, 4);
  expect(rotated.quaternion.every(Number.isFinite)).toBe(true);
  expect(Math.hypot(...rotated.quaternion)).toBeCloseTo(1, 6);
  // Force a half revolution from the current frame with continuous real drag.
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: /Receive alert/ }).click();
  const label = page
    .locator(".graph-label")
    .filter({ hasText: "Receive alert" });
  const box = (await label.boundingBox())!;
  expect(box.x).toBeGreaterThan(rect.x + 15);
  expect(box.x).toBeLessThan(rect.x + rect.width - 20);
  expect(box.y).toBeGreaterThan(rect.y);
  expect(box.y).toBeLessThan(rect.y + rect.height);
  await page.mouse.click(box.x - 13, box.y + 13);
  await expect(page.locator(".right-drawer h2")).toHaveText("Receive alert");
  await page
    .locator(".related-nodes button")
    .filter({ hasText: "Enrich context" })
    .click();
  await expect(page.locator(".right-drawer h2")).toHaveText("Enrich context");
  await page.getByRole("button", { name: "Recenter graph" }).click();
  await page.waitForTimeout(200);
  const centered = await cameraSnapshot(page);
  const dot = centered.quaternion.reduce(
    (sum, v, i) => sum + v * rotated.quaternion[i],
    0,
  );
  expect(Math.abs(dot)).toBeCloseTo(1, 4);
});

test("audio event log follows committed demo progression and deliberate selection/navigation", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const events: string[] = [];
  page.on("console", (message) => {
    const match = message.text().match(/\[4Sight audio\] Event (\w+)/);
    if (match) events.push(match[1]);
  });
  await page.goto("/");
  await page.locator("canvas").click({ position: { x: 12, y: 120 } });
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  await page.getByRole("button", { name: "Browse graph nodes" }).click();
  await page.getByRole("button", { name: /Assess threat/ }).click();
  await page
    .locator(".related-nodes button")
    .filter({ hasText: "Enrich context" })
    .click();
  await page.getByRole("button", { name: "Run demonstration" }).click();
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Pause demonstration" }).click();
  expect(events).toContain("NODE_SELECTED");
  expect(events).toContain("NODE_NAVIGATED");
  expect(events).toContain("NODE_ENTERED");
  expect(events).toContain("NODE_COMPLETED");
  expect(events).not.toContain("NODE_FAILED");
  expect(events).not.toContain("NODE_INTERCEPTED");
  await page.getByRole("button", { name: "Resume demo" }).click();
  await expect(page.locator(".demo-control-title")).toContainText(
    "Demo complete",
    { timeout: 12000 },
  );
  expect(events.filter((event) => event === "NODE_ENTERED")).toHaveLength(5);
  expect(events.filter((event) => event === "NODE_COMPLETED")).toHaveLength(5);
  expect(
    events.filter((event) => event === "SIMULATION_COMPLETED"),
  ).toHaveLength(1);
});

test("touch pinch and right-drag pan preserve quaternion orbit distance/target behavior", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await observeCamera(page);
  const rect = (await page.locator("canvas").boundingBox())!;
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  const before = await cameraSnapshot(page);
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: x - 40, y, id: 1 },
      { x: x + 40, y, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: x - 70, y, id: 1 },
      { x: x + 70, y, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => (await cameraSnapshot(page)).distance)
    .toBeLessThan(before.distance - 2);
  await page.mouse.move(x, y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(x + 50, y + 10, { steps: 5 });
  await page.mouse.up({ button: "right" });
  await page.getByRole("button", { name: "Recenter graph" }).click();
  await expect(page.locator(".graph-error")).toHaveCount(0);
  await client.detach();
});

test("Additional Context stays independent, optional, retained and never silently ignored", async ({
  page,
}) => {
  await page.goto("/");
  const scenario = page.getByRole("button", { name: "Open Scenario Explorer" });
  const input = page.getByRole("textbox", {
    name: "Additional Context",
    exact: true,
  });
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute("name", "additionalContext");
  await expect(input).toHaveAttribute(
    "maxlength",
    String(ADDITIONAL_CONTEXT_MAX_LENGTH),
  );
  await input.focus();
  await input.blur();
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(
    page.getByRole("button", { name: "Run demonstration" }),
  ).toBeEnabled();
  const run = page.getByRole("button", {
    name: "Evaluation unavailable",
  });
  const draft =
    "SIEM alert: unexpected PowerShell activity\nHost: SOC-DEMO-01\nInvestigate the observed process.";
  await input.fill(draft);
  await expect(run).toBeDisabled();
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#context-count")).toContainText(
    String(draft.length),
  );
  await expect(page.locator("#composition-status")).toContainText(
    "cannot evaluate composed inputs",
  );
  await expect(page.locator(".stage-title-main")).toContainText(
    "not generated from the selected source or context",
  );
  await scenario.click();
  await page.getByRole("button", { name: /Endpoint compromise/ }).click();
  await page.getByRole("button", { name: "Use Scenario" }).click();
  await expect(scenario).toContainText("Endpoint compromise");
  await expect(input).toHaveValue(draft);
  await input.fill("a".repeat(ADDITIONAL_CONTEXT_MAX_LENGTH));
  await input.press("End");
  await input.press("b");
  await expect(input).toHaveValue("a".repeat(ADDITIONAL_CONTEXT_MAX_LENGTH));
  await input.fill("  \n ");
  await input.blur();
  await expect(input).toHaveAttribute("aria-invalid", "false");
  await input.fill(draft + "\nEdited context.");
  await input.focus();
  await page.keyboard.down("Space");
  await page.waitForTimeout(HOLD_DURATION + 50);
  await page.keyboard.up("Space");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Expand scenario drawer" }).click();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue(draft + "\nEdited context. ");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});

test("editing Additional Context pauses the reference workflow until unsupported composition is cleared", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Run demonstration" }).click();
  await page
    .getByRole("textbox", { name: "Additional Context", exact: true })
    .fill("Custom incident context");
  await page.waitForTimeout(1800);
  await expect(page.locator(".demo-control-title")).toContainText(
    "not executed",
  );
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Additional Context", exact: true })
    .fill("");
  await expect(page.getByRole("button", { name: "Resume demo" })).toBeEnabled();
  await expect(page.locator(".demo-control-title")).toContainText(
    "Demo paused",
  );
});

test("Context relationships exists only in Settings and updates visible metadata without remounting", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toHaveCount(1);
  await expect(
    page
      .locator(".left-drawer")
      .getByRole("switch", { name: "Context relationships" }),
  ).toHaveCount(0);
  await page.evaluate(async () => {
    const url = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .find((name) => /\/\.vite\/deps\/three\.js\?/.test(name));
    if (!url) throw new Error("Three.js missing");
    const three = await import(/* @vite-ignore */ url);
    const original = three.Object3D.prototype.updateMatrixWorld;
    const visible: Record<string, boolean> = {};
    (
      window as unknown as {
        nodeVisibility: typeof visible;
        savedCanvas: HTMLCanvasElement | null;
      }
    ).nodeVisibility = visible;
    (
      window as unknown as { savedCanvas: HTMLCanvasElement | null }
    ).savedCanvas = document.querySelector("canvas");
    three.Object3D.prototype.updateMatrixWorld = function (force?: boolean) {
      if (this.userData.id) visible[this.userData.id] = this.visible;
      return original.call(this, force);
    };
  });
  const visibleMetadata = () =>
    page.evaluate(
      () =>
        Object.entries(
          (window as unknown as { nodeVisibility: Record<string, boolean> })
            .nodeVisibility,
        ).filter(([id, visible]) => id.startsWith("M-") && visible).length,
    );
  await expect.poll(visibleMetadata).toBe(80);
  await page.getByRole("button", { name: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const toggle = settings.getByRole("switch", {
    name: "Context relationships",
  });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect.poll(visibleMetadata).toBe(0);
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Enter immersive mode" }).click();
  await expect(page.getByRole("button", { name: "Open settings" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect.poll(visibleMetadata).toBe(80);
  await page.keyboard.press("Escape");
  await expect(page.locator(".app")).toHaveAttribute("data-immersive", "false");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { savedCanvas: HTMLCanvasElement | null })
          .savedCanvas === document.querySelector("canvas"),
    ),
  ).toBe(true);
});

test("Ctrl+drag latches pan without rotation even after Ctrl release, and Center restores framing", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await observeCamera(page);
  for (const immersive of [false, true]) {
    if (immersive) {
      await page.getByRole("button", { name: "Enter immersive mode" }).click();
      await expect(page.locator(".app")).toHaveAttribute(
        "data-phase",
        "immersive",
      );
    }
    const canvas = page.locator("canvas");
    const rect = (await canvas.boundingBox())!;
    const x = rect.x + rect.width / 2,
      y = rect.y + rect.height / 2;
    const start = await cameraSnapshot(page);
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(x + 40, y + 15, { steps: 4 });
    await page.keyboard.up("Control");
    await page.mouse.move(x + 85, y + 35, { steps: 4 });
    await page.mouse.up();
    const panned = await cameraSnapshot(page);
    expect(panned.quaternion).toEqual(start.quaternion);
    expect(panned.up).toEqual(start.up);
    expect(
      Math.hypot(
        ...panned.position.map((value, i) => value - start.position[i]),
      ),
    ).toBeGreaterThan(1);
    await expect(page.locator(".node-detail h2")).toHaveCount(0);
    await page.getByRole("button", { name: "Recenter graph" }).click();
    await expect
      .poll(async () =>
        Math.hypot(
          ...(await cameraSnapshot(page)).position.map(
            (value, i) => value - start.position[i],
          ),
        ),
      )
      .toBeLessThan(0.001);
    const beforeOrbit = await cameraSnapshot(page);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 45, y + 5, { steps: 5 });
    await page.mouse.up();
    expect((await cameraSnapshot(page)).quaternion).not.toEqual(
      beforeOrbit.quaternion,
    );
    await page.getByRole("button", { name: "Recenter graph" }).click();
  }
});

test("pan cancellation releases capture on blur and pointercancel without stray node clicks", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute("data-phase", "normal");
  await observeCamera(page);
  const canvas = page.locator("canvas");
  const rect = (await canvas.boundingBox())!;
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2;
  for (const cancel of ["blur", "pointercancel"]) {
    await page.mouse.move(x, y);
    await page.keyboard.down("Control");
    await page.mouse.down();
    await page.mouse.move(x + 30, y + 10, { steps: 3 });
    if (cancel === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else await canvas.dispatchEvent("pointercancel", { pointerId: 1 });
    const state = await cameraSnapshot(page);
    await page.keyboard.up("Control");
    await page.mouse.move(x + 70, y + 30, { steps: 4 });
    await page.mouse.up();
    expect((await cameraSnapshot(page)).quaternion).toEqual(state.quaternion);
    expect((await cameraSnapshot(page)).position).toEqual(state.position);
    await expect(page.locator(".node-detail h2")).toHaveCount(0);
  }
});

test("sound remains silent with reduced motion even when the preference is enabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("4sight-intro-sound", "on");
    let count = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      count++;
      return original.call(this);
    };
    Object.defineProperty(window, "audioCount", { get: () => count });
  });
  await page.goto("/");
  await expect(page.locator(".app")).toHaveAttribute(
    "data-intro-stage",
    "complete",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { audioCount: number }).audioCount,
    ),
  ).toBe(0);
});
