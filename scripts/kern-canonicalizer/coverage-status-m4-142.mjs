import {
  CANONICALIZE_PARAMETER_TARGET_M4142,
} from './canonicalize-parameter-target.mjs';

const EXACT_QUEUE = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 15,
  witnesses: [{
    id: CANONICALIZE_PARAMETER_TARGET_M4142.id,
    parameterRows: 15,
    profileRows: CANONICALIZE_PARAMETER_TARGET_M4142.profileRows,
    tool: CANONICALIZE_PARAMETER_TARGET_M4142.tool,
  }],
};
const EMPTY_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export function formatM4142ParameterMigrationStatus({
  baseCompleteFunctions,
  legacyParameterBlockers,
  parameterMigration,
  postMigrationQueue,
  totalFunctions,
}) {
  if (
    baseCompleteFunctions !== 110 ||
    legacyParameterBlockers !== 2 ||
    JSON.stringify(parameterMigration) !== JSON.stringify(EXACT_QUEUE) ||
    JSON.stringify(postMigrationQueue) !== JSON.stringify(EMPTY_QUEUE) ||
    totalFunctions !== 112
  ) {
    throw new TypeError('M4.142 status requires the exact canonicalize parameter migration');
  }
  return 'M4.142 consumes the exact M4.141 1-function/15-row canonicalize queue and advances ' +
    'the cumulative base to 110/112 with 2 legacy-parameter blockers and an empty parameter ' +
    'queue; M4.143 remeasures the bounded residual frontier.';
}
