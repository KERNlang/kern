import assert from 'node:assert/strict';
import test from 'node:test';

import {
  affectedPackages,
  changedFilesForNewRemoteRef,
  defaultBranchRef,
  packageRunArgs,
  prePushChangedFiles,
} from './pre-push.mjs';

const packages = [
  { relDir: 'packages/compat', name: 'kern-lang', scripts: { build: 'tsc -b' } },
  { relDir: 'packages/core', name: '@kernlang/core', scripts: { build: 'tsc -b', test: 'jest' } },
  { relDir: 'packages/python', name: '@kernlang/python', scripts: { build: 'tsc -b', test: 'jest' } },
  { relDir: 'packages/duplicate-name', name: 'kern-lang', scripts: {} },
];

test('prePushChangedFiles parses updated ref stdin', () => {
  const calls = [];
  const files = prePushChangedFiles({
    stdin: 'refs/heads/dev local-sha refs/heads/dev remote-sha\n',
    gitCommand(args) {
      calls.push(args);
      assert.deepEqual(args, ['diff', '--name-only', 'remote-sha', 'local-sha']);
      return 'packages/core/src/parser-core.ts\npackages/python/tests/http.test.ts\n';
    },
  });

  assert.deepEqual(files, ['packages/core/src/parser-core.ts', 'packages/python/tests/http.test.ts']);
  assert.equal(calls.length, 1);
});

test('prePushChangedFiles ignores deleted local refs', () => {
  const files = prePushChangedFiles({
    stdin:
      'refs/heads/dev 0000000000000000000000000000000000000000 refs/heads/dev remote-sha\n',
    gitCommand() {
      throw new Error('git should not be called for deleted refs');
    },
  });

  assert.deepEqual(files, []);
});

test('prePushChangedFiles routes new remote refs through new-branch logic', () => {
  const files = prePushChangedFiles({
    stdin:
      'refs/heads/feature local-sha refs/heads/feature 0000000000000000000000000000000000000000\n',
    gitCommand(args, options = {}) {
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return options.allowFailure ? null : '';
      if (command === 'rev-parse --verify --quiet origin/dev') return 'origin/dev';
      if (command === 'merge-base local-sha origin/dev') return 'base-sha';
      if (command === 'diff --name-only base-sha local-sha') return 'packages/core/src/parser-core.ts\n';
      throw new Error(`unexpected git call: ${command}`);
    },
  });

  assert.deepEqual(files, ['packages/core/src/parser-core.ts']);
});

test('prePushChangedFiles falls back to upstream when stdin is empty', () => {
  const files = prePushChangedFiles({
    stdin: '',
    gitCommand(args) {
      const command = args.join(' ');
      if (command === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return 'origin/dev';
      if (command === 'rev-parse --verify HEAD') return 'head-sha';
      if (command === 'diff --name-only origin/dev head-sha') return 'packages/core/src/parser-core.ts\n';
      throw new Error(`unexpected git call: ${command}`);
    },
  });

  assert.deepEqual(files, ['packages/core/src/parser-core.ts']);
});

test('changedFilesForNewRemoteRef prefers dev fallback before origin HEAD', () => {
  const calls = [];
  const files = changedFilesForNewRemoteRef('local-sha', (args, options = {}) => {
    calls.push(args);
    const command = args.join(' ');
    if (command === 'rev-parse --abbrev-ref --symbolic-full-name @{upstream}') return options.allowFailure ? null : '';
    if (command === 'rev-parse --verify --quiet origin/dev') return 'origin/dev';
    if (command === 'merge-base local-sha origin/dev') return 'base-sha';
    if (command === 'diff --name-only base-sha local-sha') return 'packages/core/src/parser-core.ts\n';
    throw new Error(`unexpected git call: ${command}`);
  });

  assert.deepEqual(files, ['packages/core/src/parser-core.ts']);
  assert.deepEqual(calls.at(-1), ['diff', '--name-only', 'base-sha', 'local-sha']);
});

test('changedFilesForNewRemoteRef fails closed when no base ref can be determined', () => {
  assert.throws(
    () =>
      changedFilesForNewRemoteRef('local-sha', (args, options = {}) => {
        if (options.allowFailure) return null;
        throw new Error(`unexpected git call: ${args.join(' ')}`);
      }),
    /could not determine a base ref/u,
  );
});

test('defaultBranchRef falls back to origin HEAD when named branches are unavailable', () => {
  const ref = defaultBranchRef((args, options = {}) => {
    const command = args.join(' ');
    if (command === 'symbolic-ref --quiet --short refs/remotes/origin/HEAD') return 'origin/main';
    if (options.allowFailure) return null;
    throw new Error(`unexpected git call: ${command}`);
  });

  assert.equal(ref, 'origin/main');
});

test('affectedPackages keeps duplicate package names by path', () => {
  const affected = affectedPackages(['packages/compat/src/index.ts', 'packages/duplicate-name/package.json'], packages);

  assert.deepEqual(
    affected.map((pkg) => pkg.relDir),
    ['packages/compat', 'packages/duplicate-name'],
  );
});

test('affectedPackages expands root infra changes to all workspace packages', () => {
  const affected = affectedPackages(['package.json'], packages);

  assert.deepEqual(
    affected.map((pkg) => pkg.relDir),
    ['packages/compat', 'packages/core', 'packages/duplicate-name', 'packages/python'],
  );
});

test('affectedPackages expands root script changes to all workspace packages', () => {
  const affected = affectedPackages(['scripts/pre-push.mjs'], packages);

  assert.deepEqual(
    affected.map((pkg) => pkg.relDir),
    ['packages/compat', 'packages/core', 'packages/duplicate-name', 'packages/python'],
  );
});

test('packageRunArgs mirrors root test exclusion for review-python', () => {
  assert.deepEqual(packageRunArgs([packages[1]], 'test'), [
    '-r',
    '--filter',
    '...{./packages/core}',
    '--filter',
    '!@kernlang/review-python',
    'run',
    'test',
  ]);
});
