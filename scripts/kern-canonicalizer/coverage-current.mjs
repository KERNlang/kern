import assert from 'node:assert/strict';

import {
  assertM4131ParameterMigration,
  m4131ParameterMigration,
} from './coverage-m4-131-parameter-migration.mjs';
import {
  m4130ActiveKirLimits,
  m4130ActiveProfile,
  m4130ActiveRuntimeByteLimits,
} from './coverage-m4-130-combined-promotion.mjs';

const CURRENT_LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
];

export function currentM493ParameterMigration() {
  return {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 12,
    witnesses: [{
      id: 'examples/kern-canonicalizer/canonicalizer.kern#4:tablesok',
      parameterRows: 12,
      profileRows: { nodes: 19, properties: 33, values: 156 },
      tool: 'canonicalizer',
    }],
  };
}

export function assertCurrentCanonicalizerPolicy(policy) {
  assert.deepEqual(
    {
      maxBytes: policy.kirLimits.maxBytes,
      maxDepth: policy.kirLimits.maxDepth,
      maxNodes: policy.kirLimits.maxNodes,
    },
    m4130ActiveKirLimits(),
  );
  assert.deepEqual(policy.profileLimits, m4130ActiveProfile());
  assert.deepEqual(
    {
      maxBytes: policy.runtimeLimits.maxBytes,
      maxStringBytes: policy.runtimeLimits.maxStringBytes,
    },
    m4130ActiveRuntimeByteLimits(),
  );
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
  return policy;
}

export function assertCurrentProfileLimitFixtures(fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(byId.get('over-node-row-limit')?.expectedRows, {
    nodes: 203,
    properties: 203,
    values: 804,
  });
  assert.deepEqual(byId.get('over-node-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 203,
    maxPropertyRows: 308,
    maxValueRows: 4493,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 104,
    properties: 309,
    values: 922,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 309,
    maxValueRows: 4493,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 4,
    properties: 4,
    values: 4494,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4494,
  });
  return fixtures;
}

export function assertCurrentCanonicalizerFrontier(coverage, prerequisite) {
  assertM4131ParameterMigration(coverage);
  assert.equal(coverage.baseCompleteFunctions, 104);
  assert.equal(coverage.functions.length, 112);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    CURRENT_LEGACY_PARAMETER_FUNCTION_IDS,
  );
  assert.deepEqual(prerequisite.parameterMigration, m4131ParameterMigration());
  assert.equal(prerequisite.outcome, 'selected');
  assert.equal(prerequisite.minimumFamilyCount, 2);
  assert.deepEqual(prerequisite.selectedPrerequisite, {
    catalogFacts: 1,
    family: 'new-expression',
    occurrences: 41,
  });
  assert.deepEqual(
    prerequisite.prerequisiteRanking.map(({ catalogFacts, family, occurrences }) => ({
      catalogFacts,
      family,
      occurrences,
    })),
    [
      { catalogFacts: 1, family: 'new-expression', occurrences: 41 },
      { catalogFacts: 2, family: 'exception-flow', occurrences: 34 },
    ],
  );
  assert.deepEqual(
    prerequisite.ranking.map(({
      completeFunctions,
      completeTools,
      families,
      migratedParameterRows,
      occurrences,
    }) => ({
      completeFunctions,
      completeTools,
      families,
      migratedParameterRows,
      occurrences,
    })),
    [{
      completeFunctions: 1,
      completeTools: 1,
      families: ['exception-flow', 'new-expression'],
      migratedParameterRows: 15,
      occurrences: 75,
    }],
  );
  assert.deepEqual(prerequisite.ranking[0]?.witnesses, [{
    id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
    parameterRows: 15,
    profileRows: { nodes: 100, properties: 159, values: 2556 },
    tool: 'canonicalizer',
  }]);
  assert.equal(prerequisite.exhaustion, null);
  return prerequisite;
}
