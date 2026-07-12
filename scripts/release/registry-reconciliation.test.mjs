import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { createReleaseBundle } from './bundle.mjs';
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

function workflowArgs(env, registryClient, journal = new FakeJournal()) {
  return {
    rootDir: env.root,
    plan,
    policy,
    bundleDir: env.bundleDir,
    tarballDir: env.tarballDir,
    registryClient,
    artifactStore: new FakeArtifactStore(env.root),
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

test('registry mutation is impossible without a matching durable bundle receipt', async () => {
  const env = await createTestEnv();
  try {
    await createReleaseBundle({ plan, manifest: env.manifest, tarballDir: env.tarballDir, bundleDir: env.bundleDir, policy });
    const registry = new FakeRegistryClient(env.manifest);
    await assert.rejects(
      runReleaseWorkflow({ ...workflowArgs(env, registry), mode: 'publish-reconcile' }),
      /durability receipt/i,
    );
    assert.equal(registry.calls.filter((call) => call.method === 'publishTarball' || call.method === 'setDistTag').length, 0);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('missing versions publish dependency-first and are fully revalidated', async () => {
  const env = await createTestEnv();
  try {
    await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const journal = new FakeJournal();
    await runReleaseWorkflow({ ...workflowArgs(env, registry, journal), mode: 'publish-reconcile' });
    const publishes = registry.calls.filter((call) => call.method === 'publishTarball');
    assert.deepEqual(publishes.map((call) => call.tarballPath.split('/').at(-1)), env.manifest.packages.map((pkg) => pkg.tarball));
    const stagingTag = deriveStagingTag({ plan, policy });
    assert.equal(registry.tags.get('@kernlang/core')[stagingTag], plan.version);
    assert.equal(registry.tags.get('kern-lang')[stagingTag], plan.version);
    assert.match(journal.bundleDigest, /^sha512:[0-9a-f]{128}$/);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('bad metadata after publish hard-stops before the next package', async () => {
  const env = await createTestEnv();
  try {
    await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    registry.afterPublish = ({ pkg, metadata }) => {
      if (pkg.name === '@kernlang/core') metadata.dist.integrity = 'sha512-conflict';
    };
    await assert.rejects(
      runReleaseWorkflow({ ...workflowArgs(env, registry), mode: 'publish-reconcile' }),
      /metadata mismatch/i,
    );
    assert.equal(registry.calls.filter((call) => call.method === 'publishTarball').length, 1);
    assert.equal(registry.calls.filter((call) => call.method === 'setDistTag').length, 0);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('matching versions are skipped and conflicting versions fail closed', async (t) => {
  await t.test('matching', async () => {
    const env = await createTestEnv();
    try {
      await createDurableBundle(env);
      const registry = new FakeRegistryClient(env.manifest);
      for (const pkg of env.manifest.packages) registry.versions.set(`${pkg.name}@${plan.version}`, matchingMetadata(pkg));
      await runReleaseWorkflow({ ...workflowArgs(env, registry), mode: 'publish-reconcile' });
      assert.equal(registry.calls.filter((call) => call.method === 'publishTarball').length, 0);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
  await t.test('conflicting', async () => {
    const env = await createTestEnv();
    try {
      await createDurableBundle(env);
      const registry = new FakeRegistryClient(env.manifest);
      registry.versions.set('@kernlang/core@5.0.0', {
        ...matchingMetadata(env.manifest.packages[0]),
        dist: { integrity: 'sha512-conflict' },
      });
      await assert.rejects(
        runReleaseWorkflow({ ...workflowArgs(env, registry), mode: 'publish-reconcile' }),
        /metadata mismatch/i,
      );
      assert.equal(registry.calls.filter((call) => call.method === 'publishTarball').length, 0);
    } finally { await rm(env.root, { recursive: true, force: true }); }
  });
});

test('partial publication resumes forward and journal history is never consulted', async () => {
  const env = await createTestEnv();
  try {
    await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const first = env.manifest.packages[0];
    registry.versions.set(`${first.name}@${plan.version}`, matchingMetadata(first));
    const historylessJournal = {
      writeEvent: async () => {},
      setFinalState: async () => {},
      setBundleDigest: async () => {},
    };
    await runReleaseWorkflow({
      ...workflowArgs(env, registry, historylessJournal),
      mode: 'publish-reconcile',
    });
    const publishes = registry.calls.filter((call) => call.method === 'publishTarball');
    assert.equal(publishes.length, 1);
    assert.match(publishes[0].tarballPath, /kern-lang-5\.0\.0\.tgz$/);
  } finally { await rm(env.root, { recursive: true, force: true }); }
});

test('bundle preparation refuses to repack after any registry version exists', async () => {
  const env = await createTestEnv();
  try {
    const registry = new FakeRegistryClient(env.manifest);
    registry.versions.set('@kernlang/core@5.0.0', matchingMetadata(env.manifest.packages[0]));
    await assert.rejects(
      runReleaseWorkflow({ ...workflowArgs(env, registry), mode: 'publish-pack' }),
      /immutable current-run bundle is unavailable/i,
    );
  } finally { await rm(env.root, { recursive: true, force: true }); }
});
