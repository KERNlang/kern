import assert from 'node:assert/strict';
import test from 'node:test';

import { runKernFormatterWall } from '../check-kern-formatter-wall.mjs';
import {
  DEFAULT_KERN_FORMATTER_WALL_TIMEOUT_MS,
  resolveKernFormatterWallTimeoutMs,
} from './wall-timeout-policy.mjs';

test('formatter wall timeout policy defaults to fifteen minutes and accepts positive integers', () => {
  assert.equal(DEFAULT_KERN_FORMATTER_WALL_TIMEOUT_MS, 900_000);
  assert.equal(resolveKernFormatterWallTimeoutMs({}), 900_000);
  assert.equal(resolveKernFormatterWallTimeoutMs({ KERN_FORMATTER_WALL_TIMEOUT_MS: '1' }), 1);
  assert.equal(resolveKernFormatterWallTimeoutMs({ KERN_FORMATTER_WALL_TIMEOUT_MS: '1200000' }), 1_200_000);
});

test('formatter wall timeout policy rejects malformed, negative, and non-integer values', () => {
  for (const value of ['', '-1', '1.5', ' 10', '10 ', '01', 'Infinity', 'abc', '9007199254740992']) {
    assert.throws(
      () => resolveKernFormatterWallTimeoutMs({ KERN_FORMATTER_WALL_TIMEOUT_MS: value }),
      /KERN_FORMATTER_WALL_TIMEOUT_MS/u,
      value,
    );
  }
});

test('zero disables the formatter wall timeout only outside CI', () => {
  assert.equal(resolveKernFormatterWallTimeoutMs({ KERN_FORMATTER_WALL_TIMEOUT_MS: '0' }), 0);
  for (const ci of ['', 'false', '0', 'true']) {
    assert.throws(
      () => resolveKernFormatterWallTimeoutMs({ CI: ci, KERN_FORMATTER_WALL_TIMEOUT_MS: '0' }),
      /cannot be disabled in CI/u,
      `CI=${JSON.stringify(ci)}`,
    );
  }
});

test('formatter wall reports stubbed child timeouts with budget, elapsed time, and exit 124', () => {
  const calls = [];
  const ticks = [1_000, 1_027];
  const result = runKernFormatterWall({
    checkPath: '/tmp/check.mjs',
    env: { TEST_ONLY: 'yes' },
    executable: '/tmp/node',
    now: () => ticks.shift(),
    spawn: (...args) => {
      calls.push(args);
      return { error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) };
    },
    timeoutMs: 25,
  });

  assert.deepEqual(calls, [
    [
      '/tmp/node',
      ['/tmp/check.mjs'],
      { encoding: 'utf8', env: { TEST_ONLY: 'yes' }, timeout: 25 },
    ],
  ]);
  assert.equal(result.exitCode, 124);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'KERN formatter corpus wall timed out: budget=25ms elapsed=27ms\n');
});

test('formatter wall omits a disabled timeout and preserves semantic child status', () => {
  let spawnOptions;
  const result = runKernFormatterWall({
    checkPath: '/tmp/check.mjs',
    env: {},
    executable: '/tmp/node',
    now: () => 0,
    spawn: (_executable, _argv, options) => {
      spawnOptions = options;
      return { error: undefined, status: 7, stderr: 'semantic failure\n', stdout: '' };
    },
    timeoutMs: 0,
  });

  assert.equal(Object.hasOwn(spawnOptions, 'timeout'), false);
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'KERN formatter corpus wall failed (7): semantic failure\n');
});
