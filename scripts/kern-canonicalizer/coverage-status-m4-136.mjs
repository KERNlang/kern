import {
  validateCanonicalizerNewExpressionPrerequisiteHandoff,
} from './coverage-prerequisite-provenance.mjs';

export function formatM4136NewExpressionHandoffStatus(handoff) {
  const validated = validateCanonicalizerNewExpressionPrerequisiteHandoff(handoff?.record);
  const snapshot = validated.record.snapshot;
  if (
    handoff?.digest !== validated.digest ||
    validated.digest !== 'ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e' ||
    snapshot?.minimumFamilyCount !== 2 ||
    snapshot?.selectedPrerequisite?.family !== 'new-expression' ||
    snapshot.selectedPrerequisite.catalogFacts !== 1 ||
    snapshot.selectedPrerequisite.occurrences !== 41 ||
    snapshot?.winningClosure?.completeFunctions !== 1 ||
    snapshot.winningClosure.migratedParameterRows !== 15
  ) {
    throw new TypeError('M4.136 must freeze the exact new-expression prerequisite');
  }
  return 'M4.136 freezes the exact M4.135 new-expression prerequisite ' +
    '(1 catalog fact/41 occurrences; 2-family canonicalize closure with 1 function/15 rows); ' +
    'M4.137 owns cumulative-base promotion.';
}
