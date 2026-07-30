import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertCurrentCanonicalizerPolicy,
  assertCurrentProfileLimitFixtures,
} from './coverage-current.mjs';
import {
  m481ActiveProfile,
  m481ParameterMigration,
} from './coverage-m4-81-property-row-promotion.mjs';
import { loadPublishedCanonicalizerPrerequisiteM481 } from './coverage-prerequisite-m4-81.mjs';
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
  assert.deepEqual(m481ActiveProfile(), {
    maxNodeRows: 38,
    maxPropertyRows: 61,
    maxValueRows: 461,
  });
  assertCurrentCanonicalizerPolicy(policy);
  assertCurrentProfileLimitFixtures(PROFILE_LIMIT_FIXTURES);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 122);
});

test('M4.81 preserves its authenticated one-function parameter queue as an immutable handoff', () => {
  const handoff = loadPublishedCanonicalizerPrerequisiteM481();
  assert.equal(handoff.record.baseline.baseCompleteFunctions, 81);
  assert.equal(handoff.record.baseline.functionCount, 105);
  assert.equal(handoff.record.baseline.legacyParameterBlockers, 23);
  assert.deepEqual(handoff.record.parameterMigration, EXPECTED_QUEUE);
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
