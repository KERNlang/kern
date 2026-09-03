import { readFileSync } from 'node:fs';

const CANONICALIZER_POLICY_SOURCE = readFileSync(new URL('./policy.json', import.meta.url));

const POLICY_KEYS = {
  expansionLimits: ['kirToSourceMaxFactor', 'runtimeEnvelopeMaxFactor'],
  kirLimits: [
    'maxBytes', 'maxCollectionLength', 'maxDecimalChars', 'maxDepth',
    'maxFractionDigits', 'maxIntegerDigits', 'maxMapEntries', 'maxNodes',
    'maxRecordFields', 'maxStringBytes',
  ],
  profileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
  runtimeLimits: [
    'maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxIterations',
    'maxStringBytes',
  ],
};

function fail(message) {
  throw new TypeError(`canonicalizer policy rejection: ${message}`);
}

function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    fail(`${label} must contain exactly ${sortedExpected.join(',')}`);
  }
}

export function validateCanonicalizerPolicy(policy) {
  assertExactKeys(policy, Object.keys(POLICY_KEYS), 'policy');
  for (const [label, keys] of Object.entries(POLICY_KEYS)) {
    const group = policy[label];
    assertExactKeys(group, keys, label);
    for (const [key, value] of Object.entries(group)) {
      if (!Number.isSafeInteger(value) || value <= 0) fail(`${label}.${key} must be a positive safe integer`);
    }
  }
  const requiredStringBytes = policy.kirLimits.maxBytes * policy.expansionLimits.kirToSourceMaxFactor;
  if (!Number.isSafeInteger(requiredStringBytes) || policy.runtimeLimits.maxStringBytes < requiredStringBytes) {
    fail('runtimeLimits.maxStringBytes must cover the configured KIR-to-source expansion');
  }
  const requiredEnvelopeBytes =
    policy.runtimeLimits.maxStringBytes * policy.expansionLimits.runtimeEnvelopeMaxFactor;
  if (!Number.isSafeInteger(requiredEnvelopeBytes) || policy.runtimeLimits.maxBytes < requiredEnvelopeBytes) {
    fail('runtimeLimits.maxBytes must cover the configured runtime envelope expansion');
  }
  return policy;
}

export function loadCanonicalizerPolicy() {
  return validateCanonicalizerPolicy(
    JSON.parse(CANONICALIZER_POLICY_SOURCE.toString('utf8')),
  );
}

export function canonicalizerPolicySource() {
  return Buffer.from(CANONICALIZER_POLICY_SOURCE);
}
