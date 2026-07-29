import assert from 'node:assert/strict';

import {
  m4118ActiveProfile,
} from './coverage-m4-118-triple-row-promotion.mjs';
import {
  assertM4124ParameterMigration,
  m4124ParameterMigration,
} from './coverage-m4-124-parameter-migration.mjs';

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
  assert.deepEqual(policy.profileLimits, m4118ActiveProfile());
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 77);
  return policy;
}

export function assertCurrentProfileLimitFixtures(fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(byId.get('over-node-row-limit')?.expectedRows, {
    nodes: 123,
    properties: 123,
    values: 164,
  });
  assert.deepEqual(byId.get('over-node-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 123,
    maxPropertyRows: 193,
    maxValueRows: 2411,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 97,
    properties: 194,
    values: 297,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 122,
    maxPropertyRows: 194,
    maxValueRows: 2411,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 4,
    properties: 4,
    values: 2412,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 122,
    maxPropertyRows: 193,
    maxValueRows: 2412,
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
  assert.deepEqual(prerequisite.parameterMigration, m4124ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion?.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 4);
  assert.equal(
    prerequisite.exhaustion?.reasonAssignmentsDigest,
    'd56df2cc197c26f4c6f302c32e6447828e1e7359ba6f525f82bda5b6e2b5c481',
  );
  return prerequisite;
}
