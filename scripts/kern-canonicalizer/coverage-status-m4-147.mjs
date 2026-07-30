import { isDeepStrictEqual } from 'node:util';

import {
  EXPRESSIONSOURCES_PARAMETER_TARGET_M4147,
} from './expressionsources-parameter-target.mjs';
import {
  isExactPlainArray,
  isExactPlainRecord,
} from './coverage-prerequisite-shape.mjs';

const TARGET = EXPRESSIONSOURCES_PARAMETER_TARGET_M4147;
const EXACT_QUEUE = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: TARGET.parameters.length,
  witnesses: [{
    id: TARGET.id,
    parameterRows: TARGET.parameters.length,
    profileRows: TARGET.profileRows,
    tool: TARGET.tool,
  }],
};
const EMPTY_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

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
    isExactPlainRecord(witness.profileRows, ['nodes', 'properties', 'values'])) &&
    isDeepStrictEqual(value, expected);
}

export function formatM4147ParameterMigrationStatus({
  baseCompleteFunctions,
  legacyParameterBlockers,
  parameterMigration,
  postMigrationQueue,
  totalFunctions,
}) {
  if (
    baseCompleteFunctions !== 111 ||
    legacyParameterBlockers !== 1 ||
    !isExactMigrationQueue(parameterMigration, EXACT_QUEUE) ||
    !isExactMigrationQueue(postMigrationQueue, EMPTY_QUEUE) ||
    totalFunctions !== 112
  ) {
    throw new TypeError('M4.147 status requires the exact expressionsources parameter migration');
  }
  return 'M4.147 consumes the exact M4.146 1-function/6-row expressionsources queue and ' +
    'advances the cumulative base to 111/112 with 1 legacy-parameter blocker and an empty ' +
    'parameter queue; M4.148 remeasures the bounded quotesource residual frontier.';
}
