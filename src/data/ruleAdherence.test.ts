import { expect, it } from 'vitest';
import { ruleAdherence } from '../../backend/src/domain/simulation/rule-adherence';
import { backendResult } from './backendPresentation';
import { runFixture } from '../api/testFixtures';

it.each([[1, 1, 0, 100], [2, 1, 1, 50], [3, 0, 3, 0], [0, 0, 0, null]])('measures %i evaluated / %i approved / %i rejected', (total, approved, rejected, expected) => {
  expect(ruleAdherence({ totalDecisions: total!, approvedDecisions: approved!, rejectedDecisions: rejected! })).toBe(expected);
});
it('never treats missing/corrupt evidence as a zero-decision result or 100%', () => {
  expect(() => ruleAdherence({ totalDecisions: 2, approvedDecisions: 1, rejectedDecisions: 0 })).toThrow();
  const run = runFixture(undefined, 'COMPLETED');
  expect(backendResult(run, [])?.ruleAdherence).toBe(100);
  expect(backendResult({ ...run, records: [] }, [])).toMatchObject({ ruleAdherence: null, measurementError: true });
  const failed = runFixture(undefined, 'FAILED');
  expect(backendResult(failed, [])).toMatchObject({ ruleAdherence: null });
  expect(backendResult(failed, [])?.measurementError).toBeUndefined();
});
