export function formatM4148ResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction !== null) {
    throw new TypeError('M4.148 residual analysis must not select a profile widening');
  }
  return 'M4.148 publishes the exact one-function quotesource residual analysis with no ' +
    'actionable profile widening; M4.149 investigates the six canonical-surface ' +
    'text-character blockers.';
}
