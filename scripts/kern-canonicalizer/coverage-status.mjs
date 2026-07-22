export function formatCoverageWinnerStatus(winner) {
  return winner === null ? 'no tranche selected' : `${winner.id} tranche selected`;
}

export function formatHistoricalResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction === null) return 'M4.31 historical analysis found no actionable profile widening.';
  return `M4.31 historical analysis selected ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening.`;
}

export function formatCurrentResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction === null) return 'Current residual analysis found no actionable profile widening.';
  return `Current residual analysis selected ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening.`;
}

export function formatPublishedResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction === null) return 'M4.38 published analysis found no actionable profile widening.';
  return `M4.38 published analysis selected ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening; M4.39 keeps profile promotion performance-gated.`;
}
