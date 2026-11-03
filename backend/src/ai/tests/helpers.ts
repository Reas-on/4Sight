import { initializeScenario, getEligibleStorylets } from '../../domain/narrative/engine.js';
import { sshBruteForceInitialStates, sshBruteForceScenario } from '../../domain/narrative/scenarios/ssh-brute-force.js';
import type { DecisionContext } from '../../domain/simulation/types.js';

export const validOutput = {
  actionType: 'triage_alert', parameters: {},
  storyletId: 'triage-ssh-brute-force', outcomeId: 'confirm-threat',
  reasoning: 'Review the authentication alert.',
};

export function context(signal = new AbortController().signal): DecisionContext {
  const state = initializeScenario(sshBruteForceScenario, sshBruteForceInitialStates.externalSource);
  const eligible = getEligibleStorylets(state, sshBruteForceScenario);
  const selectedStorylet = eligible[0];
  if (!selectedStorylet) throw new Error('Missing fixture storylet');
  return {
    runId: 'ai-test-run', sequence: 1, scenario: sshBruteForceScenario, state,
    selectedStorylet, eligibleStorylets: eligible, eligibleStoryletIds: eligible.map((storylet) => storylet.id),
    records: [], signal,
  };
}

export function geminiResponse(output: unknown = validOutput): Response {
  return Response.json({
    candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: JSON.stringify(output) }] } }],
  });
}

export function ollamaResponse(output: unknown = validOutput): Response {
  return Response.json({ model: 'test-model', done: true, done_reason: 'stop', message: {
    role: 'assistant', content: JSON.stringify(output),
  } });
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}
