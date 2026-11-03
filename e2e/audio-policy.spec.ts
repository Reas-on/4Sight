import { test, expect } from "@playwright/test";

test.use({
  reducedMotion: "no-preference",
  launchOptions: {
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: [
      "--ozone-platform=headless",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=document-user-activation-required",
    ],
  },
});

test("keeps default ON while blocked, unlocks on a real key gesture, and does not replay late", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    localStorage.removeItem("4sight-intro-sound");
    const probe = { contexts: [] as AudioContext[], count: 0 };
    (window as unknown as { blockedAudio: typeof probe }).blockedAudio = probe;
    const Base = window.AudioContext;
    window.AudioContext = class extends Base {
      constructor(...args: ConstructorParameters<typeof AudioContext>) {
        super(...args);
        probe.contexts.push(this);
      }
      createOscillator() {
        probe.count++;
        return super.createOscillator();
      }
    };
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      (window as unknown as { blockedAudio: { contexts: AudioContext[] } })
        .blockedAudio.contexts.length > 0,
  );
  const initial = await page.evaluate(() => ({
    states: (
      window as unknown as { blockedAudio: { contexts: AudioContext[] } }
    ).blockedAudio.contexts.map((c) => c.state),
    count: (window as unknown as { blockedAudio: { count: number } })
      .blockedAudio.count,
  }));
  expect(initial.states).toEqual(["suspended"]);
  expect(initial.count).toBe(0);
  await expect(
    page.getByRole("button", { name: "Mute intro sound" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("a");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { blockedAudio: { contexts: AudioContext[] } })
            .blockedAudio.contexts[0].state,
      ),
    )
    .toBe("running");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { blockedAudio: { count: number } })
            .blockedAudio.count,
      ),
    )
    .toBeGreaterThan(0);
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".app")).toHaveClass(/intro-complete/);
  const count = await page.evaluate(
    () =>
      (window as unknown as { blockedAudio: { count: number } }).blockedAudio
        .count,
  );
  await page.keyboard.press("a");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { blockedAudio: { count: number } })
            .blockedAudio.count,
      ),
    )
    .toBe(count === 0 ? 6 : count); // Resume resolves asynchronously; late permission starts ambience only.
  expect(errors).toEqual([]);
});
