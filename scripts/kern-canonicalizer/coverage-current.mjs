import assert from 'node:assert/strict';

import { m4100ParameterMigration } from './coverage-m4-100-parameter-migration.mjs';
import { m499ActiveProfile } from './coverage-m4-99-dual-row-promotion.mjs';

const CURRENT_REASON_ASSIGNMENTS_DIGEST =
  'f502a363d83d85b78d0cdc4287aefcd348de042ed94be5f9d14657cf5a6f9913';
const CURRENT_LEGACY_PARAMETER_FUNCTION_IDS = [
  'examples/capstone-assertion-engine/compare.kern#2:compareList',
  'examples/capstone-assertion-engine/compare.kern#3:compareMap',
  'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
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
  'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
  'examples/selfhost-validator/validator.kern#15:exportkind',
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
  assert.deepEqual(policy.profileLimits, m499ActiveProfile());
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
    maxPropertyRows: 95,
    maxValueRows: 832,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 48,
    properties: 96,
    values: 150,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 74,
    maxPropertyRows: 96,
    maxValueRows: 832,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 59,
    properties: 62,
    values: 833,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 74,
    maxPropertyRows: 95,
    maxValueRows: 833,
  });
  return fixtures;
}

export function assertCurrentCanonicalizerFrontier(coverage, prerequisite) {
  assert.equal(coverage.baseCompleteFunctions, 91);
  assert.equal(coverage.functions.length, 111);
  assert.deepEqual(
    coverage.functions
      .filter(({ excludedProperties }) => excludedProperties.includes('fn.params'))
      .map(({ id }) => id),
    CURRENT_LEGACY_PARAMETER_FUNCTION_IDS,
  );
  assert.deepEqual(prerequisite.parameterMigration, m4100ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion?.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 16);
  assert.equal(prerequisite.exhaustion?.reasonAssignmentsDigest, CURRENT_REASON_ASSIGNMENTS_DIGEST);
  return prerequisite;
}
