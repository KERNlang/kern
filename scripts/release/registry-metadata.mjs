import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { normalizeExportsAndBin } from './artifact-types.mjs';

function registryInternalDependencies(registryInfo, planNames) {
  const result = [];
  for (const [field, kind] of [
    ['dependencies', 'dependency'],
    ['optionalDependencies', 'optionalDependency'],
  ]) {
    const dependencies = registryInfo[field] ?? {};
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      throw new Error(`Registry ${field} must be an object`);
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (planNames.has(name)) result.push({ name, kind, version });
    }
  }
  return result.sort((left, right) =>
    left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
}

export function assertRegistryMetadata({ registryInfo, manifestPackage, plan }) {
  if (!registryInfo || typeof registryInfo !== 'object' || Array.isArray(registryInfo)) {
    throw new Error(`Registry metadata is invalid for ${manifestPackage.name}@${plan.version}`);
  }
  const planNames = new Set(plan.packages.map((pkg) => pkg.name));
  const expectedDependencies = [...manifestPackage.internalRuntimeDependencies].sort((left, right) =>
    left.name.localeCompare(right.name) || left.kind.localeCompare(right.kind));
  const actualDependencies = registryInternalDependencies(registryInfo, planNames);
  const normalized = normalizeExportsAndBin(registryInfo, manifestPackage.name);
  const checks = {
    name: registryInfo.name === manifestPackage.name,
    version: registryInfo.version === plan.version,
    integrity: registryInfo.dist?.integrity === manifestPackage.integrity,
    dependencies: isDeepStrictEqual(actualDependencies, expectedDependencies),
    exports: isDeepStrictEqual(normalized.exports, manifestPackage.exports),
    bin: isDeepStrictEqual(normalized.bin, manifestPackage.bin),
  };
  const failures = Object.entries(checks).filter(([, matches]) => !matches).map(([name]) => name);
  if (failures.length > 0) {
    throw new Error(
      `Registry metadata mismatch for ${manifestPackage.name}@${plan.version}: ${failures.join(', ')}`,
    );
  }
}

async function poll({ attempts, delayMs, clock, read, accept, failureMessage }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const value = await read();
    if (accept(value)) return value;
    if (attempt < attempts) await clock.sleep(delayMs);
  }
  throw new Error(failureMessage);
}

export async function reconcileRegistryVersions({
  plan,
  manifest,
  bundleDir,
  registryClient,
  clock,
  journal,
  policy,
  stagingTag,
}) {
  const manifestByName = new Map(manifest.packages.map((pkg) => [pkg.name, pkg]));
  for (const plannedPackage of plan.packages) {
    const pkg = manifestByName.get(plannedPackage.name);
    if (!pkg) throw new Error(`Manifest is missing planned package ${plannedPackage.name}`);
    const phase = 'reconcile-version';
    await journal.writeEvent({
      phase,
      packageName: pkg.name,
      operation: 'check-registry',
      outcome: 'started',
    });
    let registryInfo = await registryClient.getVersion(pkg.name, plan.version);
    if (registryInfo === null) {
      await journal.writeEvent({
        phase,
        packageName: pkg.name,
        operation: 'publish-tarball',
        outcome: 'started',
      });
      const tarballPath = path.resolve(bundleDir, 'artifacts', pkg.tarball);
      const artifactRoot = path.resolve(bundleDir, 'artifacts');
      if (path.dirname(tarballPath) !== artifactRoot) {
        throw new Error(`Manifest tarball path escapes bundle: ${pkg.tarball}`);
      }
      await registryClient.publishTarball(tarballPath, stagingTag);
      registryInfo = await poll({
        attempts: policy.retry.attempts,
        delayMs: policy.retry.delayMs,
        clock,
        read: () => registryClient.getVersion(pkg.name, plan.version),
        accept: (value) => value !== null,
        failureMessage: `Package ${pkg.name}@${plan.version} is not readable after publish`,
      });
      assertRegistryMetadata({ registryInfo, manifestPackage: pkg, plan });
      await journal.writeEvent({
        phase,
        packageName: pkg.name,
        operation: 'publish-tarball',
        outcome: 'succeeded',
      });
    } else {
      assertRegistryMetadata({ registryInfo, manifestPackage: pkg, plan });
      await journal.writeEvent({
        phase,
        packageName: pkg.name,
        operation: 'validate-metadata',
        outcome: 'succeeded',
      });
    }

    const tags = await registryClient.getDistTags(pkg.name);
    if (tags[stagingTag] !== plan.version) {
      await registryClient.setDistTag(pkg.name, plan.version, stagingTag);
      await poll({
        attempts: policy.retry.attempts,
        delayMs: policy.retry.delayMs,
        clock,
        read: () => registryClient.getDistTags(pkg.name),
        accept: (current) => current[stagingTag] === plan.version,
        failureMessage: `Staging tag verification failed for ${pkg.name}`,
      });
    }
  }
}
