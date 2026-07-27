import assert from 'node:assert/strict';

import { loadPublishedCanonicalizerResidualAnalysisM4101 } from './coverage-residual-analysis-m4-101.mjs';
import { loadCanonicalizerRuntimeCostM4106 } from './runtime-cost-m4-106.mjs';

const ACTIVE_PROFILE = {
  maxNodeRows: 89,
  maxPropertyRows: 125,
  maxValueRows: 2100,
};

const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 14,
  witnesses: [{
    id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement',
    parameterRows: 14,
    profileRows: { nodes: 89, properties: 125, values: 1873 },
    tool: 'canonicalizer',
  }],
};

export function m4107ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m4107ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM4107TripleRowPromotion() {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4101().record;
  const runtime = loadCanonicalizerRuntimeCostM4106();
  assert.deepEqual(analysis.selectedNextAction, {
    changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: ACTIVE_PROFILE,
    totalDelta: 1313,
    witnesses: [PARAMETER_MIGRATION.witnesses[0].id],
  }, 'M4.107 must consume the exact M4.101 selected profile action');
  assert.deepEqual(runtime.limits.candidateProfile, ACTIVE_PROFILE);
  assert.deepEqual(runtime.promotion, {
    disposition: 'promotion-budget-headroom-authenticated',
    nextMilestone: 'M4.107',
    profilePromotionApproved: false,
    promotionReady: true,
  });
  assert.deepEqual(runtime.result, {
    belowFloor: 39_015,
    belowFloorOutcome: 'failure',
    exactFloor: 39_016,
    floorOutcome: 'success',
    floorReduction: 23_814,
    productionHeadroom: 26_520,
    promotionBudgetHeadroom: 10_136,
    roundTrip: true,
  });
  assert.equal(runtime.limits.productionMaxCollectionLength, 65_536);
  assert.equal(runtime.limits.maxDepth, 64);
  return m4107ActiveProfile();
}
