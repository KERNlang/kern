export function formatM4132ResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction !== null) {
    throw new TypeError('M4.132 residual analysis must not select a profile widening');
  }
  return 'M4.132 published analysis found no actionable profile widening across the ' +
    'three-function residual frontier; M4.133 investigates projection and ' +
    'canonical-surface blockers.';
}
