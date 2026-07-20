import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import test from 'node:test';

import { deriveStagingTag } from './promotion.mjs';
import { containFailedRelease } from './recovery.mjs';
import {
  clock,
  createDurableBundle,
  createTestEnv,
  FakeJournal,
  FakeRegistryClient,
  plan,
  policy,
} from './registry-test-fixtures.mjs';

function seedFailedRelease(registry, manifest, stagingTag) {
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
      [plan.distTag]: plan.version,
    });
  }
}

test('expanded recovery deprecation message is bounded before the first mutation', async () => {
  const env = await createTestEnv();
  try {
    const bundle = await createDurableBundle(env);
    const registry = new FakeRegistryClient(env.manifest);
    const boundedPolicy = structuredClone(policy);
    boundedPolicy.recovery.deprecationMessage = '{version}{sourceSha}';
    boundedPolicy.artifacts.maxCommandOutputBytes = 44;
    const stagingTag = deriveStagingTag({ plan, policy: boundedPolicy });
    seedFailedRelease(registry, env.manifest, stagingTag);
    const snapshot = {
      schemaVersion: 1,
      sha: plan.sha,
      version: plan.version,
      channel: plan.channel,
      distTag: plan.distTag,
      stagingTag,
      artifactManifestSha512: bundle.artifactManifestSha512,
      priorTags: Object.fromEntries(plan.packages.map((pkg) => [pkg.name, '4.5.0'])),
    };

    await assert.rejects(
      containFailedRelease({
        rootDir: env.root,
        plan,
        policy: boundedPolicy,
        manifest: env.manifest,
        snapshot,
        registryClient: registry,
        clock,
        journal: new FakeJournal(),
        restoredSmokeFn: async () => [],
      }),
      /Deprecation message exceeds configured limit/i,
    );
    assert.equal(registry.mutationTrace.length, 0);
  } finally {
    await rm(env.root, { recursive: true, force: true });
  }
});
