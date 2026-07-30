import {
  validateCanonicalizerNewExpressionPrerequisiteHandoff,
} from './coverage-prerequisite-provenance.mjs';

const NEW_EXPRESSION_DIGEST =
  'ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e';

export function formatM4137NewExpressionPromotionStatus(coverage, prerequisite, handoff) {
  const validated = validateCanonicalizerNewExpressionPrerequisiteHandoff(handoff?.record);
  const witness = prerequisite?.ranking?.[0]?.witnesses?.[0];
  if (
    handoff?.digest !== validated.digest ||
    validated.digest !== NEW_EXPRESSION_DIGEST ||
    coverage?.base?.id !== 'kern.kir-canonicalizer.profile.m4.137' ||
    coverage.baseCompleteFunctions !== 109 ||
    coverage.functions?.length !== 112 ||
    coverage.base.expressionKinds.includes('new') !== true ||
    coverage.selection?.winner !== null ||
    prerequisite?.outcome !== 'selected' ||
    prerequisite.minimumFamilyCount !== 1 ||
    prerequisite.selectedPrerequisite?.family !== 'exception-flow' ||
    prerequisite.selectedPrerequisite.catalogFacts !== 2 ||
    prerequisite.selectedPrerequisite.occurrences !== 34 ||
    prerequisite.ranking?.length !== 1 ||
    prerequisite.ranking[0].completeFunctions !== 1 ||
    prerequisite.ranking[0].migratedParameterRows !== 15 ||
    witness?.id !== 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize'
  ) {
    throw new TypeError('M4.137 must promote the exact new-expression prerequisite');
  }
  return 'M4.137 promotes new-expression through the exact M4.136 provenance and advances ' +
    'the cumulative base to 109/112; exception-flow is the sole selected prerequisite ' +
    '(2 catalog facts/34 occurrences; 1 canonicalize function/15 rows); ' +
    'M4.138 owns the exception-flow prerequisite handoff.';
}
