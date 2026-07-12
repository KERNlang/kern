import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

/**
 * R0.4 observable mutation drills. Each ambiguity test reruns from live state
 * to prove forward idempotency, but also requires the original run to adopt an
 * exact after-apply result. That final assertion was RED against R0.3, whose
 * mutation calls were rethrown without a live-state reconciliation read.
 */

import { writeDurabilityReceipt } from './durability.mjs';
import { deriveStagingTag } from './promotion.mjs';
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

function workflowArgs(env, registry, artifactStore = new FakeArtifactStore(env.root), journal = new FakeJournal()) {
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

function matchingMetadata(pkg) {
  return {
    name: pkg.name,
    version: pkg.version,
    dist: { integrity: pkg.integrity },
    dependencies: Object.fromEntries(pkg.internalRuntimeDependencies.map((dep) => [dep.name, dep.version])),
  };
}

function seedMatchingVersions(registry, manifest) {
  for (const pkg of manifest.packages) {
    registry.versions.set(`${pkg.name}@${pkg.version}`, matchingMetadata(pkg));
  }
}

function seedStagingAndPriorPublicTags(registry) {
  const stagingTag = deriveStagingTag({ plan, policy });
  for (const pkg of plan.packages) {
    registry.tags.set(pkg.name, { [stagingTag]: plan.version, [plan.distTag]: '4.5.0' });
  }
}

async function prepareDurableSnapshot(env, registry, artifactStore) {
  const result = await runReleaseWorkflow({
    ...workflowArgs(env, registry, artifactStore),
    mode: 'publish-snapshot',
  });
  const snapshotPath = path.join(env.root, '.release', `${result.artifactName}.json`);
  await writeDurabilityReceipt({
    rootDir: env.root,
    kind: 'snapshot',
    artifactName: result.artifactName,
    artifactId: '789',
    artifactDigest: `sha256:${'c'.repeat(64)}`,
    contentPath: snapshotPath,
    plan,
    source: 'uploaded',
  });
}

async function captureFailure(promise) {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

function appliedMutations(registry, method, match = {}) {
  return registry.mutationTrace.filter(
    (entry) =>
      entry.source === 'client' &&
      entry.method === method &&
      entry.phase === 'applied' &&
      Object.entries(match).every(([key, value]) => entry[key] === value),
  );
}

function assertAmbiguousMutationWasReconciled(error, label) {
  assert.equal(
    error,
    null,
    `${label} applied successfully before the injected acknowledgment error; the same run must re-read exact live state instead of failing: ${error?.message}`,
  );
}

test('fake registry exposes ordered failpoints, stale reads, external interference, removal, and deprecation', async () => {
  const env = await createTestEnv();
  try {
    const registry = new FakeRegistryClient(env.manifest);
    const pkg = env.manifest.packages[0];
    const metadata = matchingMetadata(pkg);
    registry.setExternalVersion(pkg.name, pkg.version, metadata);
    registry.setExternalDistTag(pkg.name, 'latest', '4.5.0');

    registry.queueVersionReads(pkg.name, pkg.version, [null]);
    assert.equal(await registry.getVersion(pkg.name, pkg.version), null);
    assert.equal((await registry.getVersion(pkg.name, pkg.version)).dist.integrity, pkg.integrity);

    registry.queueDistTagReads(pkg.name, [{ latest: '4.4.0' }]);
    assert.deepEqual(await registry.getDistTags(pkg.name), { latest: '4.4.0' });
    assert.deepEqual(await registry.getDistTags(pkg.name), { latest: '4.5.0' });

    registry.failNextMutation({
      method: 'setDistTag',
      when: 'before',
      match: { name: pkg.name, tag: 'next' },
    });
    await assert.rejects(registry.setDistTag(pkg.name, pkg.version, 'next'), /Injected before failure/);
    assert.equal((await registry.getDistTags(pkg.name)).next, undefined);

    registry.failNextMutation({
      method: 'removeDistTag',
      when: 'after-apply',
      match: { name: pkg.name, tag: 'latest' },
    });
    await assert.rejects(registry.removeDistTag(pkg.name, 'latest'), /Injected after-apply failure/);
    assert.equal((await registry.getDistTags(pkg.name)).latest, undefined);

    await registry.deprecateVersion(pkg.name, pkg.version, 'failed release');
    assert.equal((await registry.getVersion(pkg.name, pkg.version)).deprecated, 'failed release');
    assert.deepEqual(
      registry.mutationTrace.map(({ source, method, phase }) => ({ source, method, phase })),
      [
        { source: 'external', method: 'setExternalVersion', phase: 'applied' },
        { source: 'external', method: 'setExternalDistTag', phase: 'applied' },
        { source: 'client', method: 'setDistTag', phase: 'attempted' },
        { source: 'client', method: 'setDistTag', phase: 'failed-before' },
        { source: 'client', method: 'removeDistTag', phase: 'attempted' },
        { source: 'client', method: 'removeDistTag', phase: 'applied' },
        { source: 'client', method: 'removeDistTag', phase: 'failed-after-apply' },
        { source: 'client', method: 'deprecateVersion', phase: 'attempted' },
        { source: 'client', method: 'deprecateVersion', phase: 'applied' },
        { source: 'client', method: 'deprecateVersion', phase: 'completed' },
      ],
    );
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('publish applied then errored is reconciled in-run and remains duplicate-free on resume', async () => {
  const env = await createTestEnv();
  try {
    await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const args = workflowArgs(env, registry);
    registry.failNextMutation({
      method: 'publishTarball',
      when: 'after-apply',
      match: { name: '@kernlang/core', version: plan.version },
    });
    registry.queueVersionReads('@kernlang/core', plan.version, [null, null]);

    const firstError = await captureFailure(runReleaseWorkflow({ ...args, mode: 'publish-reconcile' }));
    assert.ok(registry.versions.has(`@kernlang/core@${plan.version}`), 'failpoint must leave published bytes live');
    await runReleaseWorkflow({ ...args, mode: 'publish-reconcile' });

    assert.equal(appliedMutations(registry, 'publishTarball', { name: '@kernlang/core' }).length, 1);
    assert.equal(appliedMutations(registry, 'publishTarball').length, plan.packages.length);
    assertAmbiguousMutationWasReconciled(firstError, 'publishTarball');
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

test('staging tag applied then errored is reconciled in-run and remains duplicate-free on resume', async () => {
  const env = await createTestEnv();
  try {
    await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const args = workflowArgs(env, registry);
    const stagingTag = deriveStagingTag({ plan, policy });
    seedMatchingVersions(registry, env.manifest);
    registry.failNextMutation({
      method: 'setDistTag',
      when: 'after-apply',
      match: { name: '@kernlang/core', tag: stagingTag },
    });
    registry.queueDistTagReads('@kernlang/core', [{}, {}]);

    const firstError = await captureFailure(runReleaseWorkflow({ ...args, mode: 'publish-reconcile' }));
    assert.equal(registry.tags.get('@kernlang/core')[stagingTag], plan.version);
    await runReleaseWorkflow({ ...args, mode: 'publish-reconcile' });

    assert.equal(appliedMutations(registry, 'setDistTag', { name: '@kernlang/core', tag: stagingTag }).length, 1);
    assert.equal(appliedMutations(registry, 'setDistTag', { tag: stagingTag }).length, plan.packages.length);
    assertAmbiguousMutationWasReconciled(firstError, 'staging setDistTag');
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});

async function runPublicTagFailureDrill({ failedPackageName }) {
  const env = await createTestEnv();
  try {
    await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const artifactStore = new FakeArtifactStore(env.root);
    const journal = new FakeJournal();
    const args = workflowArgs(env, registry, artifactStore, journal);
    seedStagingAndPriorPublicTags(registry);
    await prepareDurableSnapshot(env, registry, artifactStore);
    registry.failNextMutation({
      method: 'setDistTag',
      when: 'after-apply',
      match: { name: failedPackageName, tag: plan.distTag, version: plan.version },
    });
    registry.queueDistTagReads(failedPackageName, [
      { ...registry.tags.get(failedPackageName) },
      { ...registry.tags.get(failedPackageName) },
    ]);

    const firstError = await captureFailure(runReleaseWorkflow({ ...args, mode: 'publish-promote' }));
    if (firstError && failedPackageName !== policy.promotion.rootPackageName) {
      assert.equal(
        registry.tags.get(policy.promotion.rootPackageName)[plan.distTag],
        '4.5.0',
        'root marker must remain prior while dependency promotion is unresolved',
      );
    }
    await runReleaseWorkflow({ ...args, mode: 'publish-promote' });

    const publicMoves = appliedMutations(registry, 'setDistTag', { tag: plan.distTag });
    assert.deepEqual(publicMoves.map((entry) => entry.name), ['@kernlang/core', 'kern-lang']);
    assert.equal(registry.tags.get('kern-lang')[plan.distTag], plan.version);
    assertAmbiguousMutationWasReconciled(firstError, `${failedPackageName} public setDistTag`);
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
}

test('dependency public tag applied then errored is reconciled before the root marker', async () => {
  await runPublicTagFailureDrill({ failedPackageName: '@kernlang/core' });
});

test('root marker applied then errored is reconciled in-run and remains duplicate-free on resume', async () => {
  await runPublicTagFailureDrill({ failedPackageName: 'kern-lang' });
});

test('before-apply failures remain forward-resumable at every publish and staging boundary', async (t) => {
  for (const method of ['publishTarball', 'setDistTag']) {
    for (const pkg of plan.packages) {
      await t.test(`${method}:${pkg.name}`, async () => {
        const env = await createTestEnv();
        try {
          await createDurableBundle(env);
          const registry = new FakeRegistryClient(env.manifest);
          const stagingTag = deriveStagingTag({ plan, policy });
          if (method === 'setDistTag') seedMatchingVersions(registry, env.manifest);
          registry.failNextMutation({
            method,
            when: 'before',
            match: method === 'publishTarball'
              ? { name: pkg.name, version: plan.version }
              : { name: pkg.name, tag: stagingTag },
          });
          await assert.rejects(
            runReleaseWorkflow({ ...workflowArgs(env, registry), mode: 'publish-reconcile' }),
            /Injected before failure|not observed/i,
          );
          await runReleaseWorkflow({ ...workflowArgs(env, registry), mode: 'publish-reconcile' });
          assert.equal(
            appliedMutations(registry, method, method === 'publishTarball'
              ? { name: pkg.name }
              : { name: pkg.name, tag: stagingTag }).length,
            1,
          );
        } finally {
          await rm(env.root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('before-apply failures remain forward-resumable at every public-tag boundary', async (t) => {
  for (const pkg of plan.packages) {
    await t.test(pkg.name, async () => {
      const env = await createTestEnv();
      try {
        await createDurableBundle(env);
        const registry = new FakeRegistryClient(env.manifest);
        const artifactStore = new FakeArtifactStore(env.root);
        seedStagingAndPriorPublicTags(registry);
        await prepareDurableSnapshot(env, registry, artifactStore);
        registry.failNextMutation({
          method: 'setDistTag',
          when: 'before',
          match: { name: pkg.name, tag: plan.distTag, version: plan.version },
        });
        await assert.rejects(
          runReleaseWorkflow({
            ...workflowArgs(env, registry, artifactStore),
            mode: 'publish-promote',
          }),
          /Injected before failure|not observed/i,
        );
        if (pkg.name !== policy.promotion.rootPackageName) {
          assert.equal(registry.tags.get(policy.promotion.rootPackageName).latest, '4.5.0');
        }
        await runReleaseWorkflow({
          ...workflowArgs(env, registry, artifactStore),
          mode: 'publish-promote',
        });
        assert.equal(appliedMutations(registry, 'setDistTag', { name: pkg.name, tag: plan.distTag }).length, 1);
      } finally {
        await rm(env.root, { recursive: true, force: true });
      }
    });
  }
});
