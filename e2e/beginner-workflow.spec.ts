import { expect, test } from "@playwright/test";

test('P0 execution, dynamic focus and branch entrance smoke', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const frames: Record<string, unknown>[] = [];
    Object.assign(window, { graphFrames: frames });
    const inspect = () => {
      const graph = document.querySelector<HTMLElement>('[data-testid="graph-renderer"]');
      if (graph && (graph.dataset.executionNode || graph.dataset.revealingNodes)) {
        frames.push({ ...graph.dataset, nodes: [...document.querySelectorAll<HTMLElement>('.graph-label')].map(node => ({
          text: node.textContent, opacity: node.style.opacity, transform: node.style.transform, ...node.dataset,
        })) });
        if (frames.length > 1200) frames.shift();
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
  await page.goto('/');
  const choose = async (name: RegExp) => {
    await page.getByRole('button', { name: 'Open Scenario Explorer' }).click();
    await page.getByRole('button', { name }).click();
    await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
    await expect(page.locator('.graph-label')).toHaveCount(1);
  };
  const results = page.getByRole('dialog', { name: 'Simulation Results' });
  const graph = page.getByTestId('graph-renderer');
  const runEvidence = async () => {
    const id = await page.locator('.app').getAttribute('data-run-id');
    const snapshot = await (await page.request.get(`/api/v1/runs/${id}`)).json();
    const result = await (await page.request.get(`/api/v1/runs/${id}/result`)).json();
    const replay = await (await page.request.get(`/api/v1/runs/${id}/events`)).text();
    const events = replay.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
    return { id, scenario: snapshot.configuration.scenario.id, status: snapshot.status, version: snapshot.narrative.version,
      transitions: events.filter(event => event.eventType === 'transition.committed').length,
      decisions: snapshot.records.length, eventCount: events.length, adherence: result.ruleAdherence,
      nodes: await page.locator('.graph-label').count(), edges: Number(await graph.getAttribute('data-edge-count')),
      consumed: await page.locator('[data-audit-kind]').count(), records: snapshot.records, world: snapshot.narrative.world };
  };
  await choose(/Suspicious SSH Logins — Beginner Walkthrough · External source/);
  await page.getByRole('button', { name: 'Run demonstration', exact: true }).click();
  await expect(graph).toHaveAttribute('data-focus-node', 'N-04', { timeout: 10000 });
  await page.screenshot({ path: testInfo.outputPath('ssh-running-focus.png') });
  await expect(results).toBeVisible({ timeout: 15000 });
  const ssh = await runEvidence();
  expect(ssh).toMatchObject({ transitions: 8, decisions: 1, nodes: 8, adherence: 100, status: 'COMPLETED' });
  await expect(results.locator('.results-metrics > div').nth(2).locator('strong')).toHaveText('100%');
  await page.getByRole('button', { name: 'Close simulation results' }).click();
  await choose(/Policy Rejection — Alternative Responses · Protected internal/);
  await page.getByRole('button', { name: 'Run demonstration', exact: true }).click();
  await expect(graph).toHaveAttribute('data-focus-node', 'N-02', { timeout: 10000 });
  await expect(page.getByRole('button', { name: 'Open Scenario Explorer' })).toBeDisabled();
  await page.waitForFunction(() => document.querySelector<HTMLElement>('[data-testid="graph-renderer"]')?.dataset.revealingEdges?.includes('N-02>N-04'));
  await page.screenshot({ path: testInfo.outputPath('branch-entrance.png') });
  await expect(graph).toHaveAttribute('data-focus-node', 'N-03');
  await expect(results).toBeVisible({ timeout: 15000 });
  const branch = await runEvidence();
  expect(branch).toMatchObject({ transitions: 4, decisions: 4, nodes: 5, adherence: 75, status: 'COMPLETED', world: { responseStatus: 'none' } });
  expect(branch.records[1].referee.verdict).toBe('REJECTED');
  expect(branch.records[1].transition).toBeNull();
  await expect(results.locator('.results-metrics > div').nth(2).locator('strong')).toHaveText('75%');
  await expect(page.locator('.graph-label').filter({ hasText: 'N-05' })).toHaveAttribute('data-status', 'skipped');
  const frames = await page.evaluate(() => (window as unknown as { graphFrames: Record<string, any>[] }).graphFrames);
  const focused = frames.filter(frame => frame.focusNode === 'N-02');
  expect(focused.length).toBeGreaterThan(1);
  expect(new Set(focused.map(frame => frame.cameraTarget)).size).toBeGreaterThan(1);
  expect(focused.some(frame => Math.abs(Number(frame.cameraTarget.split(',')[0]) - 4.5) < 0.1)).toBe(true);
  expect(frames.some(frame => frame.nodes.some((node: Record<string, string>) => node.parentId === 'N-02' && Number(node.entranceProgress) > 0 && Number(node.entranceProgress) < 1 && Number(node.nodeScale) < 1 && Number(node.edgeProgress) > 0))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('branch-results.png') });
  const evidence = { ssh: { ...ssh, records: undefined }, branch: { ...branch, records: undefined },
    focusTargets: [...new Set(frames.map(frame => frame.focusNode))], animatedFrames: frames.filter(frame => frame.revealingEdges).length };
  console.log('P0 evidence:', JSON.stringify(evidence));
  await testInfo.attach('run-evidence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await page.reload();
  await expect(results).toBeVisible();
  await expect(page.locator('.graph-label')).toHaveCount(5);
  await expect(graph).toHaveAttribute('data-reveal-count', '0');
  await page.getByRole('button', { name: 'Close simulation results' }).click();
  await page.locator('canvas').focus();
  await page.keyboard.press('r');
  await expect(page.locator('.graph-label')).toHaveCount(1);
  await expect(page.locator('.app')).not.toHaveAttribute('data-run-id', branch.id!);
  await expect(results).toBeVisible({ timeout: 20000 });
  await expect(page.locator('.graph-label')).toHaveCount(5);
  await expect(graph).toHaveAttribute('data-reveal-count', '4');
  expect(errors).toEqual([]);
});

test("beginner committed events → branch/camera/Inspector → persisted results", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await expect(page.getByLabel("AI Agent / Model", { exact: true })).toHaveValue("gemini:gemini-2.5-flash");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("button", { name: /Suspicious SSH Logins — Beginner Walkthrough · External source/ }).click();
  await page.getByRole("button", { name: "Use Scenario", exact: true }).click();
  await expect(page.locator(".graph-label")).toHaveCount(1);
  await page.evaluate(() => { (window as unknown as { savedCanvas: Element | null }).savedCanvas = document.querySelector("canvas"); });
  const created = page.waitForResponse(response => response.url().endsWith("/api/v1/runs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Run demonstration", exact: true }).click();
  expect((await created).status()).toBe(202);
  const results = page.getByRole("dialog", { name: "Simulation Results" });
  await expect(results).toBeVisible({ timeout: 10000 });
  await expect(results.locator(".results-outcome strong")).toHaveText("PASS");
  await expect(results.getByTestId("results-step-count")).toHaveText("8");
  await expect(results).toContainText("1 evaluated · 1 approved · 0 rejected");
  await expect(page.locator(".graph-label")).toHaveCount(8);
  for (const id of ["N-01", "N-02", "N-03", "N-04", "N-06", "N-07", "N-08", "N-09"]) {
    await expect(page.locator(".graph-label").filter({ hasText: id })).toHaveAttribute("data-status", "complete");
    await expect(results.locator(`[data-audit-kind="transition.committed"][data-node-id="${id}"]`)).toHaveCount(1);
  }
  expect(await page.evaluate(() => (window as unknown as { savedCanvas: Element }).savedCanvas === document.querySelector("canvas"))).toBe(true);

  await page.getByRole("button", { name: "Close simulation results" }).click();
  await page.getByRole("button", { name: "Steps", exact: true }).click();
  await page.locator('.step-card[data-node-id="N-06"]').click();
  await expect(page.getByTestId("node-execution-evidence")).toContainText("perimeter_block");
  await expect(page.getByTestId("node-execution-evidence")).toContainText("APPROVED");
  await expect(page.getByTestId("node-execution-evidence")).toContainText("POLICY-001");
});

test('dynamic branch, reload, safe R retry, scenario reset and preview-only imports', async ({ page }) => {
  await page.goto('/');
  const selector = page.getByRole('button', { name: 'Open Scenario Explorer' });
  await expect(selector).toContainText('Choose scenario');
  await expect(page.locator('.graph-label')).toHaveCount(0);
  await selector.click();
  await page.getByRole('button', { name: /Policy Rejection — Alternative Responses · Protected internal/ }).click();
  await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-scenario-state', 'READY');
  await expect(page.locator('.graph-label')).toHaveCount(1);
  await expect(page.locator('.app')).not.toHaveAttribute('data-run-id');
  await page.getByRole('button', { name: 'Run demonstration', exact: true }).click();
  const results = page.getByRole('dialog', { name: 'Simulation Results' });
  await expect(results).toBeVisible();
  await expect(page.locator('.app')).toHaveAttribute('data-simulation-status', 'COMPLETED');
  await expect(results.locator('.results-outcome strong')).toHaveText('FAIL');
  await expect(results.getByTestId('results-step-count')).toHaveText('4');
  await expect(page.locator('.graph-label')).toHaveCount(5);
  await expect(results.locator('.results-audit-heading h3')).toHaveCSS('font-size', '16.8px');
  await expect(results.locator('.results-audit li').first()).toHaveCSS('font-size', '13.2px');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    expect(await results.locator('.results-audit').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  for (const [id, status] of [['N-02', 'rejected'], ['N-03', 'complete'], ['N-04', 'complete'], ['N-05', 'skipped']]) {
    await expect(page.locator('.graph-label').filter({ hasText: id })).toHaveAttribute('data-status', status);
  }
  const firstId = await page.locator('.app').getAttribute('data-run-id');
  await page.reload();
  await expect(results).toBeVisible();
  await expect(page.locator('.graph-label')).toHaveCount(5);
  await expect(page.locator('.app')).toHaveAttribute('data-run-id', firstId!);
  await page.getByRole('button', { name: 'Close simulation results' }).click();
  let creates = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/runs')) creates++; });
  await page.getByLabel('Additional Context', { exact: true }).focus();
  await page.keyboard.press('r');
  expect(creates).toBe(0);
  await page.getByLabel('Additional Context', { exact: true }).fill('');
  await page.locator('canvas').focus();
  await page.keyboard.down('r');
  await page.keyboard.down('r');
  await page.keyboard.up('r');
  await expect(results).toBeVisible();
  expect(creates).toBe(1);
  await expect(page.locator('.app')).not.toHaveAttribute('data-run-id', firstId!);
  await page.getByRole('button', { name: 'Close simulation results' }).click();
  await selector.click();
  await page.getByRole('button', { name: /Suspicious SSH Logins — Beginner Walkthrough · External source/ }).click();
  await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
  await expect(page.locator('.graph-label')).toHaveCount(1);
  await expect(page.locator('.app')).not.toHaveAttribute('data-run-id');
  await selector.click();
  await page.getByRole('tab', { name: 'Import File' }).click();
  await page.getByLabel('Import source file').setInputFiles({ name: 'external.json', mimeType: 'application/json', buffer: Buffer.from('{"title":"Imported preview","commands":["untrusted"]}') });
  await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
  await expect(selector).toContainText('PREVIEW ONLY');
  await expect(page.locator('.graph-label')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Evaluation unavailable' })).toBeDisabled();
  expect(creates).toBe(1);
});

test('scenario loading is inline, race-safe and errors never become READY', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('AI Agent / Model', { exact: true })).toHaveValue('gemini:gemini-2.5-flash');
  let release!: () => void;
  let requests = 0;
  await page.route('**/api/v1/scenarios', async route => {
    requests++;
    if (requests === 1) await new Promise<void>(resolve => { release = resolve; });
    if (requests === 3) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"code":"UNAVAILABLE","message":"UNAVAILABLE"}}' });
    try { await route.continue(); } catch { /* superseded request was aborted */ }
  });
  const selector = page.getByRole('button', { name: 'Open Scenario Explorer' });
  await selector.click();
  await page.getByRole('button', { name: /Policy Rejection — Alternative Responses · Protected internal/ }).click();
  await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
  await expect(selector).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('.graph-label')).toHaveCount(0);
  await selector.click();
  await page.getByRole('button', { name: /Suspicious SSH Logins — Beginner Walkthrough · External source/ }).click();
  await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-scenario-state', 'READY');
  release();
  await expect(selector).toContainText('Beginner Walkthrough');
  await expect(page.locator('.graph-label')).toHaveCount(1);
  await selector.click();
  await page.getByRole('button', { name: /Policy Rejection — Alternative Responses · Protected internal/ }).click();
  await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-scenario-state', 'ERROR');
  await expect(page.locator('.graph-label')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Evaluation unavailable' })).toBeDisabled();
});

test('canvas handles physical Ctrl-wheel pan, keeps orbit/pinch and leaves outside scrolling native', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open Scenario Explorer' }).click();
  await page.getByRole('button', { name: /Suspicious SSH Logins — Beginner Walkthrough · External source/ }).click();
  await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
  const label = page.locator('.graph-label').first();
  const canvas = page.locator('canvas');
  await expect(label).toHaveCSS('opacity', '1');
  await canvas.focus();
  const before = await label.evaluate(element => element.style.transform);
  await page.keyboard.down('Control');
  const handled = await canvas.evaluate(element => {
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaX: 30, deltaY: -20, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  });
  await page.keyboard.up('Control');
  expect(handled).toBe(true);
  await expect.poll(() => label.evaluate(element => element.style.transform)).not.toBe(before);
  const afterPan = await label.evaluate(element => element.style.transform);
  await canvas.evaluate(element => element.dispatchEvent(new WheelEvent('wheel', { deltaX: 70, deltaY: 25, bubbles: true, cancelable: true })));
  await expect.poll(() => label.evaluate(element => element.style.transform)).not.toBe(afterPan);
  expect(await canvas.evaluate(element => {
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: -15, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(true);
  expect(await page.locator('.top-header').evaluate(element => {
    const event = new WheelEvent('wheel', { ctrlKey: true, deltaY: 20, bubbles: true, cancelable: true });
    element.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Recenter graph', exact: true }).click();
  await expect(page.locator('.graph-error')).toHaveCount(0);
});

test("rejected protected block takes manual-review branch and displays actual FAIL", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/");
  await page.getByRole("button", { name: "Open Scenario Explorer" }).click();
  await page.getByRole("button", { name: /Suspicious SSH Logins — Beginner Walkthrough · Protected internal/ }).click();
  await page.getByRole("button", { name: "Use Scenario", exact: true }).click();
  await page.getByRole("button", { name: "Run demonstration", exact: true }).click();
  const results = page.getByRole("dialog", { name: "Simulation Results" });
  await expect(results).toBeVisible({ timeout: 10000 });
  await expect(results.locator(".results-outcome strong")).toHaveText("FAIL");
  await expect(results).toContainText("1 evaluated · 0 approved · 1 rejected");
  await expect(results.getByTestId("results-step-count")).toHaveText("8");
  await expect(page.locator(".graph-label").filter({ hasText: "N-07" })).toHaveCount(0);
  await expect(page.locator(".graph-label").filter({ hasText: "N-10" })).toHaveAttribute("data-status", "complete");
  await expect(page.locator(".graph-label").filter({ hasText: "N-06" })).toHaveAttribute("data-status", "rejected");
});
