import { loadAiConfig } from '../config/env.js';
import { initializeScenario, resolveNextStorylet } from '../domain/narrative/engine.js';
import { sshBruteForceInitialStates, sshBruteForceScenario } from '../domain/narrative/scenarios/ssh-brute-force.js';
import { evaluateDecision } from '../domain/referee/evaluator.js';
import { AiProviderError } from './errors.js';
import { createConfiguredProvider } from './provider-registry.js';

async function main(): Promise<void> {
  if (!process.argv.includes('--live')) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'Explicit --live flag required.' }));
    process.exitCode = 2;
    return;
  }
  try {
    const config = loadAiConfig();
    const provider = createConfiguredProvider({ ...config, maxRetries: 0 });
    const state = initializeScenario(sshBruteForceScenario, sshBruteForceInitialStates.externalSource);
    const resolution = resolveNextStorylet(state, sshBruteForceScenario);
    if (resolution.status !== 'eligible') throw new Error('Fixture is not eligible');
    const started = performance.now();
    const decision = await provider.decide({
      runId: 'phase3-live-smoke', sequence: 1, scenario: sshBruteForceScenario, state,
      selectedStorylet: resolution.storylet,
      eligibleStorylets: [resolution.storylet], eligibleStoryletIds: resolution.eligibleStoryletIds,
      records: [], signal: new AbortController().signal,
    });
    const result = evaluateDecision(decision, state, sshBruteForceScenario);
    console.log(JSON.stringify({
      status: 'PASS', check: 'one-live-inference', ...provider.provenance,
      elapsedMs: Math.round(performance.now() - started), schemaValidated: true,
      refereeVerdict: result.verdict, violatedPolicyIds: result.violatedPolicies.map((policy) => policy.policyId),
      stateVersion: state.version, effectsCommitted: false,
    }));
  } catch (error) {
    const code = error instanceof AiProviderError ? error.code : 'SMOKE_CHECK_FAILED';
    const blocked = ['PROVIDER_NOT_CONFIGURED', 'MODEL_NOT_FOUND', 'PROVIDER_UNAVAILABLE'].includes(code);
    console.log(JSON.stringify({ status: blocked ? 'BLOCKED' : 'FAIL', code }));
    process.exitCode = blocked ? 2 : 1;
  }
}

await main();
