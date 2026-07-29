const EXACT_M4130_WITNESSES = [{
  id: 'examples/selfhost-validator/validator.kern#20:validate',
  parameterRows: 41,
  profileRows: { nodes: 202, properties: 308, values: 4_493 },
  tool: 'validator',
}];

export function formatM4131ParameterMigrationStatus({
  baseCompleteFunctions,
  legacyParameterBlockers,
  parameterMigration,
  totalFunctions,
}) {
  if (
    baseCompleteFunctions !== 104 ||
    legacyParameterBlockers !== 3 ||
    parameterMigration?.completeFunctions !== 1 ||
    parameterMigration?.completeTools !== 1 ||
    parameterMigration?.migratedParameterRows !== 41 ||
    JSON.stringify(parameterMigration?.witnesses) !== JSON.stringify(EXACT_M4130_WITNESSES) ||
    totalFunctions !== 112
  ) {
    throw new TypeError('M4.131 status requires the exact validate parameter migration');
  }
  return `M4.131 consumes the exact M4.130 ${parameterMigration.completeFunctions}-function/` +
    `${parameterMigration.migratedParameterRows}-row validate queue and advances the ` +
    `cumulative base to ${baseCompleteFunctions}/${totalFunctions} with ` +
    `${legacyParameterBlockers} legacy-parameter blockers; M4.132 remeasures the bounded ` +
    'residual frontier.';
}
