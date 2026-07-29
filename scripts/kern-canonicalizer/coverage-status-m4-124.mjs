const EXACT_M4123_WITNESSES = [{
  id: 'examples/capstone-checker-subset/checker.kern#2:rejectLine',
  parameterRows: 5,
  profileRows: { nodes: 8, properties: 15, values: 106 },
  tool: 'checker',
}];

export function formatM4124ParameterMigrationStatus({
  baseCompleteFunctions,
  legacyParameterBlockers,
  parameterMigration,
  totalFunctions,
}) {
  if (
    baseCompleteFunctions !== 103 ||
    legacyParameterBlockers !== 4 ||
    parameterMigration?.completeFunctions !== 1 ||
    parameterMigration?.completeTools !== 1 ||
    parameterMigration?.migratedParameterRows !== 5 ||
    JSON.stringify(parameterMigration?.witnesses) !== JSON.stringify(EXACT_M4123_WITNESSES) ||
    totalFunctions !== 112
  ) {
    throw new TypeError('M4.124 status requires the exact rejectLine migration handoff');
  }
  return `M4.124 consumes the exact M4.123 ${parameterMigration.completeFunctions}-function/` +
    `${parameterMigration.migratedParameterRows}-row rejectLine queue and advances the ` +
    `cumulative base to ${baseCompleteFunctions}/${totalFunctions} with ` +
    `${legacyParameterBlockers} legacy-parameter blockers; M4.125 remeasures the bounded ` +
    'residual frontier.';
}
