import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertRunnerBrowserBudgetLifecycle,
  loadRunnerBrowserBudgetPolicy,
} from './runner-browser-budget-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'packages/core/dist');
const POLICY_PATH = resolve(ROOT, 'scripts/runner-browser-budget-policy.json');

function policyCopy() {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
}

test('checked-in runner browser budget policy is valid', () => {
  const policy = loadRunnerBrowserBudgetPolicy(POLICY_PATH);
  assert.equal(policy.baseline.milestone, 'KERN-5-R2-M3.31a');
  assert.equal(policy.limits.maxInternalRawBytes, Math.round(policy.baseline.measuredRawBytes * 1.05));
  assert.equal(policy.limits.maxInternalGzipBytes, Math.round(policy.baseline.measuredGzipBytes * 1.05));
});

test('transition ceiling remains valid only while the legacy module is reachable', () => {
  const policy = policyCopy();
  const legacyModule = resolve(DIST, policy.transition.legacyModule);
  assert.doesNotThrow(() => assertRunnerBrowserBudgetLifecycle(policy, new Set([legacyModule]), DIST));
  assert.throws(
    () => assertRunnerBrowserBudgetLifecycle(policy, new Set(), DIST),
    /restore pre-transition byte ceilings/u,
  );
});

test('legacy removal admits ceilings restored to their pre-transition values', () => {
  const policy = policyCopy();
  policy.limits.maxInternalRawBytes = policy.transition.preTransitionMaxInternalRawBytes;
  policy.limits.maxInternalGzipBytes = policy.transition.preTransitionMaxInternalGzipBytes;
  assert.doesNotThrow(() => assertRunnerBrowserBudgetLifecycle(policy, new Set(), DIST));
});
