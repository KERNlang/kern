import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { nodeInvocation, prebuiltSegments, runPrebuiltScript } from './run-prebuilt-test.mjs';

test('removes only the approved leading build preamble', () => {
  const packageJson = {
    scripts: {
      'test:kern-leaf':
        'pnpm --filter @kernlang/core build && pnpm --filter @kernlang/cli build && node first.mjs && node second.mjs',
    },
  };
  assert.deepEqual(prebuiltSegments(packageJson, 'test:kern-leaf'), ['node first.mjs', 'node second.mjs']);
});

test('rejects scripts without a build preamble, nested aggregates, and later builds', () => {
  assert.throws(
    () => prebuiltSegments({ scripts: { 'test:kern-leaf': 'node test.mjs' } }, 'test:kern-leaf'),
    /approved build preamble/u,
  );
  assert.throws(
    () =>
      prebuiltSegments(
        { scripts: { 'test:kern-aggregate': 'pnpm --filter @kernlang/core build && pnpm test:kern-leaf' } },
        'test:kern-aggregate',
      ),
    /aggregate/u,
  );
  assert.throws(
    () =>
      prebuiltSegments(
        { scripts: { 'test:kern-late-build': 'pnpm --filter @kernlang/core build && node test.mjs && pnpm run build' } },
        'test:kern-late-build',
      ),
    /outside its leading preamble/u,
  );
});

test('rejects shell syntax, interpolation, traversal, and non-node commands', () => {
  for (const command of [
    'node test.mjs; echo injected',
    'node test.mjs | tee output',
    'node $(echo test.mjs)',
    'node $USER/test.mjs',
    'node ../outside.mjs',
    'pnpm check:repo',
  ]) {
    assert.throws(
      () =>
        prebuiltSegments(
          { scripts: { 'test:kern-unsafe': `pnpm --filter @kernlang/core build && ${command}` } },
          'test:kern-unsafe',
        ),
      /node-only|escape the repository|must invoke node/u,
      command,
    );
  }
});

test('all 15 sharded leaf scripts produce shell-free node invocations', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const tiers = [
    'test:pr-frontend-properties-extended',
    'test:pr-frontend-composition',
    'test:pr-frontend-language',
    'test:pr-frontend-tooling',
  ];
  const leaves = tiers.flatMap((tier) => packageJson.scripts[tier].split(' && '));
  assert.equal(leaves.length, 15);
  for (const leaf of leaves) {
    const scriptName = leaf.slice('pnpm '.length);
    for (const segment of prebuiltSegments(packageJson, scriptName)) {
      const invocation = nodeInvocation(segment);
      assert.equal(invocation.command, process.execPath);
      assert.ok(invocation.args.length > 0);
      assert.equal(invocation.args.some((argument) => argument.includes('*')), false);
    }
  }
});

test('stops at the first failing semantic command', () => {
  const calls = [];
  const status = runPrebuiltScript(
    {
      scripts: {
        'test:kern-leaf': 'pnpm --filter @kernlang/core build && node first.mjs && node second.mjs',
      },
    },
    'test:kern-leaf',
    {
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return { status: args.includes('first.mjs') ? 7 : 0 };
      },
    },
  );
  assert.equal(status, 7);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, ['first.mjs']);
  assert.equal('shell' in calls[0].options, false);
});
