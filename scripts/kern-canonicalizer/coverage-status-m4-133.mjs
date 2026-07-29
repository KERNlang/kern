export function formatM4133ProjectionAnalysisStatus(selectedNextAction) {
  if (selectedNextAction !== null) {
    throw new TypeError('M4.133 projection analysis must not select a KIR/profile candidate');
  }
  return 'M4.133 projection analysis finds no actionable KIR/profile candidate: quotesource is ' +
    'canonical-surface-blocked and 2 functions remain unknown-expression-kind; M4.134 ' +
    'investigates source/canonical-surface and expression-support remediation.';
}
