import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { writeDurabilityReceipt } from './durability.mjs';
import { deriveSnapshotName, deriveStagingTag, preparePromotionSnapshot } from './promotion.mjs';
import { containFailedRelease, planFailedReleaseRecovery } from './recovery.mjs';
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

function seedRelease(registry, manifest, { prior = '4.5.0', publicVersion = plan.version } = {}) {
  const stagingTag = deriveStagingTag({ plan, policy });
  for (const pkg of manifest.packages) {
    registry.versions.set(`${pkg.name}@${plan.version}`, {
      name: pkg.name,
      version: plan.version,
      dist: { integrity: pkg.integrity },
      dependencies: Object.fromEntries(
        pkg.internalRuntimeDependencies.map((dependency) => [dependency.name, dependency.version]),
      ),
    });
    registry.tags.set(pkg.name, {
      [stagingTag]: plan.version,
      [plan.distTag]: publicVersion ?? prior,
    });
  }
}

function snapshotFor(manifestSha512, prior = '4.5.0') {
  return {
    schemaVersion: 1,
    sha: plan.sha,
    version: plan.version,
    channel: plan.channel,
    distTag: plan.distTag,
    stagingTag: deriveStagingTag({ plan, policy }),
    artifactManifestSha512: manifestSha512,
    priorTags: Object.fromEntries(plan.packages.map((pkg) => [pkg.name, prior])),
  };
}

test('failed release containment restores entries only, deprecates the graph, and is idempotent', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    seedRelease(registry, env.manifest);
    const snapshot = snapshotFor(bundle.artifactManifestSha512);
    const journal = new FakeJournal();
    const smokeCalls = [];
    const invoke = () => containFailedRelease({
      rootDir: env.root,
      plan,
      policy,
      manifest: env.manifest,
      snapshot,
      registryClient: registry,
      clock,
      journal,
      restoredSmokeFn: async (options) => {
        smokeCalls.push(options);
        assert.equal(registry.tags.get('kern-lang').latest, '4.5.0');
        return [{ packageName: 'kern-lang', version: '4.5.0' }];
      },
    });

    const first = await invoke();
    assert.equal(first.contained, true);
    assert.equal(registry.tags.get('@kernlang/core').latest, plan.version);
    assert.equal(registry.tags.get('kern-lang').latest, '4.5.0');
    for (const pkg of plan.packages) {
      assert.match(registry.versions.get(`${pkg.name}@${plan.version}`).deprecated, /5\.0\.0/);
    }
    const rootRestoreIndex = registry.mutationTrace.findIndex(
      (entry) =>
        entry.method === 'setDistTag' &&
        entry.name === 'kern-lang' &&
        entry.tag === plan.distTag &&
        entry.phase === 'applied',
    );
    const lastDeprecationIndex = registry.mutationTrace.findLastIndex(
      (entry) => entry.method === 'deprecateVersion' && entry.phase === 'applied',
    );
    assert.ok(lastDeprecationIndex >= 0 && lastDeprecationIndex < rootRestoreIndex);
    const effectiveMutations = registry.mutationTrace.filter((entry) => entry.phase === 'applied').length;
    await invoke();
    assert.equal(
      registry.mutationTrace.filter((entry) => entry.phase === 'applied').length,
      effectiveMutations,
    );
    assert.equal(smokeCalls.length, 2);
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('every configured entry package is restored while non-entry tags remain forward', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    seedRelease(registry, env.manifest);
    const entryPolicy = structuredClone(policy);
    entryPolicy.recovery.entryPackageNames = ['@kernlang/core', 'kern-lang'];
    await containFailedRelease({
      rootDir: env.root,
      plan,
      policy: entryPolicy,
      manifest: env.manifest,
      snapshot: snapshotFor(bundle.artifactManifestSha512),
      registryClient: registry,
      clock,
      journal: new FakeJournal(),
      restoredSmokeFn: async () => [],
    });
    assert.equal(registry.tags.get('@kernlang/core').latest, '4.5.0');
    assert.equal(registry.tags.get('kern-lang').latest, '4.5.0');
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('dry-run and external interference are mutation-free', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    seedRelease(registry, env.manifest);
    const snapshot = snapshotFor(bundle.artifactManifestSha512);
    const before = registry.mutationTrace.length;
    const result = await containFailedRelease({
      rootDir: env.root,
      plan,
      policy,
      manifest: env.manifest,
      snapshot,
      registryClient: registry,
      clock,
      journal: { writeEvent: async () => { throw new Error('must not write'); } },
      dryRun: true,
    });
    assert.equal(result.dryRun, true);
    assert.equal(result.actions.restorations.length, 1);
    assert.equal(registry.mutationTrace.length, before);

    registry.tags.set('@kernlang/core', {
      ...registry.tags.get('@kernlang/core'),
      latest: '6.0.0',
    });
    await assert.rejects(
      planFailedReleaseRecovery({
        plan,
        policy,
        manifest: env.manifest,
        snapshot,
        registryClient: registry,
      }),
      /external public-tag interference/i,
    );
    assert.equal(registry.mutationTrace.length, before);
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('manual containment cannot deprecate a forward-resumable pre-root release', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    seedRelease(registry, env.manifest);
    registry.tags.set('kern-lang', {
      ...registry.tags.get('kern-lang'),
      [plan.distTag]: '4.5.0',
    });
    const before = registry.mutationTrace.length;
    await assert.rejects(
      containFailedRelease({
        rootDir: env.root,
        plan,
        policy,
        manifest: env.manifest,
        snapshot: snapshotFor(bundle.artifactManifestSha512),
        registryClient: registry,
        clock,
        journal: new FakeJournal(),
        restoredSmokeFn: async () => [],
      }),
      /not authorized before the root marker/i,
    );
    assert.equal(registry.mutationTrace.length, before);
    for (const pkg of plan.packages) {
      assert.equal(registry.versions.get(`${pkg.name}@${plan.version}`).deprecated, undefined);
    }
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('null prior entry tags are removed and journal failure cannot block containment', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    seedRelease(registry, env.manifest);
    const snapshot = snapshotFor(bundle.artifactManifestSha512);
    snapshot.priorTags['kern-lang'] = null;
    await containFailedRelease({
      rootDir: env.root,
      plan,
      policy,
      manifest: env.manifest,
      snapshot,
      registryClient: registry,
      clock,
      journal: { writeEvent: async () => { throw new Error('disk full'); } },
      restoredSmokeFn: async () => {
        assert.equal(Object.hasOwn(registry.tags.get('kern-lang'), plan.distTag), false);
        return [];
      },
    });
    assert.equal(Object.hasOwn(registry.tags.get('kern-lang'), plan.distTag), false);
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('publish-recover requires durable artifacts and always leaves the release failed', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    seedRelease(registry, env.manifest, { publicVersion: '4.5.0' });
    const artifactStore = new FakeArtifactStore(env.root);
    const prepared = await preparePromotionSnapshot({
      plan,
      policy,
      manifestSha512: bundle.artifactManifestSha512,
      registryClient: registry,
      artifactStore,
    });
    const snapshotPath = path.join(env.root, '.release', `${deriveSnapshotName(plan)}.json`);
    await writeDurabilityReceipt({
      rootDir: env.root,
      kind: 'snapshot',
      artifactName: prepared.artifactName,
      artifactId: '456',
      artifactDigest: `sha256:${'b'.repeat(64)}`,
      contentPath: snapshotPath,
      plan,
      source: 'uploaded',
    });
    for (const pkg of plan.packages) {
      registry.tags.set(pkg.name, {
        ...registry.tags.get(pkg.name),
        [plan.distTag]: plan.version,
      });
    }
    await assert.rejects(
      runReleaseWorkflow({
        rootDir: env.root,
        plan,
        policy,
        bundleDir: env.bundleDir,
        tarballDir: env.tarballDir,
        registryClient: registry,
        artifactStore,
        clock,
        journal: new FakeJournal(),
        packArtifactsFn: env.packFn,
        restoredSmokeFn: async () => [],
        mode: 'publish-recover',
      }),
      /containment completed.*new version/i,
    );
    assert.equal(registry.tags.get('kern-lang').latest, '4.5.0');
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('containment resumes across before/after entry restoration and deprecation boundaries', async (t) => {
  const twoEntryPolicy = structuredClone(policy);
  twoEntryPolicy.recovery.entryPackageNames = ['@kernlang/core', 'kern-lang'];
  const cases = [
    { method: 'setDistTag', match: { name: 'kern-lang', tag: plan.distTag } },
    {
      method: 'setDistTag',
      match: { name: '@kernlang/core', tag: plan.distTag },
      policy: twoEntryPolicy,
    },
    ...plan.packages.map((pkg) => ({
      method: 'deprecateVersion',
      match: { name: pkg.name, version: plan.version },
    })),
  ];
  for (const testCase of cases) {
    for (const when of ['before', 'after-apply']) {
      await t.test(`${testCase.method}:${testCase.match.name}:${when}`, async () => {
        const env = await createTestEnv();
        try {
          const bundle = await createDurableBundle(env);
          const registry = new FakeRegistryClient(env.manifest);
          seedRelease(registry, env.manifest);
          const snapshot = snapshotFor(bundle.artifactManifestSha512);
          registry.failNextMutation({ method: testCase.method, when, match: testCase.match });
          const options = {
            rootDir: env.root,
            plan,
            policy: testCase.policy ?? policy,
            manifest: env.manifest,
            snapshot,
            registryClient: registry,
            clock,
            journal: new FakeJournal(),
            restoredSmokeFn: async () => [],
          };
          try {
            await containFailedRelease(options);
          } catch (error) {
            assert.match(error.message, /not observed|Injected before failure/i);
          }
          await containFailedRelease(options);
          assert.equal(registry.tags.get('kern-lang').latest, '4.5.0');
          assert.equal(
            registry.tags.get('@kernlang/core').latest,
            testCase.policy ? '4.5.0' : plan.version,
          );
          for (const pkg of plan.packages) {
            assert.match(
              registry.versions.get(`${pkg.name}@${plan.version}`).deprecated,
              /failed post-promotion smoke/i,
            );
          }
          assert.equal(
            registry.mutationTrace.filter(
              (entry) =>
                entry.method === testCase.method &&
                entry.phase === 'applied' &&
                Object.entries(testCase.match).every(([key, value]) => entry[key] === value),
            ).length,
            1,
          );
        } finally {
          await rm(env.root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('null-tag removal resumes across before/after application failures', async (t) => {
  for (const when of ['before', 'after-apply']) {
    await t.test(when, async () => {
      const env = await createTestEnv();
      try {
        const bundle = await createDurableBundle(env);
        const registry = new FakeRegistryClient(env.manifest);
        seedRelease(registry, env.manifest);
        const snapshot = snapshotFor(bundle.artifactManifestSha512);
        snapshot.priorTags['kern-lang'] = null;
        registry.failNextMutation({
          method: 'removeDistTag',
          when,
          match: { name: 'kern-lang', tag: plan.distTag },
        });
        const options = {
          rootDir: env.root,
          plan,
          policy,
          manifest: env.manifest,
          snapshot,
          registryClient: registry,
          clock,
          journal: new FakeJournal(),
          restoredSmokeFn: async () => [],
        };
        try {
          await containFailedRelease(options);
        } catch (error) {
          assert.match(error.message, /not observed|Injected before failure/i);
        }
        await containFailedRelease(options);
        assert.equal(Object.hasOwn(registry.tags.get('kern-lang'), plan.distTag), false);
        assert.equal(
          registry.mutationTrace.filter(
            (entry) => entry.method === 'removeDistTag' && entry.phase === 'applied',
          ).length,
          1,
        );
      } finally {
        await rm(env.root, { recursive: true, force: true });
      }
    });
  }
});

test('exact and channel smoke failures after the root marker both enter containment', async (t) => {
  for (const failure of ['exact install failed', 'channel install failed']) {
    await t.test(failure, async () => {
      const env = await createTestEnv();
      try {
        const bundle = await createDurableBundle(env);
        const registry = new FakeRegistryClient(env.manifest);
        seedRelease(registry, env.manifest, { publicVersion: '4.5.0' });
        const artifactStore = new FakeArtifactStore(env.root);
        const prepared = await preparePromotionSnapshot({
          plan,
          policy,
          manifestSha512: bundle.artifactManifestSha512,
          registryClient: registry,
          artifactStore,
        });
        const snapshotPath = path.join(env.root, '.release', `${deriveSnapshotName(plan)}.json`);
        await writeDurabilityReceipt({
          rootDir: env.root,
          kind: 'snapshot',
          artifactName: prepared.artifactName,
          artifactId: '987',
          artifactDigest: `sha256:${'d'.repeat(64)}`,
          contentPath: snapshotPath,
          plan,
          source: 'uploaded',
        });
        const base = {
          rootDir: env.root,
          plan,
          policy,
          bundleDir: env.bundleDir,
          tarballDir: env.tarballDir,
          registryClient: registry,
          artifactStore,
          clock,
          journal: new FakeJournal(),
          packArtifactsFn: env.packFn,
        };
        await runReleaseWorkflow({ ...base, mode: 'publish-promote' });
        assert.equal(registry.tags.get('kern-lang').latest, plan.version);
        await assert.rejects(
          runReleaseWorkflow({
            ...base,
            registrySmokeFn: async () => { throw new Error(failure); },
            mode: 'publish-smoke',
          }),
          new RegExp(failure),
        );
        assert.equal(registry.tags.get('kern-lang').latest, plan.version);
        await assert.rejects(
          runReleaseWorkflow({
            ...base,
            restoredSmokeFn: async () => [],
            mode: 'publish-recover',
          }),
          /containment completed/i,
        );
        assert.equal(registry.tags.get('kern-lang').latest, '4.5.0');
        assert.equal(registry.tags.get('@kernlang/core').latest, plan.version);
      } finally {
        await rm(env.root, { recursive: true, force: true });
      }
    });
  }
});
