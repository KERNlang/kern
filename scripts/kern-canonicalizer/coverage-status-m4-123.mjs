export function formatM4123KirDepthPromotionStatus({ kirLimits, parameterMigration }) {
  if (
    kirLimits?.maxDepth !== 77 ||
    parameterMigration?.completeFunctions !== 1 ||
    parameterMigration?.completeTools !== 1 ||
    parameterMigration?.migratedParameterRows !== 5
  ) {
    throw new TypeError('M4.123 status requires the exact depth-77 promotion handoff');
  }
  return `M4.123 promotes structural KIR maxDepth to ${kirLimits.maxDepth} and publishes the exact ` +
    `${parameterMigration.completeFunctions}-function/` +
    `${parameterMigration.migratedParameterRows}-row parameter queue across ` +
    `${parameterMigration.completeTools} tool; M4.124 consumes it.`;
}
