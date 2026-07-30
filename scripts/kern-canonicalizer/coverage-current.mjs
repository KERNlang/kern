import assert from 'node:assert/strict';

import {
  assertM4131ParameterMigration,
} from './coverage-m4-131-parameter-migration.mjs';
import { assertM4137NewExpressionPromotion } from './coverage-m4-137-central.mjs';
import {
  m4130ActiveKirLimits,
  m4130ActiveProfile,
  m4130ActiveRuntimeByteLimits,
} from './coverage-m4-130-combined-promotion.mjs';

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
  const status = assertM4137NewExpressionPromotion(coverage, prerequisite);
  assert.equal(prerequisite.outcome, 'selected');
  assert.equal(prerequisite.minimumFamilyCount, 1);
  assert.deepEqual(prerequisite.selectedPrerequisite, {
    catalogFacts: 2,
    family: 'exception-flow',
    occurrences: 34,
  });
  assert.equal(prerequisite.exhaustion, null);
  return status;
}
