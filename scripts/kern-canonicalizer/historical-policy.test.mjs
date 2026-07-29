import assert from 'node:assert/strict';
import test from 'node:test';

import { loadHistoricalCanonicalizerPolicy } from './historical-policy.mjs';
import { canonicalizerPolicySource } from './policy.mjs';

const HISTORICAL_PROFILE = {
  maxNodeRows: 74,
  maxPropertyRows: 95,
  maxValueRows: 832,
};
const HISTORICAL_POLICY_DIGEST =
  '687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09';
const HISTORICAL_KIR_LIMITS = {
  maxBytes: 262_144,
  maxDepth: 64,
  maxNodes: 4_096,
};
const HISTORICAL_RUNTIME_BYTE_LIMITS = {
  maxBytes: 2_097_152,
  maxStringBytes: 1_048_576,
};

test('historical policy reconstruction substitutes only the archived profile', () => {
  const policy = loadHistoricalCanonicalizerPolicy({
    expectedDigest: HISTORICAL_POLICY_DIGEST,
    kirLimitOverrides: HISTORICAL_KIR_LIMITS,
    milestone: 'test',
    profileLimits: HISTORICAL_PROFILE,
    runtimeLimitOverrides: HISTORICAL_RUNTIME_BYTE_LIMITS,
  });
  assert.deepEqual(policy.profileLimits, HISTORICAL_PROFILE);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.kirLimits.maxDepth, 64);
});

test('historical policy reconstruction rejects unrelated policy drift', () => {
  const drifted = JSON.parse(canonicalizerPolicySource().toString('utf8'));
  drifted.runtimeLimits.maxDiagnostics += 1;
  assert.throws(
    () => loadHistoricalCanonicalizerPolicy({
      expectedDigest: HISTORICAL_POLICY_DIGEST,
      kirLimitOverrides: HISTORICAL_KIR_LIMITS,
      milestone: 'test',
      policySource: Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`),
      profileLimits: HISTORICAL_PROFILE,
      runtimeLimitOverrides: HISTORICAL_RUNTIME_BYTE_LIMITS,
    }),
    /test historical policy rejection: unreconstructed policy fields must remain exact/u,
  );
});
