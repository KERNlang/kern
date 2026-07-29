import assert from 'node:assert/strict';

import { assertM4134RemediationAnalysis } from './coverage-m4-134-central.mjs';
import { formatM4135BoundedNewExpressionStatus } from './coverage-status-m4-135.mjs';

const EXPECTED_LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
];

export function assertM4135BoundedNewExpression(coverage, prerequisite) {
  assert.match(assertM4134RemediationAnalysis(), /^M4\.134 selects bounded new-expression/u);
  assert.equal(coverage.baseCompleteFunctions, 104);
  assert.equal(coverage.functions.length, 112);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    EXPECTED_LEGACY_PARAMETER_FUNCTION_IDS,
  );
  assert.deepEqual(
    coverage.selection.ranking.map(({
      completeFunctions,
      completeTools,
      id,
      occurrences,
    }) => ({
      completeFunctions,
      completeTools,
      id,
      occurrences,
    })),
    [
      {
        completeFunctions: 5,
        completeTools: 1,
        id: 'new-expression',
        occurrences: 41,
      },
      {
        completeFunctions: 0,
        completeTools: 0,
        id: 'exception-flow',
        occurrences: 34,
      },
    ],
  );
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
  assert.deepEqual(prerequisite.selectedPrerequisite, {
    catalogFacts: 1,
    family: 'new-expression',
    occurrences: 41,
  });
  assert.deepEqual(prerequisite.ranking, [{
    completeFunctions: 1,
    completeTools: 1,
    families: ['exception-flow', 'new-expression'],
    migratedParameterRows: 15,
    occurrences: 75,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
      parameterRows: 15,
      profileRows: { nodes: 100, properties: 159, values: 2556 },
      tool: 'canonicalizer',
    }],
  }]);
  assert.equal(
    coverage.functions.find(({ id }) =>
      id === 'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources')
      ?.excludedProperties.includes('projection.limit-nodes'),
    true,
  );
  return formatM4135BoundedNewExpressionStatus(prerequisite);
}
