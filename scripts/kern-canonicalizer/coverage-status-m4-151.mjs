import { isDeepStrictEqual } from 'node:util';

import { QUOTESOURCE_PARAMETER_TARGET_M4151 } from './quotesource-parameter-m4-151-target.mjs';

const EMPTY_QUEUE = {
  completeFunctions: 0,
  completeTools: 0,
  migratedParameterRows: 0,
  witnesses: [],
};

export function formatM4151QuotesourceParameterStatus({
  baseCompleteFunctions,
  functionCount,
  legacyParameterBlockers,
  parameterMigration,
  target,
}) {
  if (
    baseCompleteFunctions !== functionCount || functionCount !== 112 ||
    legacyParameterBlockers !== 0 ||
    !isDeepStrictEqual(parameterMigration, EMPTY_QUEUE) ||
    target !== QUOTESOURCE_PARAMETER_TARGET_M4151
  ) {
    throw new TypeError('M4.151 status requires the exact terminal quotesource parameter migration');
  }
  return 'M4.151 consumes the exact M4.150 1-function/2-row quotesource queue and ' +
    'advances the cumulative canonicalizer base to 112/112 with zero legacy-parameter ' +
    'blockers; prerequisite format 4 publishes the terminal complete frontier.';
}
