import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { normalizeExportsAndBin, stringifyCanonical } from './artifact-types.mjs';
import { verifyInstalledConsumer } from './offline-consumer.mjs';
import { assertRegistryMetadata } from './registry-metadata.mjs';

const execFileAsync = promisify(execFile);

function installedPackageJson(tempDir, packageName) {
  return path.join(tempDir, 'node_modules', ...packageName.split('/'), 'package.json');
}

async function verifyInstalledVersions(tempDir, expected) {
  for (const [packageName, version] of expected) {
    const packageJson = JSON.parse(await readFile(installedPackageJson(tempDir, packageName), 'utf8'));
    if (packageJson.name !== packageName || packageJson.version !== version) {
      throw new Error(`Registry smoke installed unexpected ${packageName} version ${packageJson.version}`);
    }
  }
}

function safeLabel(value) {
  return value.replace(/^@/, 'scope-').replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function installInCleanDirectory({ rootDir, label, dependencies, policy, runCommandFn }) {
  const tempDir = path.join(rootDir, '.release', `registry-smoke-${label}`);
  await rm(tempDir, { recursive: true, force: true });
  await mkdir(tempDir, { recursive: true });
  await writeFile(
    path.join(tempDir, 'package.json'),
    stringifyCanonical({ name: `kern-registry-smoke-${label}`, private: true, dependencies }),
  );
  try {
    await runCommandFn(
      policy.registry.clientCommand,
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        `--registry=${policy.registry.url}`,
      ],
      {
        cwd: tempDir,
        timeout: policy.artifacts.commandTimeoutMs,
        maxBuffer: policy.artifacts.maxCommandOutputBytes,
      },
    );
    return tempDir;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

export async function runRegistrySmoke({
  rootDir,
  plan,
  manifest,
  policy,
  registryClient,
  runCommandFn = execFileAsync,
}) {
  const manifestByName = new Map(manifest.packages.map((pkg) => [pkg.name, pkg]));
  for (const pkg of plan.packages) {
    const manifestPackage = manifestByName.get(pkg.name);
    const registryInfo = await registryClient.getVersion(pkg.name, plan.version);
    if (registryInfo === null) {
      throw new Error(`Registry smoke cannot read ${pkg.name}@${plan.version}`);
    }
    assertRegistryMetadata({ registryInfo, manifestPackage, plan });
    const tags = await registryClient.getDistTags(pkg.name);
    if (tags[plan.distTag] !== plan.version) {
      throw new Error(`Registry smoke found stale ${plan.distTag} tag for ${pkg.name}`);
    }
  }

  const exactDependencies = Object.fromEntries(
    plan.packages.map((pkg) => [pkg.name, plan.version]),
  );
  const exactDir = await installInCleanDirectory({
    rootDir,
    label: 'exact',
    dependencies: exactDependencies,
    policy,
    runCommandFn,
  });
  try {
    await verifyInstalledVersions(
      exactDir,
      plan.packages.map((pkg) => [pkg.name, plan.version]),
    );
    await verifyInstalledConsumer({
      manifest,
      tempDir: exactDir,
      limits: policy.artifacts,
      safeBins: policy.artifacts.safeBins,
      importSmokeExclusions: policy.artifacts.importSmokeExclusions,
      runCommandFn,
    });
  } finally {
    await rm(exactDir, { recursive: true, force: true });
  }

  const channelDir = await installInCleanDirectory({
    rootDir,
    label: 'channel',
    dependencies: { 'kern-lang': plan.distTag },
    policy,
    runCommandFn,
  });
  try {
    await verifyInstalledVersions(channelDir, [['kern-lang', plan.version]]);
    await verifyInstalledConsumer({
      manifest: { ...manifest, packages: manifest.packages.filter((pkg) => pkg.name === 'kern-lang') },
      tempDir: channelDir,
      limits: policy.artifacts,
      safeBins: policy.artifacts.safeBins,
      importSmokeExclusions: policy.artifacts.importSmokeExclusions.filter((name) => name === 'kern-lang'),
      runCommandFn,
    });
  } finally {
    await rm(channelDir, { recursive: true, force: true });
  }
}

export async function runRestoredEntrySmoke({
  rootDir,
  plan,
  snapshot,
  policy,
  registryClient,
  runCommandFn = execFileAsync,
}) {
  const planNames = new Set(plan.packages.map((pkg) => pkg.name));
  const results = [];
  for (const packageName of policy.recovery.entryPackageNames) {
    if (!Object.hasOwn(snapshot.priorTags, packageName)) {
      throw new Error(`Promotion snapshot is missing recovery entry ${packageName}`);
    }
    const expectedVersion = snapshot.priorTags[packageName];
    const tags = await registryClient.getDistTags(packageName);
    if (expectedVersion === null) {
      if (Object.hasOwn(tags, plan.distTag)) {
        throw new Error(`Restored entry tag ${packageName}@${plan.distTag} should be absent`);
      }
      results.push({ packageName, version: null, verified: 'tag-absent' });
      continue;
    }
    if (tags[plan.distTag] !== expectedVersion) {
      throw new Error(
        `Restored entry tag mismatch for ${packageName}: expected ${expectedVersion}, got ${tags[plan.distTag] ?? null}`,
      );
    }
    const registryInfo = await registryClient.getVersion(packageName, expectedVersion);
    if (!registryInfo || registryInfo.name !== packageName || registryInfo.version !== expectedVersion) {
      throw new Error(`Restored entry metadata is unavailable for ${packageName}@${expectedVersion}`);
    }
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dependencyName, dependencyVersion] of Object.entries(registryInfo[field] ?? {})) {
        if (planNames.has(dependencyName) && dependencyVersion !== expectedVersion) {
          throw new Error(
            `Restored entry ${packageName} does not exactly pin ${dependencyName}@${expectedVersion}`,
          );
        }
      }
    }

    const tempDir = await installInCleanDirectory({
      rootDir,
      label: `restored-${safeLabel(packageName)}`,
      dependencies: { [packageName]: plan.distTag },
      policy,
      runCommandFn,
    });
    try {
      await verifyInstalledVersions(tempDir, [[packageName, expectedVersion]]);
      const installed = JSON.parse(await readFile(installedPackageJson(tempDir, packageName), 'utf8'));
      const normalized = normalizeExportsAndBin(installed, packageName);
      await verifyInstalledConsumer({
        manifest: {
          packages: [{
            name: packageName,
            exports: normalized.exports,
            bin: normalized.bin,
          }],
        },
        tempDir,
        limits: policy.artifacts,
        safeBins: policy.artifacts.safeBins,
        importSmokeExclusions: policy.artifacts.importSmokeExclusions.filter(
          (excludedName) => excludedName === packageName,
        ),
        runCommandFn,
      });
      results.push({ packageName, version: expectedVersion, verified: 'clean-install' });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
  return results;
}
