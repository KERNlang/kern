import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { constructManifest } from './artifact-manifest.mjs';
import { createReleaseBundle, deriveBundleName, validateReleaseBundle } from './bundle.mjs';
import { contentDigestFor, validateDurabilityReceipt } from './durability.mjs';
import { verifyOfflineConsumer } from './offline-consumer.mjs';
import {
  deriveSnapshotName,
  deriveStagingTag,
  preparePromotionSnapshot,
  promoteRegistryTags,
  validatePromotionSnapshot,
} from './promotion.mjs';
import { reconcileRegistryVersions } from './registry-metadata.mjs';
import { runRegistrySmoke } from './registry-smoke.mjs';

export { deriveStagingTag } from './promotion.mjs';

export async function checkRegistryForExistingVersions({ plan, registryClient }) {
  for (const pkg of plan.packages) {
    if (await registryClient.getVersion(pkg.name, plan.version)) return true;
  }
  return false;
}

async function validatedBundle({ plan, policy, bundleDir, rootDir, requireReceipt, journal }) {
  const verified = await validateReleaseBundle({ bundleDir, plan, policy });
  if (requireReceipt) {
    await validateDurabilityReceipt({
      rootDir,
      kind: 'bundle',
      artifactName: deriveBundleName({ plan, policy }),
      contentPath: path.join(bundleDir, 'release-bundle.json'),
      plan,
    });
  }
  await journal.setBundleDigest(await contentDigestFor({
    kind: 'bundle',
    contentPath: path.join(bundleDir, 'release-bundle.json'),
  }));
  return verified;
}

async function packBundle({ plan, policy, bundleDir, tarballDir, rootDir, packArtifactsFn, journal }) {
  const packedInfo = await packArtifactsFn({
    plan,
    outDir: path.relative(rootDir, tarballDir) || '.release/artifacts',
    rootDir,
    limits: policy.artifacts,
  });
  const manifest = constructManifest({ plan, packedInfo });
  await createReleaseBundle({ plan, manifest, tarballDir, bundleDir, policy });
  return validatedBundle({ plan, policy, bundleDir, rootDir, requireReceipt: false, journal });
}

async function verifyBundleOffline({ verified, bundleDir, rootDir, policy }) {
  await verifyOfflineConsumer({
    manifest: verified.manifest,
    outDir: path.relative(rootDir, path.join(bundleDir, 'artifacts')),
    rootDir,
    limits: policy.artifacts,
    safeBins: policy.artifacts.safeBins,
    consumerBuiltDependencies: policy.artifacts.consumerBuiltDependencies,
    importSmokeExclusions: policy.artifacts.importSmokeExclusions,
  });
}

async function loadLocalSnapshot({ rootDir, plan, policy, manifestSha512 }) {
  const artifactName = deriveSnapshotName(plan);
  const snapshotPath = path.join(rootDir, '.release', `${artifactName}.json`);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  validatePromotionSnapshot({ snapshot, plan, policy, manifestSha512 });
  await validateDurabilityReceipt({
    rootDir,
    kind: 'snapshot',
    artifactName,
    contentPath: snapshotPath,
    plan,
  });
  return snapshot;
}

export async function runReleaseWorkflow({
  rootDir = process.cwd(),
  plan,
  policy,
  bundleDir,
  tarballDir,
  registryClient,
  artifactStore,
  clock,
  journal,
  packArtifactsFn,
  registrySmokeFn = runRegistrySmoke,
  mode,
}) {
  const bundleName = deriveBundleName({ plan, policy });
  if (mode === 'preflight') {
    const verified = await packBundle({
      plan,
      policy,
      bundleDir,
      tarballDir,
      rootDir,
      packArtifactsFn,
      journal,
    });
    await verifyBundleOffline({ verified, bundleDir, rootDir, policy });
    return { bundleName, created: true };
  }

  if (mode === 'publish-pack') {
    const recoveredDir = await artifactStore.recoverBundle({
      artifactName: bundleName,
      plan,
      bundleDir,
    });
    if (recoveredDir) {
      const recovered = await validatedBundle({
        plan,
        policy,
        bundleDir: recoveredDir,
        rootDir,
        requireReceipt: true,
        journal,
      });
      await verifyBundleOffline({ verified: recovered, bundleDir: recoveredDir, rootDir, policy });
      await journal.writeEvent({
        phase: 'recover-bundle',
        packageName: null,
        operation: 'recover',
        outcome: 'succeeded',
      });
      return { bundleName, created: false };
    }
    if (await checkRegistryForExistingVersions({ plan, registryClient })) {
      throw new Error('Registry contains release versions but the immutable current-run bundle is unavailable');
    }
    const packed = await packBundle({
      plan,
      policy,
      bundleDir,
      tarballDir,
      rootDir,
      packArtifactsFn,
      journal,
    });
    await verifyBundleOffline({ verified: packed, bundleDir, rootDir, policy });
    await journal.writeEvent({
      phase: 'create-bundle',
      packageName: null,
      operation: 'create',
      outcome: 'succeeded',
    });
    return { bundleName, created: true };
  }

  const verified = await validatedBundle({
    plan,
    policy,
    bundleDir,
    rootDir,
    requireReceipt: true,
    journal,
  });
  if (mode === 'publish-reconcile') {
    await reconcileRegistryVersions({
      plan,
      manifest: verified.manifest,
      bundleDir,
      registryClient,
      clock,
      journal,
      policy,
      stagingTag: deriveStagingTag({ plan, policy }),
    });
    return { bundleName };
  }

  if (mode === 'publish-snapshot') {
    const result = await preparePromotionSnapshot({
      plan,
      policy,
      manifestSha512: verified.bundle.artifactManifestSha512,
      registryClient,
      artifactStore,
    });
    return result;
  }

  if (mode === 'publish-promote') {
    const snapshot = await loadLocalSnapshot({
      rootDir,
      plan,
      policy,
      manifestSha512: verified.bundle.artifactManifestSha512,
    });
    await promoteRegistryTags({
      plan,
      policy,
      manifestSha512: verified.bundle.artifactManifestSha512,
      snapshot,
      registryClient,
      clock,
      journal,
    });
    return { bundleName };
  }

  if (mode === 'publish-smoke') {
    await registrySmokeFn({
      rootDir,
      plan,
      manifest: verified.manifest,
      policy,
      registryClient,
    });
    await journal.writeEvent({
      phase: 'smoke-test',
      packageName: null,
      operation: 'run-smoke',
      outcome: 'succeeded',
    });
    await journal.setFinalState('succeeded');
    return { bundleName };
  }

  throw new Error(`Unsupported release workflow mode: ${mode}`);
}
