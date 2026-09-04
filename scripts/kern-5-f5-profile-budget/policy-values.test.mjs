import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BASE_CANONICAL_LIMITS,
  BASE_PROFILE_LIMITS,
  BASE_RUNTIME_LIMITS,
  BASE_WORK_STEPS,
  RAISED_KEYS,
  RAISED_WORK_STEPS,
  SCHEDULER_TIMEOUT_MS,
  movedKeys,
  policy,
} from './support.mjs';

test('B1: the shipped F5 profile work-step budget is the raised cap', () => {
  assert.equal(policy().profileLimits.maxWorkSteps, RAISED_WORK_STEPS);
});

test('B1: the shipped envelope iteration budget carries the raised cap', () => {
  assert.equal(policy().runtimeLimits.maxIterations, RAISED_WORK_STEPS);
});

test('B1: the raised cap is the measured 3x derivation, not a padded round number', () => {
  assert.equal(RAISED_WORK_STEPS, BASE_WORK_STEPS * 3);
  assert.equal(RAISED_WORK_STEPS, 96 * 2 ** 20);
  assert.equal(policy().profileLimits.maxWorkSteps, BASE_WORK_STEPS * 3);
});

test('B1: exactly the two named keys moved off the base policy', () => {
  const shipped = policy();
  const moved = [
    ...movedKeys(shipped, 'profileLimits', BASE_PROFILE_LIMITS),
    ...movedKeys(shipped, 'canonicalLimits', BASE_CANONICAL_LIMITS),
    ...movedKeys(shipped, 'runtimeLimits', BASE_RUNTIME_LIMITS),
  ];
  assert.deepEqual(moved, [...RAISED_KEYS]);
});

test('B1: no collection ceiling is widened by this slice', () => {
  const shipped = policy();
  assert.equal(shipped.runtimeLimits.maxCollectionLength, 1_048_576);
  assert.equal(shipped.profileLimits.maxCollectionLength, 262_144);
  assert.equal(shipped.canonicalLimits.maxCollectionLength, 262_144);
});

test('B1: the scheduler timeout ruling still stands', () => {
  assert.equal(policy().scheduler.timeoutMs, SCHEDULER_TIMEOUT_MS);
  assert.deepEqual(Object.keys(policy().scheduler), ['timeoutMs']);
});

test('B1: no limits section gained or lost a key', () => {
  const shipped = policy();
  assert.deepEqual(Object.keys(shipped.profileLimits), Object.keys(BASE_PROFILE_LIMITS));
  assert.deepEqual(Object.keys(shipped.canonicalLimits), Object.keys(BASE_CANONICAL_LIMITS));
  assert.deepEqual(Object.keys(shipped.runtimeLimits), Object.keys(BASE_RUNTIME_LIMITS));
});
