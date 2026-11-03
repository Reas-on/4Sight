import { describe, expect, it } from 'vitest';
import { buildSimulationEvaluation, type EvaluationContext } from '../evaluation.js';
import { initializeScenario } from '../../narrative/engine.js';
import { sshBruteForceInitialStates, sshBruteForceScenario } from '../../narrative/scenarios/ssh-brute-force.js';
import { DEFAULT_REFEREE_POLICY_SET } from '../../referee/policies.js';
import { evaluateSimulationStep } from '../step.js';
import { EXTERNAL_SOURCE_DECISIONS } from '../fixtures.js';

const runtime: EvaluationContext = {
  runId: 'test', scenario: sshBruteForceScenario, status: 'COMPLETED', provider: {},
  records: [], narrative: initializeScenario(sshBruteForceScenario, sshBruteForceInitialStates.externalSource),
  startedAt: null, policySet: DEFAULT_REFEREE_POLICY_SET,
};
describe('evaluation evidence guard', () => {
  it('cannot label empty or nonterminal evidence PASS or invent policy FAIL', () => {
    expect(() => buildSimulationEvaluation(runtime, 'PASS', 'fake', 'fake', 'now')).toThrow(/evidence/);
    expect(() => buildSimulationEvaluation(runtime, 'FAIL', 'fake', 'fake', 'now')).toThrow(/evidence/);
    const cancelled = buildSimulationEvaluation({ ...runtime, status: 'CANCELLED' }, 'INCONCLUSIVE', 'RUN_CANCELLED', '', 'now');
    expect(cancelled.approvedDecisions).toBe(0);
    expect(cancelled.outcome).toBe('INCONCLUSIVE');
  });
  it('rejects fabricated approval booleans and failure-to-PASS conversions', () => {
    const step = evaluateSimulationStep(EXTERNAL_SOURCE_DECISIONS[0], runtime.narrative, sshBruteForceScenario,
      DEFAULT_REFEREE_POLICY_SET, 1, 'now');
    const mismatched = { ...step.record, referee: { ...step.record.referee, approved: false } };
    expect(() => buildSimulationEvaluation({ ...runtime, records: [mismatched] }, 'INCONCLUSIVE', '', '', 'now')).toThrow(/inconsistent/);
    expect(() => buildSimulationEvaluation({ ...runtime, status: 'FAILED', narrative: { ...step.state, terminal: true }, records: [step.record] },
      'PASS', '', '', 'now')).toThrow(/evidence/);
  });
  it('rejects a missing or duplicated transition version even if all verdicts claim approval', () => {
    const step = evaluateSimulationStep(EXTERNAL_SOURCE_DECISIONS[0], runtime.narrative, sshBruteForceScenario,
      DEFAULT_REFEREE_POLICY_SET, 1, 'now');
    const invalid = { ...step.record, transition: { ...step.record.transition!, nextStateVersion: 9 } };
    expect(() => buildSimulationEvaluation({ ...runtime, records: [invalid], narrative: { ...step.state, terminal: true } },
      'PASS', '', '', 'now')).toThrow(/versions/);
  });
});
