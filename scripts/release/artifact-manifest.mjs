import { normalizeExportsAndBin } from './artifact-types.mjs';

const SHA512_HEX_RE = /^[0-9a-f]{128}$/;
const TARBALL_NAME_RE = /^[a-z0-9][a-z0-9._-]*\.tgz$/;

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label}`);
  }
}

function assertDigest(packed) {
  if (!SHA512_HEX_RE.test(packed.sha512)) {
    throw new Error(`Invalid SHA-512 hex digest for ${packed.name}`);
  }
  const expectedIntegrity = `sha512-${Buffer.from(packed.sha512, 'hex').toString('base64')}`;
  if (packed.integrity !== expectedIntegrity) {
    throw new Error(`Integrity does not match SHA-512 digest for ${packed.name}`);
  }
}

function internalRuntimeDependencies(pkgJson, planNames, expectedVersion, ownerName) {
  const dependencies = pkgJson.dependencies ?? {};
  const optionalDependencies = pkgJson.optionalDependencies ?? {};
  for (const [label, value] of [
    ['dependencies', dependencies],
    ['optionalDependencies', optionalDependencies],
  ]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Packed ${label} for ${ownerName} must be an object`);
    }
  }

  const result = [];
  for (const [name, version] of Object.entries(dependencies)) {
    if (!planNames.has(name) || Object.hasOwn(optionalDependencies, name)) continue;
    if (version !== expectedVersion) {
      throw new Error(
        `Internal runtime dependency ${name} of ${ownerName} must be pinned to exact version ${expectedVersion} (got ${version})`,
      );
    }
    result.push({ name, kind: 'dependency', version });
  }
  for (const [name, version] of Object.entries(optionalDependencies)) {
    if (!planNames.has(name)) continue;
    if (version !== expectedVersion) {
      throw new Error(
        `Internal runtime dependency ${name} of ${ownerName} must be pinned to exact version ${expectedVersion} (got ${version})`,
      );
    }
    result.push({ name, kind: 'optionalDependency', version });
  }
  return [...result].sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
}

export function constructManifest({ plan, packedInfo }) {
  if (!Array.isArray(plan?.packages) || !Array.isArray(packedInfo)) {
    throw new Error('Plan packages and packed artifacts must be arrays');
  }
  const planNames = plan.packages.map((pkg) => pkg.name);
  const planNameSet = new Set(planNames);
  assertUnique(planNames, 'package names in release plan');
  if (!planNameSet.has('kern-lang')) {
    throw new Error('Release plan must include kern-lang');
  }
  if (packedInfo.length !== plan.packages.length) {
    throw new Error(
      `Artifact count mismatch: expected ${plan.packages.length}, found ${packedInfo.length}`,
    );
  }
  assertUnique(
    packedInfo.map((packed) => packed.name),
    'packages in packed artifacts',
  );
  assertUnique(
    packedInfo.map((packed) => packed.tarball),
    'tarball filenames in packed artifacts',
  );

  const packages = plan.packages.map((planPackage, index) => {
    const packed = packedInfo[index];
    if (packed.name !== planPackage.name) {
      throw new Error(
        `Packed artifact order/name mismatch at index ${index}: expected ${planPackage.name}, got ${packed.name}`,
      );
    }
    if (packed.pkgJson?.name !== planPackage.name) {
      throw new Error(
        `Packed package name mismatch for ${planPackage.name}: got ${packed.pkgJson?.name}`,
      );
    }
    if (packed.pkgJson.private === true) {
      throw new Error(`Package ${planPackage.name} is private and cannot be released`);
    }
    if (packed.version !== plan.version || packed.pkgJson.version !== plan.version) {
      throw new Error(
        `Version mismatch for ${planPackage.name}: expected ${plan.version}, got ${packed.pkgJson.version}`,
      );
    }
    if (!Number.isSafeInteger(packed.size) || packed.size <= 0) {
      throw new Error(`Invalid tarball size for ${planPackage.name}`);
    }
    if (typeof packed.tarball !== 'string' || !TARBALL_NAME_RE.test(packed.tarball)) {
      throw new Error(`Unsafe tarball filename for ${planPackage.name}: ${packed.tarball}`);
    }
    assertDigest(packed);

    const runtimeDependencies = internalRuntimeDependencies(
      packed.pkgJson,
      planNameSet,
      plan.version,
      planPackage.name,
    );
    const expectedDependencies = [...planPackage.dependencies].sort();
    const actualDependencies = runtimeDependencies.map((dependency) => dependency.name).sort();
    if (JSON.stringify(actualDependencies) !== JSON.stringify(expectedDependencies)) {
      throw new Error(
        `Internal dependency set mismatch for ${planPackage.name}: expected ${expectedDependencies.join(', ') || '<none>'}, got ${actualDependencies.join(', ') || '<none>'}`,
      );
    }

    const { exports, bin } = normalizeExportsAndBin(packed.pkgJson, planPackage.name);
    return {
      name: planPackage.name,
      path: planPackage.path,
      version: plan.version,
      tarball: packed.tarball,
      size: packed.size,
      sha512: packed.sha512,
      integrity: packed.integrity,
      internalRuntimeDependencies: runtimeDependencies,
      exports,
      bin,
    };
  });

  return {
    schemaVersion: 1,
    releasePlan: {
      planVersion: plan.planVersion,
      sha: plan.sha,
      channel: plan.channel,
      version: plan.version,
      distTag: plan.distTag,
    },
    packages,
  };
}
