import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyOfflineConsumer } from './offline-consumer.mjs';

const limits = {
  commandTimeoutMs: 10_000,
  smokeTimeoutMs: 1_000,
  maxPackageJsonBytes: 64 * 1024,
  maxCommandOutputBytes: 2 * 1024 * 1024,
};

function manifest(bin = null) {
  return {
    schemaVersion: 1,
    packages: [
      {
        name: '@kernlang/core',
        tarball: 'kernlang-core.tgz',
        exports: {
          '.': './dist/index.js',
          './runner': { types: './dist/runner.d.ts', default: './dist/runner.js' },
          './package.json': './package.json',
        },
        bin: null,
      },
      {
        name: 'kern-lang',
        tarball: 'kern-lang.tgz',
        exports: { '.': './dist/index.js' },
        bin,
      },
    ],
  };
}

async function fixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'kern-offline-consumer-'));
  const out = path.join(rootDir, 'artifacts');
  await mkdir(out);
  await writeFile(path.join(out, 'kernlang-core.tgz'), 'core');
  await writeFile(path.join(out, 'kern-lang.tgz'), 'compat');
  return { rootDir, out };
}

test('offline consumer uses argv execution, exact tarball overrides, and offline mode', async () => {
  const { rootDir } = await fixture();
  let consumerPackage;
  let npmrc;
  const calls = [];
  try {
    const result = await verifyOfflineConsumer({
      manifest: manifest(),
      outDir: 'artifacts',
      rootDir,
      limits,
      safeBins: [],
      consumerBuiltDependencies: ['tree-sitter'],
      importSmokeExclusions: [],
      keepTemp: true,
      runCommandFn: async (file, args, options) => {
        calls.push({ file, args: [...args], options });
        if (file === 'pnpm') {
          consumerPackage = JSON.parse(
            await readFile(path.join(options.cwd, 'package.json'), 'utf8'),
          );
          npmrc = await readFile(path.join(options.cwd, '.npmrc'), 'utf8');
        }
        return { stdout: '', stderr: '' };
      },
    });

    assert.deepEqual(calls[0].args, [
      'install',
      '--lockfile-only',
      '--ignore-scripts',
      '--frozen-lockfile=false',
      '--prefer-offline',
    ]);
    assert.deepEqual(calls[1].args, ['fetch', '--prod', '--prefer-offline']);
    assert.deepEqual(calls[2].args, [
      'install',
      '--offline',
      '--frozen-lockfile',
    ]);
    assert.equal(calls.slice(3).every((call) => call.file === process.execPath), true);
    assert.equal(
      calls.every((call) => call.options.maxBuffer === limits.maxCommandOutputBytes),
      true,
    );
    assert.equal(calls.length, 6);
    assert.deepEqual(result.imports, ['@kernlang/core', '@kernlang/core/runner', 'kern-lang']);
    assert.equal(npmrc.includes('registry='), false);
    assert.equal(npmrc.includes('offline='), false);
    assert.deepEqual(consumerPackage.pnpm.overrides, consumerPackage.dependencies);
    assert.deepEqual(consumerPackage.pnpm.onlyBuiltDependencies, ['tree-sitter']);
    for (const target of Object.values(consumerPackage.dependencies)) {
      assert.match(target, /^file:/);
    }
    await rm(result.tempDir, { recursive: true, force: true });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('offline consumer rejects safe bin targets that escape the package', async () => {
  const { rootDir } = await fixture();
  try {
    await assert.rejects(
      () =>
        verifyOfflineConsumer({
          manifest: manifest({ kern: '../../escape.mjs' }),
          outDir: 'artifacts',
          rootDir,
          limits,
          safeBins: ['kern'],
          consumerBuiltDependencies: ['tree-sitter'],
          importSmokeExclusions: [],
          runCommandFn: async () => ({ stdout: '', stderr: '' }),
        }),
      /escapes package directory/i,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('offline consumer skips policy-excluded executable package imports', async () => {
  const { rootDir } = await fixture();
  const executableManifest = manifest();
  executableManifest.packages[0].bin = { 'kern-mcp': './dist/index.js' };
  try {
    const result = await verifyOfflineConsumer({
      manifest: executableManifest,
      outDir: 'artifacts',
      rootDir,
      limits,
      safeBins: [],
      consumerBuiltDependencies: ['tree-sitter'],
      importSmokeExclusions: ['@kernlang/core'],
      runCommandFn: async () => ({ stdout: '', stderr: '' }),
    });

    assert.deepEqual(result.imports, ['kern-lang']);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test('offline consumer rejects import exclusions without an executable surface', async () => {
  const { rootDir } = await fixture();
  try {
    await assert.rejects(
      () =>
        verifyOfflineConsumer({
          manifest: manifest(),
          outDir: 'artifacts',
          rootDir,
          limits,
          safeBins: [],
          consumerBuiltDependencies: ['tree-sitter'],
          importSmokeExclusions: ['@kernlang/core'],
          runCommandFn: async () => ({ stdout: '', stderr: '' }),
        }),
      /no executable surface/i,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
