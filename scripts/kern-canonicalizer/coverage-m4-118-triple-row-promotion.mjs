import assert from 'node:assert/strict';

import { loadPublishedCanonicalizerResidualAnalysisM4114 } from './coverage-residual-analysis-m4-114.mjs';
import { loadCanonicalizerRuntimeCostM4117 } from './runtime-cost-m4-117.mjs';

const ACTIVE_PROFILE = {
  maxNodeRows: 122,
  maxPropertyRows: 193,
  maxValueRows: 2411,
};

const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 58,
  witnesses: [{
    id: 'examples/capstone-checker-subset/checker.kern#24:checkModule',
    parameterRows: 58,
    profileRows: { nodes: 122, properties: 193, values: 2411 },
    tool: 'checker',
  }],
};

export function m4118ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m4118ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM4118TripleRowPromotion(policy) {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4114().record;
  const runtime = loadCanonicalizerRuntimeCostM4117();
  assert.deepEqual(analysis.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: PARAMETER_MIGRATION.completeFunctions,
    completeTools: PARAMETER_MIGRATION.completeTools,
    limits: ACTIVE_PROFILE,
    totalDelta: 412,
    witnesses: [PARAMETER_MIGRATION.witnesses[0].id],
  }, 'M4.118 must consume the exact M4.114 selected profile action');
  assert.deepEqual(runtime.limits.candidateProfile, ACTIVE_PROFILE);
  assert.deepEqual(runtime.promotion, {
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.118',
    profilePromotionApproved: false,
    promotionReady: true,
  });
  assert.deepEqual(runtime.result, {
    belowFloor: 38_692,
    belowFloorOutcome: 'failure',
    exactFloor: 38_693,
    floorOutcome: 'success',
    floorReduction: 137_426,
    productionHeadroom: 26_843,
    promotionBudgetHeadroom: 10_459,
    roundTrip: true,
  });
  assert.deepEqual(policy.profileLimits, ACTIVE_PROFILE);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
  assert.equal(policy.kirLimits.maxDepth, 76);
  return m4118ActiveProfile();
}
