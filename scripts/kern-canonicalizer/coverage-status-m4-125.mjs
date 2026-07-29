export function formatM4125ResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction !== null) {
    throw new TypeError('M4.125 residual analysis must not select a profile widening');
  }
  return 'M4.125 published analysis found no actionable profile widening across the four-function ' +
    'residual frontier; M4.126 investigates projection and canonical-surface blockers.';
}
