import assert from 'node:assert/strict';

import {
  m481ActiveProfile,
} from './coverage-m4-81-property-row-promotion.mjs';

const CURRENT_REASON_ASSIGNMENTS_DIGEST =
  '37f914f5ccfce7a4cb86c1235939e760a133936c22775f3a1d25043ea7c7dcec';
const CURRENT_LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/capstone-assertion-engine/compare.kern#2:compareList',
  'examples/capstone-assertion-engine/compare.kern#3:compareMap',
  'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
  'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
  'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
  'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
  'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
  'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
  'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
  'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
  'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
  'examples/capstone-checker-subset/checker.kern#24:checkModule',
  'examples/capstone-checker-subset/checker.kern#2:rejectLine',
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
  'examples/kern-canonicalizer/canonicalizer.kern#2:exprsource',
  'examples/kern-canonicalizer/canonicalizer.kern#3:tablesok',
  'examples/kern-canonicalizer/canonicalizer.kern#4:canonicalize',
  'examples/selfhost-validator/validator.kern#15:exportkind',
  'examples/selfhost-validator/validator.kern#20:validate',
  'examples/selfhost-validator/validator.kern#2:isreserved',
];

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
  assert.equal(coverage.baseCompleteFunctions, 82);
  assert.equal(coverage.functions.length, 105);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    CURRENT_LEGACY_PARAMETER_FUNCTION_IDS,
  );
  assert.deepEqual(prerequisite.parameterMigration, {
    completeFunctions: 0,
    completeTools: 0,
    migratedParameterRows: 0,
    witnesses: [],
  });
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
