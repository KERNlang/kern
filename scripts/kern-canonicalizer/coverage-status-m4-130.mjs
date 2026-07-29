export function formatM4130CombinedPromotionStatus({
  kirLimits,
  parameterMigration,
  profileLimits,
  runtimeByteLimits,
}) {
  if (
    kirLimits?.maxBytes !== 273_051 ||
    kirLimits.maxDepth !== 98 ||
    kirLimits.maxNodes !== 5_313 ||
    profileLimits?.maxNodeRows !== 202 ||
    profileLimits.maxPropertyRows !== 308 ||
    profileLimits.maxValueRows !== 4_493 ||
    runtimeByteLimits?.maxStringBytes !== 1_092_204 ||
    runtimeByteLimits.maxBytes !== 2_184_408 ||
    parameterMigration?.completeFunctions !== 1 ||
    parameterMigration.completeTools !== 1 ||
    parameterMigration.migratedParameterRows !== 41
  ) {
    throw new TypeError('M4.130 status requires the exact combined promotion handoff');
  }
  return `M4.130 promotes combined KIR ${kirLimits.maxBytes}/${kirLimits.maxDepth}/` +
    `${kirLimits.maxNodes} and profile ${profileLimits.maxNodeRows}/` +
    `${profileLimits.maxPropertyRows}/${profileLimits.maxValueRows} with exact derived ` +
    `runtime bytes ${runtimeByteLimits.maxStringBytes}/${runtimeByteLimits.maxBytes}, ` +
    `publishing the exact ` +
    `${parameterMigration.completeFunctions}-function/` +
    `${parameterMigration.migratedParameterRows}-row parameter queue across ` +
    `${parameterMigration.completeTools} tool; M4.131 consumes it.`;
}
