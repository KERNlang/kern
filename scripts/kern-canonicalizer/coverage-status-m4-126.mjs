export function formatM4126ProjectionAnalysisStatus(action) {
  if (
    JSON.stringify(action?.changedKirLimits) !==
      JSON.stringify(['maxBytes', 'maxDepth', 'maxNodes']) ||
    JSON.stringify(action?.changedProfileLimits) !==
      JSON.stringify(['maxNodeRows', 'maxPropertyRows', 'maxValueRows']) ||
    action.completeFunctions !== 1 ||
    action.completeTools !== 1 ||
    action.kirLimits?.maxBytes !== 273_051 ||
    action.kirLimits?.maxDepth !== 98 ||
    action.kirLimits?.maxNodes !== 5_313 ||
    action.migratedParameterRows !== 41 ||
    action.profileLimits?.maxNodeRows !== 202 ||
    action.profileLimits?.maxPropertyRows !== 308 ||
    action.profileLimits?.maxValueRows !== 4_493 ||
    action.totalDelta !== 14_422 ||
    JSON.stringify(action.witnesses) !== JSON.stringify([
      'examples/selfhost-validator/validator.kern#20:validate',
    ])
  ) {
    throw new TypeError('M4.126 status requires the exact combined validate candidate');
  }
  return `M4.126 projection analysis selects combined KIR ${action.kirLimits.maxBytes}/` +
    `${action.kirLimits.maxDepth}/${action.kirLimits.maxNodes} and profile ` +
    `${action.profileLimits.maxNodeRows}/${action.profileLimits.maxPropertyRows}/` +
    `${action.profileLimits.maxValueRows} for ${action.completeFunctions} function/` +
    `${action.migratedParameterRows} rows across ${action.completeTools} tool; ` +
    'M4.127 authenticates structural KIR and runtime-envelope headroom.';
}
