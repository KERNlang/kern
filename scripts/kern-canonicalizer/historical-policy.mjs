import { createHash } from 'node:crypto';

import {
  canonicalizerPolicySource,
  validateCanonicalizerPolicy,
} from './policy.mjs';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

const PRE_M4130_POLICY_DIGEST =
  'c1b4f5b8e28eb4c0bb8a7fa0ef0a7dff64a4dd4cc952a5594d9ac95502e349a5';
const PRE_M4130_KIR_LIMITS = {
  maxBytes: 262_144,
  maxDepth: 77,
  maxNodes: 4_096,
};
const PRE_M4130_PROFILE_LIMITS = {
  maxNodeRows: 122,
  maxPropertyRows: 193,
  maxValueRows: 2_411,
};
const PRE_M4130_RUNTIME_BYTE_LIMITS = {
  maxBytes: 2_097_152,
  maxStringBytes: 1_048_576,
};

export function loadHistoricalCanonicalizerPolicy({
  expectedDigest,
  kirLimitOverrides,
  milestone,
  policySource = canonicalizerPolicySource(),
  profileLimits,
  runtimeLimitOverrides = {},
}) {
  const policy = JSON.parse(Buffer.from(policySource).toString('utf8'));
  policy.kirLimits = {
    ...policy.kirLimits,
    ...structuredClone(kirLimitOverrides),
  };
  policy.profileLimits = structuredClone(profileLimits);
  policy.runtimeLimits = {
    ...policy.runtimeLimits,
    ...structuredClone(runtimeLimitOverrides),
  };
  validateCanonicalizerPolicy(policy);
  const reconstructedBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`);
  if (digest(reconstructedBytes) !== expectedDigest) {
    throw new TypeError(
      `${milestone} historical policy rejection: unreconstructed policy fields must remain exact`,
    );
  }
  return policy;
}

export function loadPreM4130CanonicalizerPolicy() {
  return loadHistoricalCanonicalizerPolicy({
    expectedDigest: PRE_M4130_POLICY_DIGEST,
    kirLimitOverrides: PRE_M4130_KIR_LIMITS,
    milestone: 'pre-M4.130',
    profileLimits: PRE_M4130_PROFILE_LIMITS,
    runtimeLimitOverrides: PRE_M4130_RUNTIME_BYTE_LIMITS,
  });
}
