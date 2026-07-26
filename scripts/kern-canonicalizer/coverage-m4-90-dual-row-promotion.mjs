import assert from 'node:assert/strict';

import { loadCanonicalizerRuntimeCostM489 } from './runtime-cost-m4-89.mjs';

const ACTIVE_PROFILE = {
  maxNodeRows: 74,
  maxPropertyRows: 77,
  maxValueRows: 580,
};

const PARAMETER_MIGRATION = {
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
};

export function m490ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m490ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM490DualRowPromotion(coverage, prerequisite, policy) {
  const headroom = loadCanonicalizerRuntimeCostM489();
  assert.deepEqual(
    headroom.limits.candidateProfile,
    ACTIVE_PROFILE,
    'M4.90 must consume the exact M4.89 candidate profile',
  );
  assert.deepEqual(
    headroom.promotion,
    { disposition: 'headroom-authenticated', nextMilestone: 'M4.90' },
    'M4.90 requires the exact published M4.89 GO decision',
  );
  assert.deepEqual(headroom.result, {
    floorReduction: 80_080,
    maxExactFloor: 27_514,
    productionHeadroom: 38_022,
    promotionHeadroom: 21_638,
    witnessCount: 3,
  }, 'M4.90 must preserve the exact M4.89 runtime headroom');
  assert.deepEqual(
    policy.profileLimits,
    ACTIVE_PROFILE,
    'M4.90 must promote only maxNodeRows and maxPropertyRows',
  );
  assert.equal(
    policy.runtimeLimits.maxCollectionLength,
    65_536,
    'M4.90 must not change the production runtime ceiling',
  );
  assert.equal(
    policy.kirLimits.maxDepth,
    64,
    'M4.90 must not change the KIR depth ceiling',
  );
  assert.equal(
    coverage.baseCompleteFunctions,
    84,
    'M4.90 must not consume the four-function parameter queue',
  );
  assert.equal(
    coverage.functions.length,
    106,
    'M4.90 must preserve the exact authored corpus',
  );
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    22,
    'M4.90 publishes a queue and does not consume legacy parameter rows',
  );
  assert.deepEqual(
    prerequisite.parameterMigration,
    PARAMETER_MIGRATION,
    'M4.90 must expose only the authenticated combined parameter queue',
  );
  assert.equal(
    prerequisite.outcome,
    'bounded-exhaustion',
    'M4.90 must preserve bounded exhaustion for the residual frontier',
  );
  assert.equal(
    prerequisite.exhaustion?.residualFunctionCount,
    18,
    'M4.90 must leave exactly 18 residual legacy-parameter functions',
  );
  return prerequisite;
}
