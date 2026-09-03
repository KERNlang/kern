import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePolicy } from '../kern-frontend-f5-projection/policy-validation.mjs';
import { BASE_WORK_STEPS, RAISED_WORK_STEPS, policy, text } from './support.mjs';

const ENVELOPE_L4 = 'scripts/kern-5-runtime-envelope-max-steps/f5-policy.test.mjs';

function withRuntimeLimits(overrides) {
  const candidate = policy();
  candidate.runtimeLimits = { ...candidate.runtimeLimits, ...overrides };
  return candidate;
}

function withProfileLimits(overrides) {
  const candidate = policy();
  candidate.profileLimits = { ...candidate.profileLimits, ...overrides };
  return candidate;
}

test('B2: validatePolicy accepts the shipped policy', () => {
  assert.equal(validatePolicy(policy()).profileLimits.maxWorkSteps, policy().profileLimits.maxWorkSteps);
});

test('B2: validatePolicy still refuses maxWorkSteps greater than maxIterations', () => {
  const shipped = policy();
  assert.throws(() => validatePolicy(withRuntimeLimits({ maxIterations: shipped.profileLimits.maxWorkSteps - 1 })), {
    message: 'F5 projection policy: limit relationship',
  });
  assert.throws(() => validatePolicy(withProfileLimits({ maxWorkSteps: shipped.runtimeLimits.maxIterations + 1 })), {
    message: 'F5 projection policy: limit relationship',
  });
});

test('B2: equality of the two budgets is a choice, not a contract', () => {
  const shipped = policy();
  assert.equal(validatePolicy(withRuntimeLimits({ maxIterations: shipped.profileLimits.maxWorkSteps })).format,
    shipped.format);
  assert.equal(validatePolicy(withRuntimeLimits({ maxIterations: shipped.profileLimits.maxWorkSteps + 1 })).format,
    shipped.format);
});

test('B2: the raised cap is still a positive safe integer at both tiers', () => {
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => validatePolicy(withProfileLimits({ maxWorkSteps: value })), /profile limits maxWorkSteps/u);
    assert.throws(() => validatePolicy(withRuntimeLimits({ maxIterations: value })), /runtime limits maxIterations/u);
  }
});

test('B2: the pre-existing limit relationships are untouched', () => {
  const shipped = policy();
  assert.ok(shipped.profileLimits.maxDepth <= shipped.runtimeLimits.maxDepth);
  assert.ok(shipped.canonicalLimits.maxDepth <= shipped.profileLimits.maxDepth);
  assert.ok(shipped.profileLimits.maxInstructionScalars <= shipped.runtimeLimits.maxStringBytes);
});

const grouped = (value) => String(value).replace(/\B(?=(\d{3})+$)/gu, '_');

test('B2: the envelope slice L4 constant is re-pinned onto the raised cap', () => {
  const source = text(ENVELOPE_L4);
  assert.ok(source.includes(`F5_WORK_STEPS = ${grouped(RAISED_WORK_STEPS)};`),
    `${ENVELOPE_L4} must pin F5_WORK_STEPS = ${grouped(RAISED_WORK_STEPS)}`);
  assert.equal(source.includes(grouped(BASE_WORK_STEPS)), false,
    `${ENVELOPE_L4} still carries the base cap ${grouped(BASE_WORK_STEPS)}`);
});
