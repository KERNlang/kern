import assert from 'node:assert/strict';

import {
  assertM4124ParameterMigration,
} from './coverage-m4-124-parameter-migration.mjs';
import {
  m4130ActiveKirLimits,
  m4130ActiveProfile,
  m4130ActiveRuntimeByteLimits,
  m4130ParameterMigration,
} from './coverage-m4-130-combined-promotion.mjs';

const CURRENT_LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
  'examples/selfhost-validator/validator.kern#20:validate',
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
  assertM4124ParameterMigration(coverage);
  assert.equal(coverage.baseCompleteFunctions, 103);
  assert.equal(coverage.functions.length, 112);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    CURRENT_LEGACY_PARAMETER_FUNCTION_IDS,
  );
  assert.deepEqual(prerequisite.parameterMigration, m4130ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion?.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 3);
  assert.equal(
    prerequisite.exhaustion?.reasonAssignmentsDigest,
    'a3383dd12d41a3beaca9bf9c0de49ddadc9333c99ca7b14162e0a01ebdb0d338',
  );
  return prerequisite;
}
