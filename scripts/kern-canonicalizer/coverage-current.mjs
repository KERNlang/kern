import assert from 'node:assert/strict';

import {
  m490ActiveProfile,
} from './coverage-m4-90-dual-row-promotion.mjs';
import { m491ParameterMigration } from './coverage-m4-91-parameter-migrations.mjs';

const CURRENT_REASON_ASSIGNMENTS_DIGEST =
  'b222027da0639addba00e2c0149684e1e02a9bfd199feacae921b5fc028e07fe';
const CURRENT_LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/capstone-assertion-engine/compare.kern#2:compareList',
  'examples/capstone-assertion-engine/compare.kern#3:compareMap',
  'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
  'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
  'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
  'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
  'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
  'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
  'examples/capstone-checker-subset/checker.kern#24:checkModule',
  'examples/capstone-checker-subset/checker.kern#2:rejectLine',
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#5:quotesource',
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources',
  'examples/kern-canonicalizer/canonicalizer.kern#4:tablesok',
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
  'examples/selfhost-validator/validator.kern#15:exportkind',
  'examples/selfhost-validator/validator.kern#20:validate',
];

export function assertCurrentCanonicalizerPolicy(policy) {
  assert.deepEqual(policy.profileLimits, m490ActiveProfile());
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);
  return policy;
}

export function assertCurrentProfileLimitFixtures(fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(byId.get('over-node-row-limit')?.expectedRows, {
    nodes: 75,
    properties: 75,
    values: 100,
  });
  assert.deepEqual(byId.get('over-node-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 75,
    maxPropertyRows: 77,
    maxValueRows: 580,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 39,
    properties: 78,
    values: 123,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 74,
    maxPropertyRows: 78,
    maxValueRows: 580,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 29,
    properties: 32,
    values: 581,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 74,
    maxPropertyRows: 77,
    maxValueRows: 581,
  });
  return fixtures;
}

export function assertCurrentCanonicalizerFrontier(coverage, prerequisite) {
  assert.equal(coverage.baseCompleteFunctions, 88);
  assert.equal(coverage.functions.length, 106);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    CURRENT_LEGACY_PARAMETER_FUNCTION_IDS,
  );
  assert.deepEqual(prerequisite.parameterMigration, m491ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion?.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 18);
  assert.equal(prerequisite.exhaustion?.reasonAssignmentsDigest, CURRENT_REASON_ASSIGNMENTS_DIGEST);
  return prerequisite;
}
