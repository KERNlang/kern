import { createHash } from 'node:crypto';

import {
  canonicalizerPolicySource,
  validateCanonicalizerPolicy,
} from './policy.mjs';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function loadHistoricalCanonicalizerPolicy({
  expectedDigest,
  kirLimitOverrides,
  milestone,
  policySource = canonicalizerPolicySource(),
  profileLimits,
}) {
  const policy = JSON.parse(Buffer.from(policySource).toString('utf8'));
  policy.kirLimits = {
    ...policy.kirLimits,
    ...structuredClone(kirLimitOverrides),
  };
  policy.profileLimits = structuredClone(profileLimits);
  validateCanonicalizerPolicy(policy);
  const reconstructedBytes = Buffer.from(`${JSON.stringify(policy, null, 2)}\n`);
  if (digest(reconstructedBytes) !== expectedDigest) {
    throw new TypeError(
      `${milestone} historical policy rejection: unreconstructed policy fields must remain exact`,
    );
  }
  return policy;
}
