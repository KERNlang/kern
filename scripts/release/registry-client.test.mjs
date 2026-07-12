import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { DefaultRegistryClient } from './registry-client.mjs';
import { createTestEnv, policy } from './registry-test-fixtures.mjs';

function client(overrides = {}) {
  return new DefaultRegistryClient({
    registryUrl: policy.registry.url,
    timeoutMs: policy.registry.timeoutMs,
    mutationTimeoutMs: policy.registry.mutationTimeoutMs,
    maxOutputBytes: policy.artifacts.maxCommandOutputBytes,
    clientCommand: policy.registry.clientCommand,
    provenanceMode: policy.provenance.mode,
    ...overrides,
  });
}

test('registry reads distinguish 404 and enforce bounded JSON responses', async () => {
  const missing = client({ fetchFn: async () => new Response('', { status: 404 }) });
  assert.equal(await missing.getVersion('@kernlang/core', '5.0.0'), null);
  const oversized = client({
    maxOutputBytes: 4,
    fetchFn: async () => new Response('{"value":true}', { status: 200 }),
  });
  await assert.rejects(oversized.getDistTags('kern-lang'), /exceeds configured limit/i);
});

test('registry mutations use argv execution, configured limits, and exact tarballs', async () => {
  const env = await createTestEnv();
  try {
    const calls = [];
    const registry = client({
      runCommandFn: async (file, argv, options) => { calls.push({ file, argv, options }); },
    });
    const tarball = `${env.tarballDir}/${env.manifest.packages[0].tarball}`;
    await registry.publishTarball(tarball, 'kern-stage-5.0.0-g01234567');
    await registry.setDistTag('@kernlang/core', '5.0.0', 'latest');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].file, policy.registry.clientCommand);
    assert.deepEqual(calls[0].argv.slice(0, 2), ['publish', tarball]);
    assert.equal(calls[0].argv.includes('--provenance'), false);
    assert.equal(calls[0].options.maxBuffer, policy.artifacts.maxCommandOutputBytes);
    await assert.rejects(registry.publishTarball('relative.tgz', 'stage'), /absolute .tgz/i);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('required provenance is explicit in npm publish argv', async () => {
  const env = await createTestEnv();
  try {
    let argv;
    const registry = client({
      provenanceMode: 'required',
      runCommandFn: async (_file, args) => { argv = args; },
    });
    await registry.publishTarball(
      `${env.tarballDir}/${env.manifest.packages[0].tarball}`,
      'kern-stage-5.0.0-g01234567',
    );
    assert.ok(argv.includes('--provenance'));
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('recovery mutations use exact argv with configured execution bounds', async () => {
  const calls = [];
  const registry = client({
    runCommandFn: async (file, argv, options) => {
      calls.push({ file, argv, options });
    },
  });
  const version = '5.0.0-canary.42.g01234567';
  const message =
    `KERN release ${version} from 0123456789abcdef0123456789abcdef01234567 failed post-promotion smoke.`;

  await registry.removeDistTag('@kernlang/cli', 'latest');
  await registry.deprecateVersion('@kernlang/cli', version, message);

  assert.deepEqual(calls, [
    {
      file: policy.registry.clientCommand,
      argv: [
        'dist-tag',
        'rm',
        '@kernlang/cli',
        'latest',
        '--registry',
        policy.registry.url,
      ],
      options: {
        timeout: policy.registry.mutationTimeoutMs,
        maxBuffer: policy.artifacts.maxCommandOutputBytes,
      },
    },
    {
      file: policy.registry.clientCommand,
      argv: [
        'deprecate',
        `@kernlang/cli@${version}`,
        message,
        '--registry',
        policy.registry.url,
      ],
      options: {
        timeout: policy.registry.mutationTimeoutMs,
        maxBuffer: policy.artifacts.maxCommandOutputBytes,
      },
    },
  ]);
});

test('recovery mutation inputs reject unsafe or unbounded argv before execution', async () => {
  let calls = 0;
  const registry = client({
    maxOutputBytes: 64,
    runCommandFn: async () => {
      calls += 1;
    },
  });

  await assert.rejects(registry.removeDistTag('bad package', 'latest'), /package name/i);
  await assert.rejects(registry.removeDistTag('@kernlang/cli', 'latest --force'), /dist-tag/i);
  await assert.rejects(registry.setDistTag('bad package', '5.0.0', 'latest'), /package name/i);
  await assert.rejects(registry.setDistTag('@kernlang/cli', 'latest', 'latest'), /semver/i);
  await assert.rejects(registry.setDistTag('@kernlang/cli', '5.0.0', 'latest --force'), /dist-tag/i);
  await assert.rejects(registry.deprecateVersion('@kernlang/cli', 'latest', 'failed release'), /semver/i);
  await assert.rejects(registry.deprecateVersion('@kernlang/cli', '5.0.0', ''), /message/i);
  await assert.rejects(registry.deprecateVersion('@kernlang/cli', '5.0.0', 'bad\nmessage'), /message/i);
  await assert.rejects(registry.deprecateVersion('@kernlang/cli', '5.0.0', 'x'.repeat(65)), /limit/i);

  assert.equal(calls, 0);
});
