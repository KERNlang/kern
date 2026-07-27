import assert from 'node:assert/strict';

import { m4107ActiveProfile } from './coverage-m4-107-triple-row-promotion.mjs';
import { m4107ParameterMigration } from './coverage-m4-107-triple-row-promotion.mjs';

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
  assert.deepEqual(policy.profileLimits, m4107ActiveProfile());
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);
  return policy;
}

export function assertCurrentProfileLimitFixtures(fixtures) {
  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  assert.deepEqual(byId.get('over-node-row-limit')?.expectedRows, {
    nodes: 90,
    properties: 90,
    values: 120,
  });
  assert.deepEqual(byId.get('over-node-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 90,
    maxPropertyRows: 125,
    maxValueRows: 2100,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.expectedRows, {
    nodes: 63,
    properties: 126,
    values: 195,
  });
  assert.deepEqual(byId.get('over-property-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 89,
    maxPropertyRows: 126,
    maxValueRows: 2100,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.expectedRows, {
    nodes: 4,
    properties: 4,
    values: 2101,
  });
  assert.deepEqual(byId.get('over-value-row-limit')?.admittedProfileLimits, {
    maxNodeRows: 89,
    maxPropertyRows: 125,
    maxValueRows: 2101,
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
  assert.deepEqual(prerequisite.parameterMigration, m4107ParameterMigration());
  assert.equal(prerequisite.outcome, 'bounded-exhaustion');
  assert.equal(prerequisite.minimumFamilyCount, null);
  assert.equal(prerequisite.selectedPrerequisite, null);
  assert.deepEqual(prerequisite.prerequisiteRanking, []);
  assert.deepEqual(prerequisite.ranking, []);
  assert.deepEqual(prerequisite.exhaustion?.activeFamilies, ['exception-flow']);
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 15);
  assert.equal(
    prerequisite.exhaustion?.reasonAssignmentsDigest,
    'f200b876c0ed6dd9cd75cfebe1c46c3d6cf97b13e0422886bc13b0f02f46b203',
  );
  return prerequisite;
}
