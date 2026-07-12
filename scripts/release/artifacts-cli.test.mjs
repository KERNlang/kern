import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import os from 'node:os';

import { parseArtifactArgs } from './artifacts-cli.mjs';
import { readPackageJsonFromTarball } from './tar-entry.mjs';
import { constructManifest } from './artifact-manifest.mjs';
import { packArtifacts } from './pack-artifacts.mjs';
import { stringifyCanonical } from './artifact-types.mjs';

// Preserve existing RED tests
test('artifact CLI requires explicit paths and enables offline verification', () => {
  assert.deepEqual(
    parseArtifactArgs([
      '--plan',
      '.release/release-plan.json',
      '--out',
      '.release/artifacts',
      '--manifest',
      '.release/artifact-manifest.json',
      '--offline-consumer-test',
    ]),
    {
      plan: '.release/release-plan.json',
      out: '.release/artifacts',
      manifest: '.release/artifact-manifest.json',
      offlineConsumerTest: true,
      keepTemp: false,
    },
  );
});

for (const args of [
  [],
  ['--plan', 'plan.json', '--out', 'artifacts'],
  [
    '--plan',
    'plan.json',
    '--out',
    'artifacts',
    '--manifest',
    'manifest.json',
    '--unknown',
  ],
  [
    '--plan',
    'plan.json',
    '--plan',
    'other.json',
    '--out',
    'artifacts',
    '--manifest',
    'manifest.json',
  ],
]) {
  test(`artifact CLI rejects invalid arguments: ${args.join(' ') || '<empty>'}`, () => {
    assert.throws(() => parseArtifactArgs(args), /required|unknown|duplicate/i);
  });
}

// ----------------------------------------------------
// EXTENDED DISCRIMINATING FIXTURE & MUTATION TESTS
// ----------------------------------------------------

function createDummyTarball(name, version, extraPackageJsonProps = {}) {
  const pkgJsonContent = JSON.stringify({ name, version, ...extraPackageJsonProps });
  const pkgJsonBuf = Buffer.from(pkgJsonContent, 'utf8');
  const size = pkgJsonBuf.length;

  const header = Buffer.alloc(512);
  header.write('package/package.json', 0, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  const octalSize = size.toString(8).padStart(11, '0') + '\0';
  header.write(octalSize, 124, 'ascii');
  header.write('ustar\0', 257, 'ascii');

  const paddedContentSize = Math.ceil(size / 512) * 512;
  const content = Buffer.alloc(paddedContentSize);
  pkgJsonBuf.copy(content);

  const trailer = Buffer.alloc(1024);

  const tar = Buffer.concat([header, content, trailer]);
  return zlib.gzipSync(tar);
}

function createDuplicateTarball(name, version) {
  const pkgJsonContent = JSON.stringify({ name, version });
  const pkgJsonBuf = Buffer.from(pkgJsonContent, 'utf8');
  const size = pkgJsonBuf.length;

  const header = Buffer.alloc(512);
  header.write('package/package.json', 0, 'utf8');
  header.write('0000644\0', 100, 'ascii');
  const octalSize = size.toString(8).padStart(11, '0') + '\0';
  header.write(octalSize, 124, 'ascii');
  header.write('ustar\0', 257, 'ascii');

  const paddedContentSize = Math.ceil(size / 512) * 512;
  const content = Buffer.alloc(paddedContentSize);
  pkgJsonBuf.copy(content);

  const tar = Buffer.concat([header, content, header, content, Buffer.alloc(1024)]);
  return zlib.gzipSync(tar);
}

const mockPlan = {
  planVersion: 1,
  sha: 'a'.repeat(40),
  channel: 'stable',
  version: '5.0.0',
  distTag: 'latest',
  packages: [
    { name: '@kernlang/core', path: 'packages/core', dependencies: [] },
    { name: 'kern-lang', path: 'packages/compat', dependencies: ['@kernlang/core'] },
  ],
};

const testSha512 = '00'.repeat(64);
const testIntegrity = `sha512-${Buffer.alloc(64).toString('base64')}`;

const tmpTestDir = path.resolve(os.tmpdir(), 'temp-test-artifacts-' + crypto.randomBytes(6).toString('hex'));
const tarLimits = {
  maxUnpackedBytes: 1024 * 1024,
  maxPackageJsonBytes: 64 * 1024,
  maxCommandOutputBytes: 2 * 1024 * 1024,
};

function setupTestDir() {
  if (fs.existsSync(tmpTestDir)) {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tmpTestDir, { recursive: true });
  fs.mkdirSync(path.join(tmpTestDir, 'packages/core'), { recursive: true });
  fs.mkdirSync(path.join(tmpTestDir, 'packages/compat'), { recursive: true });

  fs.writeFileSync(
    path.join(tmpTestDir, 'packages/core/package.json'),
    JSON.stringify({ name: '@kernlang/core', version: '5.0.0' }),
  );
  fs.writeFileSync(
    path.join(tmpTestDir, 'packages/compat/package.json'),
    JSON.stringify({ name: 'kern-lang', version: '5.0.0', dependencies: { '@kernlang/core': 'workspace:*' } }),
  );
}

function cleanupTestDir() {
  if (fs.existsSync(tmpTestDir)) {
    fs.rmSync(tmpTestDir, { recursive: true, force: true });
  }
}

test('constructManifest successfully parses exact pins and preserves order', () => {
  const packedInfo = [
    {
      name: '@kernlang/core',
      version: '5.0.0',
      tarball: 'kernlang-core-5.0.0.tgz',
      size: 100,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: '@kernlang/core', version: '5.0.0' },
    },
    {
      name: 'kern-lang',
      version: '5.0.0',
      tarball: 'kernlang-compat-5.0.0.tgz',
      size: 150,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: {
        name: 'kern-lang',
        version: '5.0.0',
        dependencies: { '@kernlang/core': '5.0.0', 'external-lib': '^1.0.0' },
        optionalDependencies: { 'other-external': '2.0.0' },
      },
    },
  ];

  const manifest = constructManifest({ plan: mockPlan, packedInfo });
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.packages[0].name, '@kernlang/core');
  assert.equal(manifest.packages[1].name, 'kern-lang');
  assert.deepEqual(manifest.packages[1].internalRuntimeDependencies, [
    { name: '@kernlang/core', kind: 'dependency', version: '5.0.0' },
  ]);
});

test('constructManifest rejects when pack omits kern-lang', () => {
  const planWithoutCompat = {
    ...mockPlan,
    packages: [{ name: '@kernlang/core', path: 'packages/core', dependencies: [] }],
  };
  const packedInfo = [
    {
      name: '@kernlang/core',
      version: '5.0.0',
      tarball: 'core.tgz',
      size: 100,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: '@kernlang/core', version: '5.0.0' },
    },
  ];
  assert.throws(() => constructManifest({ plan: planWithoutCompat, packedInfo }), /kern-lang/);
});

test('constructManifest rejects when pack includes private package or banned names', () => {
  const packedInfo = [
    {
      name: '@kernlang/core',
      version: '5.0.0',
      tarball: 'core.tgz',
      size: 100,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: '@kernlang/core', version: '5.0.0', private: true },
    },
    {
      name: 'kern-lang',
      version: '5.0.0',
      tarball: 'compat.tgz',
      size: 150,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: 'kern-lang', version: '5.0.0' },
    },
  ];
  assert.throws(() => constructManifest({ plan: mockPlan, packedInfo }), /private/);
});

test('constructManifest rejects when package order differs from plan', () => {
  const packedInfo = [
    {
      name: 'kern-lang',
      version: '5.0.0',
      tarball: 'compat.tgz',
      size: 150,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: 'kern-lang', version: '5.0.0' },
    },
    {
      name: '@kernlang/core',
      version: '5.0.0',
      tarball: 'core.tgz',
      size: 100,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: '@kernlang/core', version: '5.0.0' },
    },
  ];
  assert.throws(
    () => constructManifest({ plan: mockPlan, packedInfo }),
    /order\/name mismatch/i,
  );
});

test('constructManifest rejects version mismatch', () => {
  const packedInfo = [
    {
      name: '@kernlang/core',
      version: '4.9.0',
      tarball: 'core.tgz',
      size: 100,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: '@kernlang/core', version: '4.9.0' },
    },
    {
      name: 'kern-lang',
      version: '5.0.0',
      tarball: 'compat.tgz',
      size: 150,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: 'kern-lang', version: '5.0.0' },
    },
  ];
  assert.throws(() => constructManifest({ plan: mockPlan, packedInfo }), /Version mismatch/);
});

test('constructManifest rejects unpinned internal runtime dependency', () => {
  const packedInfo = [
    {
      name: '@kernlang/core',
      version: '5.0.0',
      tarball: 'core.tgz',
      size: 100,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: { name: '@kernlang/core', version: '5.0.0' },
    },
    {
      name: 'kern-lang',
      version: '5.0.0',
      tarball: 'compat.tgz',
      size: 150,
      sha512: testSha512,
      integrity: testIntegrity,
      pkgJson: {
        name: 'kern-lang',
        version: '5.0.0',
        dependencies: { '@kernlang/core': 'workspace:*' },
      },
    },
  ];
  assert.throws(() => constructManifest({ plan: mockPlan, packedInfo }), /pinned to exact version/);
});

test('readPackageJsonFromTarball extracts package.json or throws on invalid tarballs', () => {
  const tarball = createDummyTarball('@kernlang/core', '5.0.0');
  const pkgJson = readPackageJsonFromTarball(tarball, tarLimits);
  assert.equal(pkgJson.name, '@kernlang/core');
  assert.equal(pkgJson.version, '5.0.0');

  // Truncated header
  assert.throws(
    () => readPackageJsonFromTarball(Buffer.alloc(100), tarLimits),
    /decompression|Truncated|header/i,
  );

  // Duplicate package.json
  const dupTarball = createDuplicateTarball('@kernlang/core', '5.0.0');
  assert.throws(
    () => readPackageJsonFromTarball(dupTarball, tarLimits),
    /Duplicate package\/package.json/,
  );

  // Missing package.json
  const missingTar = zlib.gzipSync(Buffer.alloc(1024));
  assert.throws(
    () => readPackageJsonFromTarball(missingTar, tarLimits),
    /Missing package\/package.json/,
  );
});

test('packArtifacts sequential execution and validation of scripts', async () => {
  setupTestDir();

  const outDir = path.join(tmpTestDir, 'artifacts');
  const mockCommandRunner = async (file, args, { cwd }) => {
    assert.equal(file, 'pnpm');
    assert.equal(cwd, tmpTestDir);
    // Determine which package is being packed
    let name = '@kernlang/core';
    let tarballName = 'kernlang-core-5.0.0.tgz';
    let extra = {};
    if (args.includes('packages/compat')) {
      name = 'kern-lang';
      tarballName = 'kernlang-compat-5.0.0.tgz';
      extra = { dependencies: { '@kernlang/core': '5.0.0' } };
    }

    const tgzBytes = createDummyTarball(name, '5.0.0', extra);
    fs.writeFileSync(path.join(outDir, tarballName), tgzBytes);

    return JSON.stringify({ name, version: '5.0.0', filename: path.join(outDir, tarballName) });
  };

  const packedInfo = await packArtifacts({
    plan: mockPlan,
    outDir: 'artifacts',
    rootDir: tmpTestDir,
    runCommandFn: mockCommandRunner,
    limits: {
      ...tarLimits,
      maxTarballBytes: 1024 * 1024,
      commandTimeoutMs: 10_000,
    },
  });

  assert.equal(packedInfo.length, 2);
  assert.equal(packedInfo[0].name, '@kernlang/core');
  assert.equal(packedInfo[1].name, 'kern-lang');
  assert.equal(packedInfo[1].pkgJson.dependencies['@kernlang/core'], '5.0.0');

  // Test banned lifecycle script failure
  fs.writeFileSync(
    path.join(tmpTestDir, 'packages/core/package.json'),
    JSON.stringify({ name: '@kernlang/core', version: '5.0.0', scripts: { prepack: 'echo' } }),
  );
  await assert.rejects(
    () =>
      packArtifacts({
        plan: mockPlan,
        outDir: 'artifacts2',
        rootDir: tmpTestDir,
        runCommandFn: mockCommandRunner,
        limits: {
          ...tarLimits,
          maxTarballBytes: 1024 * 1024,
          commandTimeoutMs: 10_000,
        },
      }),
    /banned pack lifecycle/i,
  );

  cleanupTestDir();
});

test('stringifyCanonical ensures recursively sorted JSON keys and correct format', () => {
  const value = {
    c: 3,
    a: {
      y: 'y',
      x: 'x',
    },
    b: [2, 1],
  };

  const expected = '{\n  "a": {\n    "x": "x",\n    "y": "y"\n  },\n  "b": [\n    2,\n    1\n  ],\n  "c": 3\n}\n';
  assert.equal(stringifyCanonical(value), expected);
});
