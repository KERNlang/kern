import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertCurrentCanonicalizerPolicy,
  assertCurrentProfileLimitFixtures,
} from './coverage-current.mjs';
import {
  assertM499DualRowPromotion,
  m499ActiveProfile,
  m499ParameterMigration,
} from './coverage-m4-99-dual-row-promotion.mjs';
import {
  loadPublishedCanonicalizerResidualAnalysisM495,
  validatePublishedCanonicalizerResidualAnalysisM495,
} from './coverage-residual-analysis-m4-95.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { PROFILE_LIMIT_FIXTURES } from './profile-limit-fixtures.mjs';
import {
  loadCanonicalizerRuntimeCostM498,
  validateCanonicalizerRuntimeCostM498,
} from './runtime-cost-m4-98.mjs';

function sha256(path) {
  return createHash('sha256')
    .update(readFileSync(new URL(`../../${path}`, import.meta.url)))
    .digest('hex');
}

test('M4.99 archives the authenticated dual-row promotion across later profile promotions', () => {
  const policy = loadCanonicalizerPolicy();
  assertCurrentCanonicalizerPolicy(policy);
  assertCurrentProfileLimitFixtures(PROFILE_LIMIT_FIXTURES);
  assertM499DualRowPromotion(policy);
});

test('M4.99 publishes the exact one-function 24-row parameter queue', () => {
  assert.deepEqual(m499ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 24,
    witnesses: [{
      id: 'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
      parameterRows: 24,
      profileRows: { nodes: 53, properties: 95, values: 832 },
      tool: 'checker',
    }],
  });
});

test('M4.99 freezes exact M4.95 selection and M4.98 runtime headroom', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM495();
  const runtime = loadCanonicalizerRuntimeCostM498();
  assert.equal(
    sha256('scripts/kern-canonicalizer/coverage-residual-analysis-m4-95.json'),
    'f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928',
  );
  assert.equal(
    sha256('scripts/kern-canonicalizer/runtime-cost-m4-98.json'),
    '21ab630c3c937ee62d15fadfcec9faee80cf87a2d7eb6fdee7c41b3723efc201',
  );
  assert.deepEqual(analysis.record.selectedNextAction, {
    changedLimits: ['maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: m499ActiveProfile(),
    totalDelta: 270,
    witnesses: [m499ParameterMigration().witnesses[0].id],
  });
  assert.deepEqual(runtime.limits.candidateProfile, m499ActiveProfile());
  assert.deepEqual(runtime.promotion, {
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.99',
    profilePromotionApproved: false,
    promotionReady: true,
  });
  assert.deepEqual(runtime.result, {
    belowFloor: 46_380,
    belowFloorOutcome: 'failure',
    exactFloor: 46_381,
    floorOutcome: 'success',
    floorReduction: 6_705,
    productionHeadroom: 19_155,
    promotionBudgetHeadroom: 2_771,
    roundTrip: true,
  });
});

test('M4.95 and M4.98 evidence rejects promotion-causal drift', () => {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM495().record;
  const runtime = loadCanonicalizerRuntimeCostM498();
  for (const mutate of [
    (copy) => { copy.selectedNextAction.limits.maxValueRows += 1; },
    (copy) => { copy.selectedNextAction.witnesses.pop(); },
  ]) {
    const copy = structuredClone(analysis);
    mutate(copy);
    assert.throws(
      () => validatePublishedCanonicalizerResidualAnalysisM495(copy),
      /coverage M4\.95 residual analysis rejection/u,
    );
  }
  for (const mutate of [
    (copy) => { copy.limits.candidateProfile.maxPropertyRows += 1; },
    (copy) => { copy.result.promotionBudgetHeadroom -= 1; },
  ]) {
    const copy = structuredClone(runtime);
    mutate(copy);
    assert.throws(
      () => validateCanonicalizerRuntimeCostM498(copy),
      /coverage M4\.98 runtime-cost rejection/u,
    );
  }
});
