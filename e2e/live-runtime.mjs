// Acceptance against the user's already-running services, never a webServer
// harness or mocked browser API. Start the normal backend in explicit fixture
// mode first. No provider calls or database resets are performed by this script.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { chromium, expect } from '@playwright/test';

export async function acceptRuntime(browser, output = 'test-results/live-runtime') {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const base = 'http://localhost:5173';
  try {
    const models = await (await context.request.get(`${base}/api/v1/models`)).json();
    assert(models.models.some(model => model.providerId === 'fixture' && model.configured), 'Explicit fixture backend required; never invoke live AI for UI acceptance');
    await page.goto(base);
    await expect(page.locator('.app')).toHaveClass(/intro-complete/);
    // Observe the objects actually submitted to WebGL, not motion constants or
    // diagnostic attributes. Runs still use the unmodified real REST/SSE path.
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(entry => entry.name).find(name => /\/\.vite\/deps\/three\.js\?/.test(name));
      const three = await import(/* @vite-ignore */ url);
      window.renderedFrames = [];
      const original = three.Scene.prototype.onBeforeRender;
      three.Scene.prototype.onBeforeRender = function (...args) {
        const camera = args[2];
        const graph = document.querySelector('[data-testid="graph-renderer"]');
        const nodes = [], edges = [];
        this.traverse(object => {
          if (object.isMesh && object.userData.id) nodes.push({ id: object.userData.id,
            scale: object.scale.x / object.userData.baseScale, opacity: object.material.opacity,
            position: object.getWorldPosition(new three.Vector3()).toArray() });
          if (object.isLine) edges.push(Array.from(object.geometry.getAttribute('position').array));
        });
        window.renderedFrames.push({ time: performance.now(), ...graph?.dataset, position: camera.position.toArray(), nodes, edges });
        if (window.renderedFrames.length > 2400) window.renderedFrames.shift();
        return original.apply(this, args);
      };
    });
    const graph = page.getByTestId('graph-renderer');
    const results = page.getByRole('dialog', { name: 'Simulation Results' });
    const choose = async name => {
      await page.getByRole('button', { name: 'Open Scenario Explorer' }).click();
      await page.getByRole('button', { name }).click();
      await page.getByRole('button', { name: 'Use Scenario', exact: true }).click();
      await expect(page.locator('.graph-label')).toHaveCount(1);
      await expect(page.getByRole('button', { name: 'Run demonstration', exact: true })).toBeEnabled();
    };
    const start = async () => {
      await page.evaluate(() => window.renderedFrames = []);
      await page.getByRole('button', { name: 'Run demonstration', exact: true }).click();
    };
    const inspect = async label => {
      await expect(results).toBeVisible({ timeout: 20000 });
      const id = await page.locator('.app').getAttribute('data-run-id');
      const run = await (await context.request.get(`${base}/api/v1/runs/${id}`)).json();
      const result = await (await context.request.get(`${base}/api/v1/runs/${id}/result`)).json();
      const replay = await (await context.request.get(`${base}/api/v1/runs/${id}/events`)).text();
      const events = replay.split('\n').filter(line => line.startsWith('data: ')).map(line => JSON.parse(line.slice(6)));
      const frames = await page.evaluate(() => window.renderedFrames);
      const graphIds = run.graph.nodes.map(node => node.nodeId).sort();
      const finalFrame = frames.at(-1);
      assert.deepEqual(finalFrame.nodes.map(node => node.id).sort(), graphIds);
      assert.equal(finalFrame.edges.length, run.graph.nodes.filter(node => node.parentNodeId).length);
      assert.equal(new Set(finalFrame.nodes.map(node => node.id)).size, graphIds.length);
      assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
      await expect(results.locator('[data-audit-kind]')).toHaveCount(events.length);
      for (const node of run.graph.nodes.filter(node => node.parentNodeId)) {
        const source = finalFrame.nodes.find(mesh => mesh.id === node.parentNodeId).position;
        const target = finalFrame.nodes.find(mesh => mesh.id === node.nodeId).position;
        assert(finalFrame.edges.some(edge => [...source, ...target].every((value, axis) => Math.abs(value - edge[axis]) < 0.001)),
          `rendered edge disagrees with persisted parent ${node.parentNodeId}>${node.nodeId}`);
      }
      const focused = [...new Set(frames.map(frame => frame.focusNode).filter(Boolean))];
      const starts = events.filter(event => event.eventType === 'step.started');
      assert.deepEqual(focused, [...new Set(starts.map(event => event.nodeId))]);
      for (const id of focused) {
        const targetFrames = frames.filter(frame => frame.focusNode === id);
        assert(targetFrames.some(frame => frame.nodes.some(node => node.id === id &&
          node.position.every((value, axis) => Math.abs(value - Number(frame.cameraTarget.split(',')[axis])) < 0.06))), `camera never reached rendered ${id}`);
      }
      assert(new Set(frames.map(frame => frame.position.join(','))).size > 3, 'actual camera position did not move');
      const animatedId = graphIds.find(id => frames.some(frame => frame.nodes.some(node => node.id === id && node.scale > 0.69 && node.scale < 0.9)));
      assert(animatedId, 'no actual mesh entrance');
      const samples = frames.flatMap(frame => frame.nodes.filter(node => node.id === animatedId).map(node => ({ time: frame.time, ...node })));
      assert(samples.some(node => node.scale >= 0.69 && node.scale <= 0.75), 'entrance skipped its initial ~0.7 scale');
      assert(samples.some(node => node.scale > 0.9 && node.scale < 1 && node.opacity > 0));
      assert(samples.some(node => Math.abs(node.scale - 1) < 0.001));
      assert(frames.some(frame => frame.nodes.some(node => node.scale > 1.01)), 'no parent emphasis');
      assert(frames.some(frame => frame.edges.some(edge => {
        const final = finalFrame.edges.find(candidate => candidate.slice(0, 3).every((value, axis) => value === edge[axis]) &&
          Math.hypot(...candidate.slice(3).map((value, axis) => value - edge[axis])) > Math.hypot(...edge.slice(3).map((value, axis) => value - edge[axis])) + 0.05);
        return !!final && Math.hypot(...edge.slice(3).map((value, axis) => value - edge[axis])) > 0.01;
      })), 'no intermediate actual edge endpoint');
      const adherence = `${result.ruleAdherence}%`;
      await expect(results.locator('.results-metrics > div').nth(2).locator('strong')).toHaveText(adherence);
      assert.equal(result.ruleAdherence, run.evaluation.approvedDecisions / run.evaluation.totalDecisions * 100);
      await page.screenshot({ path: `${output}/${label}-results.png` });
      await writeFile(`${output}/${label}-frames.json`, JSON.stringify(frames));
      return { id, scenario: run.configuration.scenario.id, status: run.status, outcome: run.evaluation.outcome,
        transitions: events.filter(event => event.eventType === 'transition.committed').length,
        events: events.length, projectedNodes: graphIds.length, renderedNodes: finalFrame.nodes.length,
        edges: finalFrame.edges.length, decisions: run.records.length, adherence, focused,
        animatedId, entranceSamples: samples.filter(node => node.scale < 1).length,
        records: run.records };
    };
    await choose(/Suspicious SSH Logins — Beginner Walkthrough · External source/);
    await start();
    await expect(graph).toHaveAttribute('data-focus-node', 'N-02');
    // Multiple real frames and screenshots within the normal-speed entrance.
    await page.screenshot({ path: `${output}/ssh-entrance-a.png` });
    await page.waitForTimeout(100);
    await page.screenshot({ path: `${output}/ssh-entrance-b.png` });
    const ssh = await inspect('ssh');
    assert.equal(ssh.transitions, 8); assert.equal(ssh.renderedNodes, 8); assert.equal(ssh.adherence, '100%');
    await page.getByRole('button', { name: 'Close simulation results' }).click();
    await choose(/Policy Rejection — Alternative Responses · Protected internal/);
    await start();
    await page.waitForFunction(() => document.querySelector('[data-testid="graph-renderer"]')?.dataset.revealingEdges?.includes('N-02>N-04'));
    await page.screenshot({ path: `${output}/branch-growth-a.png` });
    await page.waitForTimeout(90);
    await page.screenshot({ path: `${output}/branch-growth-b.png` });
    const branch = await inspect('branch');
    assert.equal(branch.transitions, 4); assert.equal(branch.renderedNodes, 5); assert.equal(branch.adherence, '75%');
    assert.equal(branch.records[1].referee.verdict, 'REJECTED');
    assert.equal(branch.records[1].transition, null);
    await expect(page.locator('.graph-label').filter({ hasText: 'N-05' })).toHaveAttribute('data-status', 'skipped');
    await page.reload();
    await expect(results).toBeVisible();
    await expect(page.locator('.graph-label')).toHaveCount(5);
    await expect(graph).toHaveAttribute('data-reveal-count', '0');
    await page.getByRole('button', { name: 'Close simulation results' }).click();
    await page.locator('canvas').focus();
    await page.keyboard.press('r');
    await expect(page.locator('.app')).not.toHaveAttribute('data-run-id', branch.id);
    await expect(page.locator('.graph-label')).toHaveCount(1);
    await expect(graph).toHaveAttribute('data-focus-node', 'N-02');
    const retryId = await page.locator('.app').getAttribute('data-run-id');
    // Manual takeover cancels this step, but the next committed step may focus.
    const box = await page.locator('canvas').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 15, { steps: 3 });
    await page.mouse.up();
    await expect(graph).toHaveAttribute('data-focus-node', '');
    // Input may span a step on a loaded machine. It must keep control until
    // pointer-up; a subsequent step then regains automatic focus.
    await expect(graph).toHaveAttribute('data-focus-node', /N-03|N-04/);
    // Refresh while presentation is in flight: hydrate complete durable state.
    await page.reload();
    await expect(results).toBeVisible();
    await expect(page.locator('.app')).toHaveAttribute('data-run-id', retryId);
    await expect(page.locator('.graph-label')).toHaveCount(5);
    await expect(graph).toHaveAttribute('data-reveal-count', '0');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('button', { name: 'Close simulation results' }).click();
    await page.locator('canvas').focus();
    await page.keyboard.press('r');
    await expect(results).toBeVisible();
    await expect(graph).toHaveAttribute('data-reveal-count', '0');
    await expect(page.locator('.graph-label')).toHaveCount(5);
    assert.deepEqual(errors, []);
    const evidence = { url: base, ssh: { ...ssh, records: undefined }, branch: { ...branch, records: undefined }, retryId,
      refresh: 'completed + in-flight presentation: no replay or duplicates', manualOverride: 'passed', reducedMotion: 'passed', errors };
    await writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    return evidence;
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ['--ozone-platform=headless', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try { await acceptRuntime(browser); } finally { await browser.close(); }
}
