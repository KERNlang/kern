import assert from 'node:assert/strict';

const ACTIVE_PROFILE = {
  maxNodeRows: 38,
  maxPropertyRows: 61,
  maxValueRows: 461,
};

const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 22,
  witnesses: [
    {
      id: 'examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore',
      parameterRows: 22,
      profileRows: { nodes: 38, properties: 61, values: 460 },
      tool: 'checker',
    },
  ],
};

export function m481ActiveProfile() {
  return structuredClone(ACTIVE_PROFILE);
}

export function m481ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function assertM481PropertyRowPromotion(coverage, prerequisite, policy) {
  assert.deepEqual(policy.profileLimits, ACTIVE_PROFILE,
    'M4.81 must promote only maxPropertyRows to the authenticated 61-row ceiling');
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536,
    'M4.81 must not change the production runtime ceiling');
  assert.equal(policy.kirLimits.maxDepth, 64, 'M4.81 must not change the KIR depth ceiling');
  assert.equal(coverage.baseCompleteFunctions, 81,
    'M4.81 must preserve the exact 81-function cumulative base');
  assert.equal(coverage.functions.length, 105, 'M4.81 must preserve the exact authored corpus');
  assert.equal(
    coverage.functions.filter(({ excludedProperties }) => excludedProperties.includes('fn.params')).length,
    23,
    'M4.81 publishes a queue and does not consume legacy parameter rows',
  );
  assert.deepEqual(prerequisite.parameterMigration, PARAMETER_MIGRATION,
    'M4.81 must expose only the authenticated checkWhileCore parameter queue');
  assert.equal(prerequisite.outcome, 'bounded-exhaustion',
    'M4.81 must preserve bounded exhaustion for the residual frontier');
  assert.equal(prerequisite.exhaustion?.residualFunctionCount, 22,
    'M4.81 must leave exactly 22 residual legacy-parameter functions');
  return prerequisite;
}
