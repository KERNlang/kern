import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertRunnerBrowserBudgetLifecycle,
  loadRunnerBrowserBudgetPolicy,
} from './runner-browser-budget-policy.mjs';
import { ChromeDevToolsStartupTimeoutError, retryChromeDevToolsStartup } from './runner-browser-budget-retry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'packages/core/dist');
const POLICY_PATH = resolve(ROOT, 'scripts/runner-browser-budget-policy.json');

function policyCopy() {
  return JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
}

test('checked-in runner browser budget policy is valid', () => {
  const policy = loadRunnerBrowserBudgetPolicy(POLICY_PATH);
  assert.equal(policy.baseline.milestone, 'KERN-5-R2-M4.40');
  assert.equal(policy.limits.maxInternalRawBytes, Math.round(policy.baseline.measuredRawBytes * 1.05));
  assert.equal(policy.limits.maxInternalGzipBytes, Math.round(policy.baseline.measuredGzipBytes * 1.05));
  assert.equal(policy.limits.chromeDevToolsStartupAttempts, 2);
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

test('a transient Chrome DevTools startup timeout retries exactly once before measurement', async () => {
  const attempts = [];
  const retries = [];
  const result = await retryChromeDevToolsStartup(
    async (attempt) => {
      attempts.push(attempt);
      if (attempt === 1) throw new ChromeDevToolsStartupTimeoutError('transient startup stall');
      assert.deepEqual(retries, [{ error: 'timed out waiting for Chrome DevTools port: transient startup stall', attempt: 1 }]);
      return 'measured';
    },
    2,
    async (error, attempt) => {
      await Promise.resolve();
      retries.push({ error: error.message, attempt });
    },
  );
  assert.equal(result, 'measured');
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(retries, [{ error: 'timed out waiting for Chrome DevTools port: transient startup stall', attempt: 1 }]);
});

test('Chrome DevTools startup retry exhausts its configured attempts and propagates the final error', async () => {
  const attempts = [];
  const retries = [];
  const terminal = new ChromeDevToolsStartupTimeoutError('still stalled');
  await assert.rejects(
    retryChromeDevToolsStartup(
      async (attempt) => {
        attempts.push(attempt);
        throw attempt === 2 ? terminal : new ChromeDevToolsStartupTimeoutError('first stall');
      },
      2,
      async (_error, attempt) => retries.push(attempt),
    ),
    (error) => error === terminal,
  );
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(retries, [1]);
});

test('Chrome startup retry does not mask non-startup browser failures', async () => {
  const attempts = [];
  await assert.rejects(
    retryChromeDevToolsStartup(
      async (attempt) => {
        attempts.push(attempt);
        throw new Error('browser smoke fixture failed: assertion mismatch');
      },
      2,
      () => assert.fail('non-startup failures must not retry'),
    ),
    /browser smoke fixture failed/u,
  );
  assert.deepEqual(attempts, [1]);
});
