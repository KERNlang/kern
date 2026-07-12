import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { writeDurabilityReceipt } from './durability.mjs';
import {
  deriveSnapshotName,
  deriveStagingTag,
  preparePromotionSnapshot,
  validatePromotionSnapshot,
} from './promotion.mjs';
import { runReleaseWorkflow } from './registry-reconciler.mjs';
import {
  clock,
  createDurableBundle,
  createTestEnv,
  FakeArtifactStore,
  FakeJournal,
  FakeRegistryClient,
  plan,
  policy,
} from './registry-test-fixtures.mjs';

function args(env, registry, artifactStore, journal = new FakeJournal()) {
  return {
    rootDir: env.root,
    plan,
    policy,
    bundleDir: env.bundleDir,
    tarballDir: env.tarballDir,
    registryClient: registry,
    artifactStore,
    clock,
    journal,
    packArtifactsFn: env.packFn,
  };
}

function seedStaging(registry) {
  const stagingTag = deriveStagingTag({ plan, policy });
  for (const pkg of plan.packages) registry.tags.set(pkg.name, { [stagingTag]: plan.version, latest: '4.5.0' });
}

async function prepareDurableSnapshot(env, registry, artifactStore) {
  const result = await runReleaseWorkflow({
    ...args(env, registry, artifactStore),
    mode: 'publish-snapshot',
  });
  const snapshotPath = path.join(env.root, '.release', `${result.artifactName}.json`);
  await writeDurabilityReceipt({
    rootDir: env.root,
    kind: 'snapshot',
    artifactName: result.artifactName,
    artifactId: '456',
    artifactDigest: `sha256:${'b'.repeat(64)}`,
    contentPath: snapshotPath,
    plan,
    source: 'uploaded',
  });
  return result;
}

test('promotion snapshot requires every staging tag and binds the manifest digest', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const store = new FakeArtifactStore(env.root);
    await assert.rejects(
      runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-snapshot' }),
      /staging tag verification/i,
    );
    seedStaging(registry);
    const result = await runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-snapshot' });
    assert.equal(result.snapshot.artifactManifestSha512, bundle.artifactManifestSha512);
    assert.deepEqual(Object.keys(result.snapshot.priorTags).sort(), plan.packages.map((pkg) => pkg.name).sort());
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('promotion snapshot cannot be recreated after a public tag has moved', async () => {
  const env = await createTestEnv();
  try {
    const registry = new FakeRegistryClient(env.manifest);
    const store = new FakeArtifactStore(env.root);
    seedStaging(registry);
    registry.tags.set('@kernlang/core', {
      ...registry.tags.get('@kernlang/core'),
      [plan.distTag]: plan.version,
    });
    await assert.rejects(
      preparePromotionSnapshot({
        plan,
        policy,
        manifestSha512: 'a'.repeat(128),
        registryClient: registry,
        artifactStore: store,
      }),
      /after public promotion.*recover the durable snapshot/i,
    );
    assert.equal(store.snapshots.size, 0);
    assert.equal(registry.mutationTrace.length, 0);
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('public tags cannot move without the matching durable snapshot receipt', async () => {
  const env = await createTestEnv();
  try {
    await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const store = new FakeArtifactStore(env.root);
    seedStaging(registry);
    await runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-snapshot' });
    await assert.rejects(
      runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-promote' }),
      /snapshot durability receipt/i,
    );
    assert.equal(registry.calls.filter((call) => call.method === 'setDistTag').length, 0);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('promotion is resumable, interference-safe, and moves kern-lang last', async (t) => {
  await t.test('root marker last', async () => {
    const env = await createTestEnv();
    try {
      await createDurableBundle(env);
      const registry = new FakeRegistryClient(env.manifest);
      const store = new FakeArtifactStore(env.root);
      seedStaging(registry);
      await prepareDurableSnapshot(env, registry, store);
      await runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-promote' });
      const publicMoves = registry.calls.filter((call) => call.method === 'setDistTag' && call.tag === plan.distTag);
      assert.deepEqual(publicMoves.map((call) => call.name), ['@kernlang/core', 'kern-lang']);
      await runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-promote' });
      assert.equal(registry.calls.filter((call) => call.method === 'setDistTag' && call.tag === plan.distTag).length, 2);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
  await t.test('external interference', async () => {
    const env = await createTestEnv();
    try {
      await createDurableBundle(env);
      const registry = new FakeRegistryClient(env.manifest);
      const store = new FakeArtifactStore(env.root);
      seedStaging(registry);
      await prepareDurableSnapshot(env, registry, store);
      registry.tags.set('@kernlang/core', {
        ...registry.tags.get('@kernlang/core'),
        latest: '4.6.0',
      });
      await assert.rejects(
        runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-promote' }),
        /External interference/i,
      );
      assert.equal(registry.calls.filter((call) => call.method === 'setDistTag').length, 0);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
  await t.test('staging tag moved after snapshot', async () => {
    const env = await createTestEnv();
    try {
      await createDurableBundle(env);
      const registry = new FakeRegistryClient(env.manifest);
      const store = new FakeArtifactStore(env.root);
      seedStaging(registry);
      await prepareDurableSnapshot(env, registry, store);
      const stagingTag = deriveStagingTag({ plan, policy });
      registry.tags.set('@kernlang/core', {
        ...registry.tags.get('@kernlang/core'),
        [stagingTag]: '4.5.0',
      });
      await assert.rejects(
        runReleaseWorkflow({ ...args(env, registry, store), mode: 'publish-promote' }),
        /Staging tag interference/i,
      );
      assert.equal(registry.calls.filter((call) => call.method === 'setDistTag').length, 0);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
});

test('smoke success and final success are recorded only after the real smoke callback', async (t) => {
  await t.test('failure', async () => {
    const env = await createTestEnv();
    try {
      await createDurableBundle(env);
      const journal = new FakeJournal();
      await assert.rejects(
        runReleaseWorkflow({
          ...args(env, new FakeRegistryClient(env.manifest), new FakeArtifactStore(env.root), journal),
          mode: 'publish-smoke',
          registrySmokeFn: async () => { throw new Error('clean install failed'); },
        }),
        /clean install failed/i,
      );
      assert.equal(journal.events.some((event) => event.phase === 'smoke-test' && event.outcome === 'succeeded'), false);
      assert.equal(journal.finalState, undefined);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
  await t.test('success', async () => {
    const env = await createTestEnv();
    try {
      await createDurableBundle(env);
      const journal = new FakeJournal();
      await runReleaseWorkflow({
        ...args(env, new FakeRegistryClient(env.manifest), new FakeArtifactStore(env.root), journal),
        mode: 'publish-smoke',
        registrySmokeFn: async () => {},
      });
      assert.equal(journal.finalState, 'succeeded');
      assert.equal(journal.events.at(-1).phase, 'smoke-test');
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
});

test('snapshot identity includes source SHA and version', () => {
  assert.equal(deriveSnapshotName(plan), `promotion-snapshot-${plan.sha}-${plan.version}`);
});

test('promotion snapshot prior tags must be null or bounded exact SemVer', () => {
  const manifestSha512 = 'a'.repeat(128);
  const snapshot = {
    schemaVersion: 1,
    sha: plan.sha,
    version: plan.version,
    channel: plan.channel,
    distTag: plan.distTag,
    stagingTag: deriveStagingTag({ plan, policy }),
    artifactManifestSha512: manifestSha512,
    priorTags: Object.fromEntries(plan.packages.map((pkg) => [pkg.name, '4.5.0'])),
  };
  assert.doesNotThrow(() => validatePromotionSnapshot({ snapshot, plan, policy, manifestSha512 }));
  for (const invalid of ['latest --force', '^4.5.0', '4.5']) {
    const mutated = structuredClone(snapshot);
    mutated.priorTags['kern-lang'] = invalid;
    assert.throws(
      () => validatePromotionSnapshot({ snapshot: mutated, plan, policy, manifestSha512 }),
      /does not match/i,
    );
  }
  const boundedPolicy = structuredClone(policy);
  boundedPolicy.artifacts.maxCommandOutputBytes = 8;
  const oversized = structuredClone(snapshot);
  oversized.priorTags['kern-lang'] = '5.0.0-abc';
  assert.throws(
    () => validatePromotionSnapshot({
      snapshot: oversized,
      plan,
      policy: boundedPolicy,
      manifestSha512,
    }),
    /does not match/i,
  );
});
