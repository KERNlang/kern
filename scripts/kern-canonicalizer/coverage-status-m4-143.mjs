export function formatM4143ResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction !== null) {
    throw new TypeError('M4.143 residual analysis must not select a profile widening');
  }
  return 'M4.143 published analysis found no actionable profile widening across the ' +
    'two-function residual frontier; M4.144 investigates structural projection and ' +
    'canonical-surface blockers.';
}
