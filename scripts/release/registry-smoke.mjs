import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { stringifyCanonical } from './artifact-types.mjs';
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
