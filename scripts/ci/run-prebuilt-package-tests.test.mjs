import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertSelectedBuildCoverage,
  loadPackageManifests,
  pnpmTestArgs,
  selectTestPackages,
} from './run-prebuilt-package-tests.mjs';

const standardTest = 'pnpm run build && node ../../scripts/run-node-tests.mjs "tests/**/*.test.ts"';

test('selects test-bearing packages without hardcoding the workspace roster', () => {
  const manifests = [
    { name: '@kernlang/a', scripts: { test: standardTest } },
    { name: '@kernlang/b', scripts: { test: standardTest } },
    { name: '@kernlang/no-tests', scripts: {} },
  ];
  assert.deepEqual(selectTestPackages(manifests, { exclude: ['@kernlang/b'] }), ['@kernlang/a']);
  assert.deepEqual(selectTestPackages(manifests, { only: ['@kernlang/b'] }), ['@kernlang/b']);
});

test('rejects unknown filters and non-standard test scripts', () => {
  const manifests = [{ name: '@kernlang/a', scripts: { test: standardTest } }];
  assert.throws(() => selectTestPackages(manifests, { only: ['@kernlang/missing'] }), /unknown workspace/u);
  assert.throws(
    () => selectTestPackages([{ name: '@kernlang/a', scripts: { test: 'node custom.mjs' } }]),
    /not the supported/u,
  );
});

test('constructs a no-shell pnpm recursive exec command', () => {
  const args = pnpmTestArgs(['@kernlang/a', '@kernlang/b'], ['--testPathIgnorePatterns=ir-semantics']);
  assert.deepEqual(args.slice(0, 6), ['-r', '--filter', '@kernlang/a', '--filter', '@kernlang/b', 'exec']);
  assert.equal(args.at(-1), '--testPathIgnorePatterns=ir-semantics');
  assert.equal(args.includes('test'), false);
  assert.equal(args.includes('build'), false);
});

test('the current workspace package tests retain the supported semantic shape', () => {
  const manifests = loadPackageManifests();
  const selected = selectTestPackages(manifests, { exclude: ['@kernlang/review-python'] });
  assert.ok(selected.includes('@kernlang/review'));
  assert.ok(selected.length > 1);
});

test('build:packages subsumes every selected package build side effect', () => {
  const manifests = loadPackageManifests();
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const tsconfig = JSON.parse(readFileSync('tsconfig.json', 'utf8'));
  const selected = selectTestPackages(manifests, { exclude: ['@kernlang/review-python'] });
  assert.doesNotThrow(() =>
    assertSelectedBuildCoverage(manifests, selected, packageJson.scripts['build:packages'], tsconfig.references),
  );
});

test('build coverage fails closed on an unreferenced package or new build side effect', () => {
  const base = {
    name: '@kernlang/a',
    workspaceDirectory: 'a',
    scripts: { build: 'tsc -b', test: standardTest },
  };
  assert.throws(
    () => assertSelectedBuildCoverage([base], ['@kernlang/a'], 'tsc -b', []),
    /does not cover/u,
  );
  assert.throws(
    () =>
      assertSelectedBuildCoverage(
        [{ ...base, scripts: { ...base.scripts, build: 'tsc -b && node scripts/generate.mjs' } }],
        ['@kernlang/a'],
        'tsc -b',
        [{ path: 'packages/a' }],
      ),
    /generate\.mjs/u,
  );
});
