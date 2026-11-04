/** Shared authoritative MVP measurement; zero is measured, null is unmeasured. */
export function ruleAdherence(evaluation: { totalDecisions: number; approvedDecisions: number; rejectedDecisions: number }): number | null {
  const { totalDecisions: total, approvedDecisions: approved, rejectedDecisions: rejected } = evaluation;
  if (![total, approved, rejected].every(value => Number.isSafeInteger(value) && value >= 0) || approved + rejected !== total) {
    throw new Error('EVALUATION_EVIDENCE_MISMATCH');
  }
  return total === 0 ? null : approved * 100 / total;
}
