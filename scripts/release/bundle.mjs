import { isDeepStrictEqual } from 'node:util';
import { readFile, writeFile, mkdir, copyFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { constructManifest } from './artifact-manifest.mjs';
import { stringifyCanonical } from './artifact-types.mjs';
import { readPackageJsonFromTarball } from './tar-entry.mjs';
import { validateReleasePlan } from './plan.mjs';

function sha512Hex(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('hex');
}

export function deriveBundleName({ plan, policy }) {
  const name = `${policy.bundle.namePrefix}-${plan.sha}-${plan.version}`;
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.length > policy.bundle.maxNameLength) {
    throw new Error(`Unsafe release bundle name: ${name}`);
  }
  return name;
}

function jsonBytes(value) {
  return Buffer.from(stringifyCanonical(value), 'utf8');
}

async function assertRegularFile(filePath, label) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`);
  }
}

async function assertDirectory(dirPath, label) {
  const info = await lstat(dirPath);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} is not a directory`);
  }
}

export async function createReleaseBundle({ plan, manifest, tarballDir, bundleDir, policy }) {
  validateReleasePlan(plan, policy);
  const bundleName = deriveBundleName({ plan, policy });

  await mkdir(bundleDir, { recursive: true });
  const existingEntries = await readdir(bundleDir);
  if (existingEntries.length !== 0) {
    throw new Error(`Refusing to create release bundle in non-empty directory: ${bundleDir}`);
  }
  const artifactsDir = path.join(bundleDir, 'artifacts');
  await mkdir(artifactsDir);

  const reconstructed = constructManifest({
    plan,
    packedInfo: await Promise.all(manifest.packages.map(async (pkg) => {
      const sourcePath = path.resolve(tarballDir, pkg.tarball);
      if (path.dirname(sourcePath) !== path.resolve(tarballDir)) {
        throw new Error(`Tarball path escapes artifact directory: ${pkg.tarball}`);
      }
      await assertRegularFile(sourcePath, `Tarball ${pkg.tarball}`);
      const bytes = await readFile(sourcePath);
      const pkgJson = readPackageJsonFromTarball(bytes, policy.artifacts);
      const sha512 = sha512Hex(bytes);
      return {
        name: pkg.name,
        version: pkg.version,
        tarball: pkg.tarball,
        size: bytes.length,
        sha512,
        integrity: `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`,
        pkgJson,
      };
    })),
  });
  if (!isDeepStrictEqual(reconstructed, manifest)) {
    throw new Error('Artifact manifest does not match source tarball bytes');
  }

  // 1. Write release-plan.json
  const planBuf = jsonBytes(plan);
  await writeFile(path.join(bundleDir, 'release-plan.json'), planBuf);

  // 2. Write artifact-manifest.json
  const manifestBuf = jsonBytes(manifest);
  await writeFile(path.join(bundleDir, 'artifact-manifest.json'), manifestBuf);

  // 3. Copy tarballs
  for (const pkg of manifest.packages) {
    const src = path.join(tarballDir, pkg.tarball);
    const dest = path.join(artifactsDir, pkg.tarball);
    await copyFile(src, dest);
  }

  // 4. Create release-bundle.json
  const bundle = {
    schemaVersion: 1,
    sha: plan.sha,
    channel: plan.channel,
    version: plan.version,
    bundleName,
    releasePlanSha512: sha512Hex(planBuf),
    artifactManifestSha512: sha512Hex(manifestBuf),
    packageCount: plan.packages.length,
  };

  await writeFile(path.join(bundleDir, 'release-bundle.json'), jsonBytes(bundle));
  return bundle;
}

export async function validateReleaseBundle({ bundleDir, plan, policy }) {
  validateReleasePlan(plan, policy);
  const bundleName = deriveBundleName({ plan, policy });

  // Verify directory contains exactly the expected files
  await assertDirectory(bundleDir, 'Bundle path');
  const rootEntries = await readdir(bundleDir);
  const expectedRootFiles = new Set([
    'release-bundle.json',
    'release-plan.json',
    'artifact-manifest.json',
    'artifacts',
  ]);

  for (const entry of rootEntries) {
    if (!expectedRootFiles.has(entry)) {
      throw new Error(`Bundle directory contains unexpected file: ${entry}`);
    }
  }
  for (const entry of expectedRootFiles) {
    if (!rootEntries.includes(entry)) {
      throw new Error(`Bundle directory is missing required entry: ${entry}`);
    }
  }

  await assertRegularFile(path.join(bundleDir, 'release-bundle.json'), 'release-bundle.json');
  await assertRegularFile(path.join(bundleDir, 'release-plan.json'), 'release-plan.json');
  await assertRegularFile(path.join(bundleDir, 'artifact-manifest.json'), 'artifact-manifest.json');
  await assertDirectory(path.join(bundleDir, 'artifacts'), 'artifacts');

  const bundlePath = path.join(bundleDir, 'release-bundle.json');
  const bundleContent = await readFile(bundlePath, 'utf8');
  const bundle = JSON.parse(bundleContent);

  if (bundle.schemaVersion !== 1) {
    throw new Error(`Unsupported bundle schema version: ${bundle.schemaVersion}`);
  }
  if (bundle.sha !== plan.sha) {
    throw new Error(`Bundle SHA mismatch: expected ${plan.sha}, got ${bundle.sha}`);
  }
  if (bundle.channel !== plan.channel) {
    throw new Error(`Bundle channel mismatch: expected ${plan.channel}, got ${bundle.channel}`);
  }
  if (bundle.version !== plan.version) {
    throw new Error(`Bundle version mismatch: expected ${plan.version}, got ${bundle.version}`);
  }
  if (bundle.bundleName !== bundleName) {
    throw new Error(`Bundle name mismatch: expected ${bundleName}, got ${bundle.bundleName}`);
  }
  if (bundle.packageCount !== plan.packages.length) {
    throw new Error(`Bundle package count mismatch: expected ${plan.packages.length}, got ${bundle.packageCount}`);
  }

  // Verify release-plan.json
  const planPath = path.join(bundleDir, 'release-plan.json');
  const planContentBuf = await readFile(planPath);
  if (sha512Hex(planContentBuf) !== bundle.releasePlanSha512) {
    throw new Error('release-plan.json SHA-512 mismatch');
  }
  const storedPlan = JSON.parse(planContentBuf.toString('utf8'));
  if (!isDeepStrictEqual(storedPlan, plan)) {
    throw new Error('release-plan.json content does not match current plan');
  }

  // Verify artifact-manifest.json
  const manifestPath = path.join(bundleDir, 'artifact-manifest.json');
  const manifestContentBuf = await readFile(manifestPath);
  if (sha512Hex(manifestContentBuf) !== bundle.artifactManifestSha512) {
    throw new Error('artifact-manifest.json SHA-512 mismatch');
  }
  const storedManifest = JSON.parse(manifestContentBuf.toString('utf8'));
  if (!Array.isArray(storedManifest.packages)) {
    throw new Error('Stored artifact manifest packages must be an array');
  }

  // Verify artifacts directory exists and contains exactly the expected tarballs
  const artifactsDir = path.join(bundleDir, 'artifacts');
  const artifactEntries = await readdir(artifactsDir);
  const expectedTarballs = new Set(storedManifest.packages.map((p) => p.tarball));
  if (expectedTarballs.size !== storedManifest.packages.length) {
    throw new Error('Stored artifact manifest contains duplicate tarball filenames');
  }
  if (artifactEntries.length !== expectedTarballs.size) {
    throw new Error('Artifacts directory does not contain the exact manifest tarball set');
  }

  for (const entry of artifactEntries) {
    if (!expectedTarballs.has(entry)) {
      throw new Error(`Artifacts directory contains unexpected file: ${entry}`);
    }
  }

  // Inspect each tarball and reconstruct manifest from bytes to compare
  const packedInfo = [];
  for (const plannedPkg of plan.packages) {
    const manifestPkg = storedManifest.packages.find((p) => p.name === plannedPkg.name);
    if (!manifestPkg) {
      throw new Error(`Package ${plannedPkg.name} is missing from stored manifest`);
    }

    const tarballPath = path.join(artifactsDir, manifestPkg.tarball);
    const tarballStat = await lstat(tarballPath);
    if (!tarballStat.isFile() || tarballStat.isSymbolicLink()) {
      throw new Error(`Packed tarball is not a regular file: ${tarballPath}`);
    }
    if (tarballStat.size !== manifestPkg.size) {
      throw new Error(`Size mismatch for ${plannedPkg.name} tarball`);
    }

    const tarballBytes = await readFile(tarballPath);
    const sha512 = sha512Hex(tarballBytes);
    if (sha512 !== manifestPkg.sha512) {
      throw new Error(`Digest mismatch for ${plannedPkg.name} tarball`);
    }

    const expectedIntegrity = `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`;
    if (manifestPkg.integrity !== expectedIntegrity) {
      throw new Error(`Integrity format mismatch for ${plannedPkg.name}`);
    }

    // Read package.json from tarball and extract its metadata to reconstruct packedInfo
    const pkgJson = readPackageJsonFromTarball(tarballBytes, policy.artifacts);

    packedInfo.push({
      name: plannedPkg.name,
      version: pkgJson.version,
      tarball: manifestPkg.tarball,
      size: tarballBytes.length,
      sha512,
      integrity: expectedIntegrity,
      pkgJson,
    });
  }

  // Re-run manifest reconstruction from tarball bytes
  const reconstructedManifest = constructManifest({ plan, packedInfo });
  if (!isDeepStrictEqual(reconstructedManifest, storedManifest)) {
    throw new Error('Reconstructed manifest does not match stored manifest');
  }

  return {
    bundle,
    plan: storedPlan,
    manifest: storedManifest,
  };
}
