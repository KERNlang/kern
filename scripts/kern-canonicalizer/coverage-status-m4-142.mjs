import { isDeepStrictEqual } from 'node:util';

import {
  CANONICALIZE_PARAMETER_TARGET_M4142,
} from './canonicalize-parameter-target.mjs';
import {
  isExactPlainArray,
  isExactPlainRecord,
} from './coverage-prerequisite-shape.mjs';

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

function isExactProfileRows(value) {
  return isExactPlainRecord(value, ['nodes', 'properties', 'values']);
}

function isExactMigrationQueue(value, expected) {
  if (
    !isExactPlainRecord(
      value,
      ['completeFunctions', 'completeTools', 'migratedParameterRows', 'witnesses'],
    ) ||
    !isExactPlainArray(value.witnesses)
  ) {
    return false;
  }
  return value.witnesses.every((witness) =>
    isExactPlainRecord(witness, ['id', 'parameterRows', 'profileRows', 'tool']) &&
    isExactProfileRows(witness.profileRows)) &&
    isDeepStrictEqual(value, expected);
}

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
    !isExactMigrationQueue(parameterMigration, EXACT_QUEUE) ||
    !isExactMigrationQueue(postMigrationQueue, EMPTY_QUEUE) ||
    totalFunctions !== 112
  ) {
    throw new TypeError('M4.142 status requires the exact canonicalize parameter migration');
  }
  return 'M4.142 consumes the exact M4.141 1-function/15-row canonicalize queue and advances ' +
    'the cumulative base to 110/112 with 2 legacy-parameter blockers and an empty parameter ' +
    'queue; M4.143 remeasures the bounded residual frontier.';
}
