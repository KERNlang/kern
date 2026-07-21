export function formatCoverageWinnerStatus(winner) {
  return winner === null ? 'no tranche selected' : `${winner.id} tranche selected`;
}

export function formatHistoricalResidualAnalysisStatus(selectedNextAction) {
  if (selectedNextAction === null) return 'M4.31 historical analysis found no actionable profile widening.';
  return `M4.31 historical analysis selected ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening.`;
}
