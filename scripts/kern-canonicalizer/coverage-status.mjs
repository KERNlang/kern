export function formatCoverageWinnerStatus(winner) {
  return winner === null ? 'no tranche selected' : `${winner.id} tranche selected`;
}

function formatResidualAnalysisStatus(label, selectedNextAction, continuation = '') {
  if (selectedNextAction === null) return `${label} found no actionable profile widening.`;
  return `${label} selected ${selectedNextAction.completeFunctions} functions by ` +
    `${selectedNextAction.changedLimits.join('+')} widening${continuation}.`;
}

export function formatHistoricalResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus('M4.31 historical analysis', selectedNextAction);
}

export function formatCurrentResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus('Current residual analysis', selectedNextAction);
}

export function formatM442ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus('M4.42 published analysis', selectedNextAction);
}

export function formatM443ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.43 published analysis',
    selectedNextAction,
    '; M4.44 authenticates the profile promotion',
  );
}

export function formatM446ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.46 published analysis',
    selectedNextAction,
    '; M4.47 authenticates structural runtime headroom',
  );
}

export function formatM447NodeRowHeadroomStatus(receipt) {
  return `M4.47 structural headroom authenticated ${receipt.summary.witnessCount} witnesses at a ` +
    `${receipt.summary.maxExactFloor} maximum floor; M4.48 authenticates the node-row profile promotion.`;
}

export function formatPublishedResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.38 published analysis',
    selectedNextAction,
    '; M4.40 authenticated the profile promotion; M4.41 consumes the parameter queue',
  );
}
