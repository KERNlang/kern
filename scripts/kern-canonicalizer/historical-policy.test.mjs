import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadHistoricalCanonicalizerPolicy,
  loadPreM4146CanonicalizerPolicy,
} from './historical-policy.mjs';
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

test('pre-M4.146 policy reconstruction preserves the exact M4.145 input policy', () => {
  const policy = loadPreM4146CanonicalizerPolicy();
  assert.deepEqual(
    {
      maxBytes: policy.kirLimits.maxBytes,
      maxDepth: policy.kirLimits.maxDepth,
      maxNodes: policy.kirLimits.maxNodes,
    },
    { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
  );
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4_493,
  });
  assert.deepEqual(
    {
      maxBytes: policy.runtimeLimits.maxBytes,
      maxStringBytes: policy.runtimeLimits.maxStringBytes,
    },
    { maxBytes: 2_184_408, maxStringBytes: 1_092_204 },
  );
});
