import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { DefaultArtifactStore } from './artifact-store.mjs';
import { validateDurabilityReceipt, writeDurabilityReceipt } from './durability.mjs';
import { parseCliArgs } from './registry-cli.mjs';
import { plan, policy } from './registry-test-fixtures.mjs';

function artifact(overrides = {}) {
  return {
    id: 123,
    name: 'bundle-name',
    expired: false,
    size_in_bytes: 100,
    digest: `sha256:${'a'.repeat(64)}`,
    workflow_run: { id: 42, head_sha: plan.sha },
    ...overrides,
  };
}

function store(fetchFn, overrides = {}) {
  return new DefaultArtifactStore({
    rootDir: overrides.rootDir ?? process.cwd(),
    token: 'token',
    runId: '42',
    repo: 'KERNlang/kern',
    limits: policy.bundle,
    fetchFn,
    runCommandFn: overrides.runCommandFn,
  });
}

test('artifact lookup distinguishes absent artifacts from unsafe or failed recovery', async (t) => {
  await t.test('absent', async () => {
    const client = store(async () => ({ ok: true, json: async () => ({ artifacts: [] }) }));
    assert.equal(await client.findCurrentRunArtifact('bundle-name', plan.sha), null);
  });
  await t.test('API error fails closed', async () => {
    const client = store(async () => ({ ok: false, status: 503 }));
    await assert.rejects(client.findCurrentRunArtifact('bundle-name', plan.sha), /HTTP 503/i);
  });
  await t.test('duplicate exact names fail closed', async () => {
    const client = store(async () => ({ ok: true, json: async () => ({ artifacts: [artifact(), artifact({ id: 124 })] }) }));
    await assert.rejects(client.findCurrentRunArtifact('bundle-name', plan.sha), /Duplicate/i);
  });
  for (const [label, mutation, pattern] of [
    ['expired', { expired: true }, /expired/i],
    ['wrong SHA', { workflow_run: { id: 42, head_sha: 'f'.repeat(40) } }, /provenance/i],
    ['wrong run', { workflow_run: { id: 41, head_sha: plan.sha } }, /provenance/i],
    ['oversized', { size_in_bytes: policy.bundle.maxArchiveBytes + 1 }, /exceeds/i],
    ['bad digest', { digest: 'sha256:nope' }, /invalid digest/i],
    ['missing digest', { digest: undefined }, /invalid digest/i],
  ]) {
    await t.test(label, async () => {
      const client = store(async () => ({ ok: true, json: async () => ({ artifacts: [artifact(mutation)] }) }));
      await assert.rejects(client.findCurrentRunArtifact('bundle-name', plan.sha), pattern);
    });
  }
});

test('artifact extraction rejects traversal and configured extracted-size overflow', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kern-artifact-extract-'));
  const archiveResponse = async () => new Response('fake zip', { status: 200 });
  try {
    await t.test('traversal entry', async () => {
      const client = store(archiveResponse, {
        rootDir: root,
        runCommandFn: async (_file, argv) => {
          if (argv[0] === '-Z1') return { stdout: '../escape\n' };
          throw new Error('extract should not run');
        },
      });
      await assert.rejects(
        client.downloadArtifact(artifact({ digest: undefined }), path.join(root, 'bundle')),
        /unsafe entry/i,
      );
    });
    await t.test('expanded size overflow', async () => {
      const client = store(archiveResponse, {
        rootDir: root,
        runCommandFn: async (_file, argv) => {
          if (argv[0] === '-Z1') return { stdout: 'release-bundle.json\n' };
          if (argv[0] === '-l') return { stdout: `${policy.bundle.maxExtractedBytes + 1} 1 file\n` };
          throw new Error('extract should not run');
        },
      });
      await assert.rejects(
        client.downloadArtifact(artifact({ digest: undefined }), path.join(root, 'bundle')),
        /extracted size exceeds/i,
      );
    });
    await t.test('duplicate entry path', async () => {
      const client = store(archiveResponse, {
        rootDir: root,
        runCommandFn: async (_file, argv) => {
          if (argv[0] === '-Z1') return { stdout: 'same.json\nsame.json\n' };
          throw new Error('extract should not run');
        },
      });
      await assert.rejects(
        client.downloadArtifact(artifact({ digest: undefined }), path.join(root, 'bundle')),
        /duplicate entry paths/i,
      );
    });
    await t.test('symlink entry', async () => {
      const client = store(archiveResponse, {
        rootDir: root,
        runCommandFn: async (_file, argv) => {
          if (argv[0] === '-Z1') return { stdout: 'link\n' };
          if (argv[0] === '-l') return { stdout: '4 1 file\n' };
          if (argv[0] === '-Z' && argv[1] === '-l') {
            return { stdout: 'lrwxr-xr-x  3.0 unx 4 bx 4 stor 26-Jul-11 00:00 link\n' };
          }
          throw new Error('extract should not run');
        },
      });
      await assert.rejects(
        client.downloadArtifact(artifact({ digest: undefined }), path.join(root, 'bundle')),
        /non-file entry/i,
      );
    });
    await t.test('download digest mismatch', async () => {
      const client = store(archiveResponse, {
        rootDir: root,
        runCommandFn: async () => { throw new Error('unzip should not run'); },
      });
      await assert.rejects(
        client.downloadArtifact(artifact(), path.join(root, 'bundle')),
        /digest mismatch/i,
      );
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('durability receipt is content-bound and rejects malformed upload identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kern-receipt-test-'));
  try {
    await mkdir(path.join(root, '.release'));
    const contentPath = path.join(root, 'content.json');
    await writeFile(contentPath, '{"ok":true}\n');
    const options = {
      rootDir: root,
      kind: 'bundle',
      artifactName: 'bundle-name',
      artifactId: '123',
      artifactDigest: `sha256:${'a'.repeat(64)}`,
      contentPath,
      plan,
      source: 'uploaded',
    };
    await writeDurabilityReceipt(options);
    await validateDurabilityReceipt({
      rootDir: root,
      kind: 'bundle',
      artifactName: 'bundle-name',
      contentPath,
      plan,
    });
    await writeFile(contentPath, '{"ok":false}\n');
    await assert.rejects(
      validateDurabilityReceipt({ rootDir: root, kind: 'bundle', artifactName: 'bundle-name', contentPath, plan }),
      /does not match/i,
    );
    await assert.rejects(writeDurabilityReceipt({ ...options, artifactId: '0' }), /artifact id/i);
    await assert.rejects(writeDurabilityReceipt({ ...options, artifactDigest: 'sha256:nope' }), /artifact digest/i);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('registry CLI exposes only explicit release phases and guards confirmations', () => {
  const base = ['--channel', 'stable', '--version', '5.0.0', '--sha', plan.sha];
  assert.equal(parseCliArgs(['--mode', 'publish-reconcile', ...base]).mode, 'publish-reconcile');
  assert.throws(() => parseCliArgs(['--mode', 'publish', ...base]), /invalid/i);
  assert.throws(() => parseCliArgs(['--mode', 'confirm-bundle', ...base]), /require --artifact-id/i);
  assert.equal(
    parseCliArgs([
      '--mode', 'confirm-bundle',
      ...base,
      '--artifact-id', '123',
      '--artifact-digest', 'a'.repeat(64),
    ]).artifactId,
    '123',
  );
});
