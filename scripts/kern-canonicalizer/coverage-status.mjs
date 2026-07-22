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

export function formatM442ResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction === null) return 'M4.42 current analysis found no actionable profile widening.';
  return `M4.42 current analysis selected ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening.`;
}

export function formatPublishedResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction === null) return 'M4.38 published analysis found no actionable profile widening.';
  return `M4.38 published analysis selected ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening; M4.40 authenticated the profile promotion; ` +
    'M4.41 consumes the parameter queue.';
}
