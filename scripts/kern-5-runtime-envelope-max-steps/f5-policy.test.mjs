import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { validatePolicy } from '../kern-frontend-f5-projection/policy-validation.mjs';
import { ENVELOPE_LIMIT_KEYS, REPO_ROOT } from './support.mjs';

const POLICY_PATH = join(REPO_ROOT, 'scripts/kern-frontend-f5-projection/policy.json');
const F5_WORK_STEPS = 100_663_296;
const F5_COLLECTION_LENGTH = 1_048_576;

function policy() {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
}

function withRuntimeLimits(overrides) {
  const candidate = policy();
  candidate.runtimeLimits = { ...candidate.runtimeLimits, ...overrides };
  return candidate;
}

test('L4: the shipped F5 policy carries maxIterations equal to maxWorkSteps', () => {
  const shipped = policy();
  assert.equal(shipped.profileLimits.maxWorkSteps, F5_WORK_STEPS);
  assert.equal(shipped.runtimeLimits.maxIterations, F5_WORK_STEPS);
});

test('L4: the F5 collection ceiling is NOT widened by this slice', () => {
  assert.equal(policy().runtimeLimits.maxCollectionLength, F5_COLLECTION_LENGTH);
  assert.equal(policy().profileLimits.maxCollectionLength, 262_144);
  assert.equal(policy().canonicalLimits.maxCollectionLength, 262_144);
});

test('L4: runtimeLimits is exactly the envelope limits key set', () => {
  assert.deepEqual(Object.keys(policy().runtimeLimits).sort(), [...ENVELOPE_LIMIT_KEYS]);
});

test('L4: validatePolicy accepts the shipped policy', () => {
  assert.equal(validatePolicy(policy()).runtimeLimits.maxIterations, F5_WORK_STEPS);
});

test('L4: validatePolicy refuses runtimeLimits without maxIterations', () => {
  const candidate = policy();
  const { maxIterations: _removed, ...rest } = candidate.runtimeLimits;
  candidate.runtimeLimits = rest;
  assert.throws(() => validatePolicy(candidate), {
    message: 'F5 projection policy: runtime limits keys',
  });
});

test('L4: validatePolicy refuses a non-positive or non-integer maxIterations', () => {
  for (const maxIterations of [0, -1, 1.5]) {
    assert.throws(() => validatePolicy(withRuntimeLimits({ maxIterations })), {
      message: 'F5 projection policy: runtime limits maxIterations',
    });
  }
});

test('L4: validatePolicy refuses maxWorkSteps greater than maxIterations', () => {
  assert.throws(() => validatePolicy(withRuntimeLimits({ maxIterations: F5_WORK_STEPS - 1 })), {
    message: 'F5 projection policy: limit relationship',
  });
  assert.equal(validatePolicy(withRuntimeLimits({ maxIterations: F5_WORK_STEPS })).format, policy().format);
  assert.equal(validatePolicy(withRuntimeLimits({ maxIterations: F5_WORK_STEPS + 1 })).format, policy().format);
});

test('L4: the pre-existing limit relationships still hold', () => {
  const shipped = policy();
  assert.ok(shipped.profileLimits.maxDepth <= shipped.runtimeLimits.maxDepth);
  assert.ok(shipped.profileLimits.maxInstructionScalars <= shipped.runtimeLimits.maxStringBytes);
  assert.ok(shipped.canonicalLimits.maxDepth <= shipped.profileLimits.maxDepth);
});
