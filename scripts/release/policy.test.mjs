import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveReleaseIntent,
  validateReleasePolicy,
} from './policy.mjs';

const policy = {
  schemaVersion: 1,
  packageRoots: ['packages'],
  artifacts: {
    maxTarballBytes: 268435456,
    maxUnpackedBytes: 536870912,
    maxPackageJsonBytes: 1048576,
    maxCommandOutputBytes: 16777216,
    commandTimeoutMs: 600000,
    smokeTimeoutMs: 5000,
    safeBins: ['kern'],
    consumerBuiltDependencies: [
      'esbuild',
      'sharp',
      'tree-sitter',
      'tree-sitter-python',
      'unrs-resolver',
    ],
    importSmokeExclusions: ['@kernlang/mcp-server'],
  },
  channels: {
    stable: {
      versionMode: 'stable-input',
      distTag: 'latest',
      syncDev: true,
    },
    canary: {
      versionMode: 'canary-run',
      baseVersion: '5.0.0',
      prereleaseId: 'canary',
      distTag: 'canary',
      syncDev: false,
    },
  },
};

const sha = '0123456789abcdef0123456789abcdef01234567';

test('stable intent preserves plain SemVer and makes latest explicit', () => {
  const intent = resolveReleaseIntent({
    policy,
    channel: 'stable',
    version: '4.5.0',
    sha,
  });

  assert.deepEqual(intent, {
    channel: 'stable',
    version: '4.5.0',
    distTag: 'latest',
    syncsDev: true,
  });
});

test('canary intent uses configured KERN 5 base and deterministic run/SHA suffix', () => {
  const intent = resolveReleaseIntent({
    policy,
    channel: 'canary',
    runNumber: '27',
    sha,
  });

  assert.deepEqual(intent, {
    channel: 'canary',
    version: '5.0.0-canary.27.g01234567',
    distTag: 'canary',
    syncsDev: false,
  });
});

for (const version of [
  'v4.5.0',
  '4.5',
  '4.5.0-rc.1',
  '04.5.0',
  '4.05.0',
  '4.5.00',
  '4.5.0+build',
  ' 4.5.0',
  '4.5.0 ',
  '4.5.0\n',
  '4.5.0garbage',
]) {
  test(`stable intent rejects ${version}`, () => {
    assert.throws(
      () => resolveReleaseIntent({ policy, channel: 'stable', version, sha }),
      /stable|SemVer|version/i,
    );
  });
}

test('unknown channel fails closed', () => {
  assert.throws(
    () => resolveReleaseIntent({ policy, channel: 'nightly', version: '4.5.0', sha }),
    /unknown channel/i,
  );
});

test('invalid SHA and canary run number fail closed', () => {
  for (const invalidSha of [
    'main',
    `${sha}0`,
    `0${sha}`,
    sha.toUpperCase(),
    `${sha.slice(0, -1)}g`,
    ` ${sha}`,
    `${sha}\n`,
  ]) {
    assert.throws(
      () =>
        resolveReleaseIntent({
          policy,
          channel: 'stable',
          version: '4.5.0',
          sha: invalidSha,
        }),
      /sha/i,
    );
  }
  assert.throws(
    () => resolveReleaseIntent({ policy, channel: 'canary', runNumber: '0', sha }),
    /run number/i,
  );
  assert.throws(
    () => resolveReleaseIntent({ policy, channel: 'canary', runNumber: '1.5', sha }),
    /run number/i,
  );
});

test('identical canary inputs deliberately resolve to one resumable version', () => {
  const input = { policy, channel: 'canary', runNumber: '27', sha };
  assert.deepEqual(resolveReleaseIntent(input), resolveReleaseIntent(input));
});

test('channel modes reject irrelevant version inputs instead of ignoring them', () => {
  assert.throws(
    () =>
      resolveReleaseIntent({
        policy,
        channel: 'stable',
        version: '4.5.0',
        runNumber: '27',
        sha,
      }),
    /run number/i,
  );
  assert.throws(
    () =>
      resolveReleaseIntent({
        policy,
        channel: 'canary',
        version: '9.9.9',
        runNumber: '27',
        sha,
      }),
    /version/i,
  );
});

test('prerelease channels can never map to latest or sync dev', () => {
  const latestCanary = structuredClone(policy);
  latestCanary.channels.canary.distTag = 'latest';
  assert.throws(() => validateReleasePolicy(latestCanary), /latest/i);

  const syncingCanary = structuredClone(policy);
  syncingCanary.channels.canary.syncDev = true;
  assert.throws(() => validateReleasePolicy(syncingCanary), /sync/i);

  const missingSync = structuredClone(policy);
  delete missingSync.channels.canary.syncDev;
  assert.throws(() => validateReleasePolicy(missingSync), /sync/i);
});

test('stable policy must make latest explicit and sync dev', () => {
  const missingTag = structuredClone(policy);
  delete missingTag.channels.stable.distTag;
  assert.throws(() => validateReleasePolicy(missingTag), /dist-tag/i);

  const noSync = structuredClone(policy);
  noSync.channels.stable.syncDev = false;
  assert.throws(() => validateReleasePolicy(noSync), /sync/i);
});

test('policy rejects unsafe or duplicate package roots', () => {
  const traversal = structuredClone(policy);
  traversal.packageRoots = ['../packages'];
  assert.throws(() => validateReleasePolicy(traversal), /package root/i);

  const duplicate = structuredClone(policy);
  duplicate.packageRoots = ['packages', 'packages'];
  assert.throws(() => validateReleasePolicy(duplicate), /duplicate/i);

  const empty = structuredClone(policy);
  empty.packageRoots = [];
  assert.throws(() => validateReleasePolicy(empty), /package root/i);
});

test('policy validates artifact resource limits and safe-bin allowlist', () => {
  const cases = [
    ['missing artifacts', (copy) => delete copy.artifacts],
    ['zero tarball limit', (copy) => (copy.artifacts.maxTarballBytes = 0)],
    ['fractional timeout', (copy) => (copy.artifacts.commandTimeoutMs = 1.5)],
    ['zero command output limit', (copy) => (copy.artifacts.maxCommandOutputBytes = 0)],
    [
      'package metadata limit above unpacked limit',
      (copy) => (copy.artifacts.maxPackageJsonBytes = copy.artifacts.maxUnpackedBytes + 1),
    ],
    ['unsafe bin', (copy) => (copy.artifacts.safeBins = ['kern;publish'])],
    ['duplicate bin', (copy) => (copy.artifacts.safeBins = ['kern', 'kern'])],
    [
      'unsafe built dependency',
      (copy) => (copy.artifacts.consumerBuiltDependencies = ['tree-sitter;publish']),
    ],
    [
      'duplicate built dependency',
      (copy) => (copy.artifacts.consumerBuiltDependencies = ['tree-sitter', 'tree-sitter']),
    ],
    [
      'unsafe import exclusion',
      (copy) => (copy.artifacts.importSmokeExclusions = ['@kernlang/mcp-server;publish']),
    ],
    [
      'duplicate import exclusion',
      (copy) =>
        (copy.artifacts.importSmokeExclusions = [
          '@kernlang/mcp-server',
          '@kernlang/mcp-server',
        ]),
    ],
  ];
  for (const [name, mutate] of cases) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(
      () => validateReleasePolicy(copy),
      /artifact|limit|integer|safeBins|bin|duplicate/i,
      `policy accepted ${name}`,
    );
  }
});

test('policy validates channel modes, tags, and canary version components', () => {
  const invalidCases = [
    ['unsupported mode', (copy) => (copy.channels.canary.versionMode = 'script')],
    ['non-boolean sync', (copy) => (copy.channels.canary.syncDev = 'false')],
    ['unsafe tag', (copy) => (copy.channels.canary.distTag = 'canary\nlatest')],
    ['SemVer tag', (copy) => (copy.channels.canary.distTag = '5.0.0')],
    ['invalid base', (copy) => (copy.channels.canary.baseVersion = 'v5.0.0')],
    ['prerelease base', (copy) => (copy.channels.canary.baseVersion = '5.0.0-rc.1')],
    ['invalid prerelease id', (copy) => (copy.channels.canary.prereleaseId = 'canary.rc')],
  ];

  for (const [name, mutate] of invalidCases) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(
      () => validateReleasePolicy(copy),
      /mode|sync|tag|version|base|prerelease/i,
      `policy accepted ${name}`,
    );
  }
});
