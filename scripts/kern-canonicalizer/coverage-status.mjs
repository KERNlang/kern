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

export function formatM474ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.74 published analysis',
    selectedNextAction,
    '; M4.75 authenticates structural runtime headroom',
  );
}

export function formatM478ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.78 published analysis',
    selectedNextAction,
    '; M4.79 authenticates structural runtime headroom',
  );
}

export function formatM483ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.83 published analysis',
    selectedNextAction,
    '; M4.84 authenticates structural runtime headroom',
  );
}

export function formatM487ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.87 published analysis',
    selectedNextAction,
    '; M4.88 authenticates structural runtime headroom',
  );
}

export function formatM488DualRowHeadroomStatus(receipt) {
  return `M4.88 structural runtime rejects the ${receipt.limits.candidateProfile.maxNodeRows}/` +
    `${receipt.limits.candidateProfile.maxPropertyRows}/${receipt.limits.candidateProfile.maxValueRows} ` +
    `candidate: maximum floor ${receipt.summary.maxExactFloor} exceeds production by ` +
    `${receipt.summary.productionCeilingDeficit} and promotion budget by ` +
    `${receipt.summary.promotionBudgetDeficit}; M4.89 reduces canonicalizer runtime cost.`;
}

export function formatM489RuntimeCostStatus(receipt) {
  return `M4.89 reduces the exact three-witness maximum floor from ${receipt.baseline.maxExactFloor} to ` +
    `${receipt.result.maxExactFloor} by ${receipt.result.floorReduction} steps with ` +
    `${receipt.result.promotionHeadroom} promotion headroom; M4.90 authenticates the dual-row profile promotion.`;
}

export function formatM490DualRowPromotionStatus(receipt) {
  const migration = receipt.parameterMigration;
  return `M4.90 promotes maxNodeRows/maxPropertyRows to 74/77 and publishes the exact ` +
    `${migration.completeFunctions}-function/${migration.migratedParameterRows}-row parameter queue; ` +
    'M4.91 consumes it.';
}

export function formatM491ParameterMigrationStatus(receipt) {
  const migration = receipt.parameterMigration;
  return `M4.91 consumes the exact M4.90 ${migration.completeFunctions}-function/` +
    `${migration.migratedParameterRows}-row parameter queue and advances the cumulative base to 88/106.`;
}

export function formatM492ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.92 published analysis',
    selectedNextAction,
    '; M4.93 authenticates structural runtime headroom',
  );
}

export function formatM495ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.95 published analysis',
    selectedNextAction,
    '; M4.96 investigates the remaining runtime bottleneck before any profile promotion',
  );
}

export function formatM496RuntimeBottleneckStatus(receipt) {
  return `M4.96 attributes ${receipt.diagnosis.additionalRolledBackIterations} rolled-back loop entries and ` +
    `${receipt.diagnosis.additionalExpressionsourcesExecutions} additional expressionsources executions ` +
    `across ${receipt.diagnosis.additionalRetainedIterations} retained iterations; ` +
    'M4.97 evaluates removal of parent-frame replay before any headroom measurement.';
}

export function formatM497RuntimeCostStatus(receipt) {
  return `M4.97 removes parent-frame replay and authenticates exact floor ${receipt.result.exactFloor} ` +
    `with ${receipt.result.productionHeadroom} production headroom, but misses the promotion budget by ` +
    `${receipt.result.promotionBudgetDeficit}; M4.98 reduces the remaining runtime cost.`;
}

export function formatM498RuntimeCostStatus(receipt) {
  return `M4.98 authenticates property-row ordering and reduces the exact floor by ` +
    `${receipt.result.floorReduction} to ${receipt.result.exactFloor}, leaving ` +
    `${receipt.result.promotionBudgetHeadroom} promotion-budget headroom; ` +
    'M4.99 authenticates the profile promotion.';
}

export function formatM499DualRowPromotionStatus(receipt) {
  const migration = receipt.parameterMigration;
  const profile = receipt.profileLimits;
  return `M4.99 promotes maxPropertyRows/maxValueRows to ` +
    `${profile.maxPropertyRows}/${profile.maxValueRows} and publishes the exact ` +
    `${migration.completeFunctions}-function/${migration.migratedParameterRows}-row parameter queue; ` +
    'M4.100 consumes it.';
}

export function formatM4100ParameterMigrationStatus(receipt) {
  const migration = receipt.parameterMigration;
  return `M4.100 consumes the exact M4.99 ${migration.completeFunctions}-function/` +
    `${migration.migratedParameterRows}-row parameter queue and advances the cumulative base to ` +
    '90/109; M4.101 remeasures the bounded residual frontier.';
}

export function formatM4101ResidualAnalysisStatus(selectedNextAction) {
  return formatResidualAnalysisStatus(
    'M4.101 published analysis',
    selectedNextAction,
    '; M4.102 authenticates structural runtime headroom',
  );
}

export function formatM493RuntimeCostStatus(receipt) {
  return `M4.93 reduces ${receipt.witness.id} table validation from ` +
    `${receipt.baseline.attemptedLoopEntries} attempted loop entries at budget ` +
    `${receipt.baseline.measurementBudget} to exact floor ${receipt.result.exactFloor}; ` +
    `publishes the exact ${receipt.promotion.parameterMigration.completeFunctions}-function/` +
    `${receipt.promotion.parameterMigration.migratedParameterRows}-row parameter queue; ` +
    'production headroom remains unproven.';
}

export function formatM494ParameterMigrationStatus(receipt) {
  const migration = receipt.promotion.parameterMigration;
  return `M4.94 consumes the exact M4.93 ${migration.completeFunctions}-function/` +
    `${migration.migratedParameterRows}-row parameter queue and advances the cumulative base to 89/109; ` +
    'M4.95 remeasures the bounded residual frontier.';
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

export function formatM475DualRowHeadroomStatus(receipt) {
  return `M4.75 structural headroom authenticated ${receipt.summary.witnessCount} witness at exact floor ` +
    `${receipt.summary.maxExactFloor}; M4.76 authenticates the node+value profile promotion.`;
}

export function formatM479PropertyRowHeadroomStatus(receipt) {
  return `M4.79 structural runtime floor ${receipt.summary.maxExactFloor} rejects property-row ` +
    `promotion by ${receipt.summary.promotionBudgetDeficit} steps; M4.80 reduces canonicalizer ` +
    'runtime cost.';
}

export function formatM480RuntimeCostStatus(receipt) {
  return `M4.80 reduces the exact structural runtime floor from ${receipt.baseline.exactFloor} to ` +
    `${receipt.result.exactFloor} by ${receipt.result.floorReduction} steps with ` +
    `${receipt.result.promotionHeadroom} promotion headroom; M4.81 authenticates the property-row ` +
    'profile promotion.';
}

export function formatM481PropertyRowPromotionStatus(receipt) {
  const migration = receipt.parameterMigration;
  return `M4.81 promotes maxPropertyRows to 61 and publishes the exact ` +
    `${migration.completeFunctions}-function/${migration.migratedParameterRows}-row parameter queue; ` +
    'M4.82 consumes it.';
}

export function formatM482ParameterMigrationStatus(handoff) {
  const migration = handoff.record.parameterMigration;
  return `M4.82 consumes the exact M4.81 ${migration.completeFunctions}-function/` +
    `${migration.migratedParameterRows}-row parameter queue and advances the cumulative base to 82/105.`;
}

export function formatM484ValueRowHeadroomStatus(receipt) {
  return `M4.84 structural headroom authenticates ${receipt.summary.witnessCount} witness at exact floor ` +
    `${receipt.summary.maxExactFloor} with ${receipt.summary.minimumPromotionHeadroom} promotion headroom; ` +
    'M4.85 authenticates the value-row profile promotion.';
}

export function formatM485ValueRowPromotionStatus(receipt) {
  const migration = receipt.parameterMigration;
  return `M4.85 promotes maxValueRows to 580 and publishes the exact ` +
    `${migration.completeFunctions}-function/${migration.migratedParameterRows}-row parameter queue; ` +
    'M4.86 consumes it.';
}

export function formatM486ParameterMigrationStatus(receipt) {
  const migration = receipt.parameterMigration;
  return `M4.86 consumes the exact M4.85 ${migration.completeFunctions}-function/` +
    `${migration.migratedParameterRows}-row parameter queue and advances the cumulative base to 84/105.`;
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
