import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertM481PropertyRowPromotion,
  m481ParameterMigration,
} from './coverage-m4-81-property-row-promotion.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';
import {
  loadCanonicalizerRuntimeCostM480,
  validateCanonicalizerRuntimeCostM480,
} from './runtime-cost-m4-80.mjs';

const EXPECTED_QUEUE = m481ParameterMigration();

function sha256(path) {
  return createHash('sha256').update(readFileSync(new URL(`../../${path}`, import.meta.url))).digest('hex');
}

test('M4.81 promotes only the authenticated property-row ceiling', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 461,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);

  const overNode = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-node-row-limit');
  assert.deepEqual(overNode?.expectedRows, { nodes: 39, properties: 45, values: 62 });
  const overProperty = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-property-row-limit');
  assert.deepEqual(overProperty?.expectedRows, { nodes: 31, properties: 62, values: 99 });
  assert.deepEqual(overProperty?.admittedProfileLimits, {
    maxNodeRows: 38,
    maxPropertyRows: 62,
    maxValueRows: 461,
  });
  const overValue = PROFILE_LIMIT_FIXTURES.find(({ id }) => id === 'over-value-row-limit');
  assert.deepEqual(overValue?.expectedRows, { nodes: 18, properties: 21, values: 462 });
});

test('M4.81 exposes exactly the authenticated one-function parameter queue', () => {
  const coverage = measureCanonicalizerCoverage();
  assert.equal(coverage.baseCompleteFunctions, 81);
  assert.equal(coverage.functions.length, 105);
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    23,
  );
  const prerequisite = measureCanonicalizerPrerequisite();
  assertM481PropertyRowPromotion(coverage, prerequisite, loadCanonicalizerPolicy());
  assert.deepEqual(prerequisite.parameterMigration, EXPECTED_QUEUE);
});

test('M4.81 freezes exact M4.80 runtime evidence before the policy limit moves', () => {
  const handoff = loadCanonicalizerRuntimeCostM480();
  assert.equal(
    sha256('scripts/kern-canonicalizer/runtime-cost-m4-80.json'),
    '48465b28f951d5f74a1ea148d2c21a1f28d3dcb13c475ed5885d7c0512046b14',
  );
  assert.equal(handoff.result.exactFloor, 35_998);
  assert.equal(handoff.result.promotionHeadroom, 13_154);
  assert.deepEqual(handoff.limits.activeProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 53,
    maxValueRows: 461,
  });
  assert.deepEqual(handoff.limits.candidateProfile, {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 461,
  });

  const drifted = structuredClone(handoff);
  drifted.result.exactFloor += 1;
  assert.throws(
    () => validateCanonicalizerRuntimeCostM480(drifted),
    /coverage M4\.80 runtime-cost rejection/u,
  );
});

export { EXPECTED_QUEUE as M481_EXPECTED_QUEUE };
