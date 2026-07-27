import assert from 'node:assert/strict';

import { loadPublishedCanonicalizerResidualAnalysisM495 } from './coverage-residual-analysis-m4-95.mjs';
import { loadCanonicalizerRuntimeCostM498 } from './runtime-cost-m4-98.mjs';

const ACTIVE_PROFILE = {
  maxNodeRows: 74,
  maxPropertyRows: 95,
  maxValueRows: 832,
};

const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 24,
  witnesses: [{
    id: 'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk',
    parameterRows: 24,
    profileRows: { nodes: 53, properties: 95, values: 832 },
    tool: 'checker',
  }],
};

export function m499ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m499ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM499DualRowPromotion(policy) {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM495().record;
  const runtime = loadCanonicalizerRuntimeCostM498();
  assert.deepEqual(analysis.selectedNextAction, {
    changedLimits: ['maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: ACTIVE_PROFILE,
    totalDelta: 270,
    witnesses: [PARAMETER_MIGRATION.witnesses[0].id],
  }, 'M4.99 must consume the exact M4.95 selected profile action');
  assert.deepEqual(
    runtime.limits.candidateProfile,
    ACTIVE_PROFILE,
    'M4.99 must consume the exact M4.98 candidate profile',
  );
  assert.deepEqual(runtime.promotion, {
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.99',
    profilePromotionApproved: false,
    promotionReady: true,
  }, 'M4.99 requires exact M4.98 promotion readiness');
  assert.deepEqual(runtime.result, {
    belowFloor: 46_380,
    belowFloorOutcome: 'failure',
    exactFloor: 46_381,
    floorOutcome: 'success',
    floorReduction: 6_705,
    productionHeadroom: 19_155,
    promotionBudgetHeadroom: 2_771,
    roundTrip: true,
  }, 'M4.99 must preserve exact M4.98 runtime headroom');
  assert.deepEqual(
    policy.profileLimits,
    ACTIVE_PROFILE,
    'M4.99 must promote only property and value row ceilings',
  );
  assert.equal(
    policy.runtimeLimits.maxCollectionLength,
    65_536,
    'M4.99 must not change the production runtime ceiling',
  );
  assert.equal(policy.kirLimits.maxDepth, 64, 'M4.99 must not change the KIR depth ceiling');
  return policy;
}
