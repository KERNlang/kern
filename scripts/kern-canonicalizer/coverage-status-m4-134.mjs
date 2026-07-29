export function formatM4134RemediationAnalysisStatus(selectedNextAction) {
  if (
    selectedNextAction?.id !== 'bounded-new-expression-support' ||
    selectedNextAction.completeFunctions !== 2 ||
    selectedNextAction.parameterRows !== 21
  ) {
    throw new TypeError('M4.134 remediation analysis must select exact bounded new-expression support');
  }
  return 'M4.134 selects bounded new-expression support for 2 functions/21 parameter rows; ' +
    'M4.135 owns the shared constructor contract while quotesource code-point remediation remains pending.';
}
