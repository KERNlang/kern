export function formatCoverageWinnerStatus(winner) {
  return winner === null ? 'no tranche selected' : `${winner.id} tranche selected`;
}

function formatResidualAnalysisStatus(label, selectedNextAction, continuation = '') {
  if (selectedNextAction === null) return `${label} found no actionable profile widening.`;
  const functionLabel = selectedNextAction.completeFunctions === 1 ? 'function' : 'functions';
  return `${label} selected ${selectedNextAction.completeFunctions} ${functionLabel} by ` +
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

export function formatM450ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.50 published analysis',
    selectedNextAction,
    '; M4.51 authenticates structural runtime headroom',
  );
}

export function formatM454ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.54 published analysis',
    selectedNextAction,
    '; M4.55 authenticates structural runtime headroom',
  );
}

export function formatM462ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.62 published analysis',
    selectedNextAction,
    '; M4.63 authenticates structural runtime headroom',
  );
}

export function formatM466ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.66 published analysis',
    selectedNextAction,
    '; M4.67 authenticates structural runtime headroom',
  );
}

export function formatM470ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.70 published analysis',
    selectedNextAction,
    '; M4.71 authenticates structural runtime headroom',
  );
}

export function formatM447NodeRowHeadroomStatus(receipt) {
  return `M4.47 structural headroom authenticated ${receipt.summary.witnessCount} witnesses at a ` +
    `${receipt.summary.maxExactFloor} maximum floor; M4.48 authenticates the node-row profile promotion.`;
}

export function formatM451PropertyRowHeadroomStatus(receipt) {
  return `M4.51 structural headroom authenticated ${receipt.summary.witnessCount} witness at an ` +
    `${receipt.summary.maxExactFloor} exact floor; M4.52 authenticates the property-row profile promotion.`;
}

export function formatM455DualRowHeadroomStatus(receipt) {
  return `M4.55 structural headroom authenticated ${receipt.summary.witnessCount} witnesses at a ` +
    `${receipt.summary.maxExactFloor} maximum floor; M4.56 authenticates the dual-row profile promotion.`;
}

export function formatM463NodeRowHeadroomStatus(receipt) {
  return `M4.63 structural headroom authenticated ${receipt.summary.witnessCount} witnesses at a ` +
    `${receipt.summary.maxExactFloor} maximum floor; M4.64 authenticates the node-row profile promotion.`;
}

export function formatM467NodeRowHeadroomStatus(receipt) {
  return `M4.67 structural headroom authenticated ${receipt.summary.witnessCount} witness at exact floor ` +
    `${receipt.summary.maxExactFloor}; M4.68 authenticates the node-row profile promotion.`;
}

export function formatM471DualRowHeadroomStatus(receipt) {
  return `M4.71 structural headroom authenticated ${receipt.summary.witnessCount} witness at exact floor ` +
    `${receipt.summary.maxExactFloor}; M4.72 authenticates the dual-row profile promotion.`;
}

export function formatM453ParameterMigrationStatus(receipt) {
  const migration = receipt.parameterMigration;
  const functionLabel = migration.completeFunctions === 1 ? 'function' : 'functions';
  return `M4.53 consumes the exact M4.52 ${migration.completeFunctions}-${functionLabel}/` +
    `${migration.migratedParameterRows}-row parameter queue.`;
}

export function formatM457ParameterMigrationStatus(receipt) {
  const migration = receipt.parameterMigration;
  const functionLabel = migration.completeFunctions === 1 ? 'function' : 'functions';
  return `M4.57 consumes the exact M4.56 ${migration.completeFunctions}-${functionLabel}/` +
    `${migration.migratedParameterRows}-row parameter queue.`;
}

export function formatM458WhilePrerequisiteStatus(handoff) {
  const selected = handoff.record.snapshot.selectedPrerequisite;
  return `M4.58 freezes the exact M4.57 ${selected.family} prerequisite ` +
    `(${selected.catalogFacts} catalog facts/${selected.occurrences} occurrences); ` +
    'M4.59 owns canonicalizer implementation; M4.60 promotes it into the cumulative base.';
}

export function formatM461ParameterMigrationStatus(handoff) {
  const migration = handoff.record.parameterMigration;
  const functionLabel = migration.completeFunctions === 1 ? 'function' : 'functions';
  return `M4.61 consumes the exact M4.60 ${migration.completeFunctions}-${functionLabel}/` +
    `${migration.migratedParameterRows}-row parameter queue.`;
}

export function formatM465ParameterMigrationStatus(handoff) {
  const migration = handoff.record.parameterMigration;
  const functionLabel = migration.completeFunctions === 1 ? 'function' : 'functions';
  return `M4.65 consumes the exact M4.64 ${migration.completeFunctions}-${functionLabel}/` +
    `${migration.migratedParameterRows}-row parameter queue.`;
}

export function formatPublishedResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.38 published analysis',
    selectedNextAction,
    '; M4.40 authenticated the profile promotion; M4.41 consumes the parameter queue',
  );
}
