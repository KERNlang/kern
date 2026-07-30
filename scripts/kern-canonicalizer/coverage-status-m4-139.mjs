import {
  validateCanonicalizerExceptionFlowPrerequisiteHandoff,
} from './coverage-prerequisite-provenance.mjs';

export function formatM4139BoundedExceptionFlowStatus(coverage, prerequisite, handoff) {
  const validated = validateCanonicalizerExceptionFlowPrerequisiteHandoff(handoff?.record);
  if (
    handoff?.digest !== validated.digest ||
    coverage?.base?.id !== 'kern.kir-canonicalizer.profile.m4.137' ||
    coverage.baseCompleteFunctions !== 109 ||
    prerequisite?.selectedPrerequisite?.family !== 'exception-flow' ||
    prerequisite.selectedPrerequisite.catalogFacts !== 2 ||
    prerequisite.selectedPrerequisite.occurrences !== 34 ||
    prerequisite.ranking?.[0]?.completeFunctions !== 1 ||
    prerequisite.ranking[0].migratedParameterRows !== 15 ||
    prerequisite.parameterMigration?.migratedParameterRows !== 0
  ) {
    throw new TypeError('M4.139 must publish the exact bounded exception-flow frontier');
  }
  return 'M4.139 publishes bounded valued-throw validation and canonical emission; ' +
    'the M4.137 base remains 109/112 and exception-flow remains the exact ' +
    '2-fact/34-occurrence prerequisite for canonicalize (1 function/15 rows); ' +
    'M4.140 owns the immutable implementation handoff.';
}
