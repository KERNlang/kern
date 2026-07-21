export function formatCoverageWinnerStatus(winner) {
  return winner === null ? 'no tranche selected' : `${winner.id} tranche selected`;
}

export function formatResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction === null) return 'Residual analysis found no actionable profile widening.';
  return `Residual analysis selects ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening.`;
}
