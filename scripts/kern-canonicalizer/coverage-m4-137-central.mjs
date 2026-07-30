import assert from 'node:assert/strict';

import {
  loadCanonicalizerNewExpressionPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  formatM4137NewExpressionPromotionStatus,
} from './coverage-status-m4-137.mjs';

const LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
];

export function assertM4137NewExpressionPromotion(coverage, prerequisite) {
  const handoff = loadCanonicalizerNewExpressionPrerequisiteProvenance();
  assert.equal(coverage.base.id, 'kern.kir-canonicalizer.profile.m4.137');
  assert.equal(coverage.baseCompleteFunctions, 109);
  assert.equal(coverage.functions.length, 112);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    LEGACY_PARAMETER_FUNCTION_IDS,
  );
  assert.deepEqual(coverage.selection.ranking, [{
    completeFunctions: 0,
    completeTools: 0,
    id: 'exception-flow',
    occurrences: 34,
    witnesses: [],
  }]);
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.deepEqual(prerequisite.prerequisiteRanking, [{
    catalogFacts: 2,
    family: 'exception-flow',
    occurrences: 34,
  }]);
  assert.deepEqual(prerequisite.ranking, [{
    completeFunctions: 1,
    completeTools: 1,
    families: ['exception-flow'],
    migratedParameterRows: 15,
    occurrences: 34,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
      parameterRows: 15,
      profileRows: { nodes: 100, properties: 159, values: 2556 },
      tool: 'canonicalizer',
    }],
  }]);
  return formatM4137NewExpressionPromotionStatus(coverage, prerequisite, handoff);
}
