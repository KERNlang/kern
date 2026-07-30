const EXACT_WITNESSES = [{
  id: 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
  parameterRows: 6,
  profileRows: { nodes: 205, properties: 332, values: 6_304 },
  tool: 'canonicalizer',
}];

export function formatM4146CombinedPromotionStatus({
  kirLimits,
  parameterMigration,
  profileLimits,
  runtimeByteLimits,
}) {
  if (
    kirLimits?.maxBytes !== 367_368 ||
    kirLimits.maxDepth !== 122 ||
    kirLimits.maxNodes !== 7_136 ||
    profileLimits?.maxNodeRows !== 205 ||
    profileLimits.maxPropertyRows !== 332 ||
    profileLimits.maxValueRows !== 6_304 ||
    runtimeByteLimits?.maxStringBytes !== 1_469_472 ||
    runtimeByteLimits.maxBytes !== 2_938_944 ||
    parameterMigration?.completeFunctions !== 1 ||
    parameterMigration.completeTools !== 1 ||
    parameterMigration.migratedParameterRows !== 6 ||
    JSON.stringify(parameterMigration.witnesses) !== JSON.stringify(EXACT_WITNESSES)
  ) {
    throw new TypeError('M4.146 status requires the exact combined promotion handoff');
  }
  return `M4.146 promotes combined KIR ${kirLimits.maxBytes}/${kirLimits.maxDepth}/` +
    `${kirLimits.maxNodes} and profile ${profileLimits.maxNodeRows}/` +
    `${profileLimits.maxPropertyRows}/${profileLimits.maxValueRows} with exact derived ` +
    `runtime bytes ${runtimeByteLimits.maxStringBytes}/${runtimeByteLimits.maxBytes}, ` +
    `publishing the exact ${parameterMigration.completeFunctions}-function/` +
    `${parameterMigration.migratedParameterRows}-row expressionsources parameter queue ` +
    `across ${parameterMigration.completeTools} tool; M4.147 consumes it.`;
}

