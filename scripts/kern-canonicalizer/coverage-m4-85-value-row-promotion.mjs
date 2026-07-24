import assert from 'node:assert/strict';

import { loadCanonicalizerValueRowHeadroomM484 } from './value-row-headroom-m4-84.mjs';

const ACTIVE_PROFILE = {
  maxNodeRows: 38,
  maxPropertyRows: 61,
  maxValueRows: 580,
};

const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 19,
  witnesses: [
    {
      id: 'examples/capstone-checker-subset/checker.kern#16:argProvenanced',
      parameterRows: 19,
      profileRows: { nodes: 35, properties: 55, values: 580 },
      tool: 'checker',
    },
  ],
};

export function m485ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m485ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM485ValueRowPromotion(coverage, prerequisite, policy) {
  const headroom = loadCanonicalizerValueRowHeadroomM484();
  assert.deepEqual(headroom.limits.candidateProfile, ACTIVE_PROFILE,
    'M4.85 must consume the exact M4.84 candidate profile');
  assert.deepEqual(headroom.promotion, { disposition: 'approved', nextMilestone: 'M4.85' },
    'M4.85 requires the exact published M4.84 GO decision');
  assert.deepEqual(headroom.summary, {
    maxExactFloor: 38_773,
    minimumProductionHeadroom: 26_763,
    minimumPromotionHeadroom: 10_379,
    witnessCount: 1,
  }, 'M4.85 must preserve the exact M4.84 runtime headroom');
  assert.deepEqual(policy.profileLimits, ACTIVE_PROFILE,
    'M4.85 must promote only maxValueRows to the authenticated 580-row ceiling');
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536,
    'M4.85 must not change the production runtime ceiling');
  assert.equal(policy.kirLimits.maxDepth, 64,
    'M4.85 must not change the KIR depth ceiling');
  assert.equal(coverage.baseCompleteFunctions, 83,
    'M4.85 must expose exactly one newly profile-complete authored function');
  assert.equal(coverage.functions.length, 105,
    'M4.85 must preserve the exact authored corpus');
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    22,
    'M4.85 publishes a queue and does not consume legacy parameter rows',
  );
  assert.deepEqual(prerequisite.parameterMigration, PARAMETER_MIGRATION,
    'M4.85 must expose only the authenticated argProvenanced parameter queue');
  assert.equal(prerequisite.outcome, 'bounded-exhaustion',
    'M4.85 must preserve bounded exhaustion for the residual frontier');
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 21,
    'M4.85 must leave exactly 21 residual legacy-parameter functions');
  return prerequisite;
}
