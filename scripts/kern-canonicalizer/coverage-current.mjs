import assert from 'node:assert/strict';

import {
  m481ActiveProfile,
  m481ParameterMigration,
} from './coverage-m4-81-property-row-promotion.mjs';

const CURRENT_REASON_ASSIGNMENTS_DIGEST =
  '37f914f5ccfce7a4cb86c1235939e760a133936c22775f3a1d25043ea7c7dcec';

export function assertCurrentCanonicalizerPolicy(policy) {
  assert.deepEqual(policy.profileLimits, m481ActiveProfile());
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);
  return policy;
}

export function assertCurrentProfileLimitFixtures(fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(byId.get('over-node-row-limit')?.expectedRows, {
    nodes: 39,
    properties: 45,
    values: 62,
  });
  assert.deepEqual(byId.get('over-node-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 39,
    maxPropertyRows: 61,
    maxValueRows: 461,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 31,
    properties: 62,
    values: 99,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 62,
    maxValueRows: 461,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 18,
    properties: 21,
    values: 462,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 462,
  });
  return fixtures;
}

export function assertCurrentCanonicalizerFrontier(coverage, prerequisite) {
  assert.equal(coverage.baseCompleteFunctions, 81);
  assert.equal(coverage.functions.length, 105);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    23,
  );
  assert.deepEqual(prerequisite.parameterMigration, m481ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion?.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 22);
  assert.equal(prerequisite.exhaustion?.reasonAssignmentsDigest, CURRENT_REASON_ASSIGNMENTS_DIGEST);
  return prerequisite;
}
