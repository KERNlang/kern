import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { measureCanonicalizerCoverage } from './coverage.mjs';
import {
  assertCurrentCanonicalizerFrontier,
  assertCurrentCanonicalizerPolicy,
  assertCurrentProfileLimitFixtures,
} from './coverage-current.mjs';
import {
  assertM490DualRowPromotion,
  m490ActiveProfile,
  m490ParameterMigration,
} from './coverage-m4-90-dual-row-promotion.mjs';
import { measureCanonicalizerPrerequisite } from './coverage-prerequisite.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';
import {
  loadCanonicalizerRuntimeCostM489,
  validateCanonicalizerRuntimeCostM489,
} from './runtime-cost-m4-89.mjs';

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.90 promotes only the authenticated node and property row ceilings', () => {
  const currentPolicy = loadCanonicalizerPolicy();
  const coverage = measureCanonicalizerCoverage();
  const prerequisite = measureCanonicalizerPrerequisite();
  assertCurrentCanonicalizerPolicy(currentPolicy);
  assertCurrentProfileLimitFixtures(PROFILE_LIMIT_FIXTURES);
  assertCurrentCanonicalizerFrontier(coverage, prerequisite);
  assert.deepEqual(assertM490DualRowPromotion(), m490ActiveProfile());
});

test('M4.90 publishes the exact combined four-function parameter queue', () => {
  assert.deepEqual(m490ParameterMigration(), {
    completeFunctions: 4,
    completeTools: 3,
    migratedParameterRows: 47,
    witnesses: [
      {
        id: 'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
        parameterRows: 24,
        profileRows: { nodes: 41, properties: 67, values: 404 },
        tool: 'checker',
      },
      {
        id: 'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
        parameterRows: 15,
        profileRows: { nodes: 47, properties: 64, values: 478 },
        tool: 'checker',
      },
      {
        id: 'examples/kern-canonicalizer/canonicalizer.kern#2:exprsource',
        parameterRows: 7,
        profileRows: { nodes: 13, properties: 23, values: 175 },
        tool: 'canonicalizer',
      },
      {
        id: 'examples/selfhost-validator/validator.kern#2:isreserved',
        parameterRows: 1,
        profileRows: { nodes: 74, properties: 77, values: 572 },
        tool: 'validator',
      },
    ],
  });
});

test('M4.90 freezes exact M4.89 runtime evidence before either policy limit moves', () => {
  const receipt = loadCanonicalizerRuntimeCostM489();
  assert.equal(
    sha256('scripts/kern-canonicalizer/runtime-cost-m4-89.json'),
    'c41cfbb3d7fb6f9d5f32f2d59f58e6e8d5ce7a65f77040316c7497c8cd89f86c',
  );
  assert.deepEqual(receipt.limits.candidateProfile, m490ActiveProfile());
  assert.deepEqual(receipt.promotion, {
    disposition: 'headroom-authenticated',
    nextMilestone: 'M4.90',
  });
  assert.deepEqual(receipt.result, {
    floorReduction: 80_080,
    maxExactFloor: 27_514,
    productionHeadroom: 38_022,
    promotionHeadroom: 21_638,
    witnessCount: 3,
  });
  assert.deepEqual(
    receipt.witnesses.map(({ exactFloor, id, parameterRows, profileRows }) => ({
      exactFloor, id, parameterRows, profileRows,
    })),
    [
      {
        exactFloor: 24_273,
        id: m490ParameterMigration().witnesses[0].id,
        parameterRows: 24,
        profileRows: { nodes: 41, properties: 67, values: 404 },
      },
      {
        exactFloor: 23_104,
        id: m490ParameterMigration().witnesses[1].id,
        parameterRows: 15,
        profileRows: { nodes: 47, properties: 64, values: 478 },
      },
      {
        exactFloor: 27_514,
        id: m490ParameterMigration().witnesses[3].id,
        parameterRows: 1,
        profileRows: { nodes: 74, properties: 77, values: 572 },
      },
    ],
  );
});

test('M4.89 evidence remains immutable after M4.90 promotion', () => {
  const receipt = loadCanonicalizerRuntimeCostM489();
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxNodeRows += 1; },
    (copy) => { copy.limits.candidateProfile.maxPropertyRows += 1; },
    (copy) => { copy.result.maxExactFloor += 1; },
    (copy) => { copy.promotion.nextMilestone = 'M4.91'; },
  ]) {
    const copy = structuredClone(receipt);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM489(copy),
      /coverage M4\.89 runtime-cost rejection/u,
    );
  }
});

test('M4.90 preserves exact M4.87 through M4.89 receipt bytes', () => {
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-87.json'),
    '9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/dual-row-headroom-m4-88.json'),
    '285b42785be8f651d323444ddd3464381b337b74557bbd07e8c3f4bad02a89bb',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/runtime-cost-m4-89.json'),
    'c41cfbb3d7fb6f9d5f32f2d59f58e6e8d5ce7a65f77040316c7497c8cd89f86c',
  );
});
