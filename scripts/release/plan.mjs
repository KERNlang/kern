import { discoverPublicPackageGraph } from './package-graph.mjs';
import { resolveReleaseIntent, validateReleasePolicy } from './policy.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function createReleasePlan({ rootDir, policy, channel, version, sha, runNumber }) {
  const intent = resolveReleaseIntent({ policy, channel, version, sha, runNumber });
  const packages = await discoverPublicPackageGraph({
    rootDir,
    packageRoots: policy.packageRoots,
  });

  const plan = {
    planVersion: 1,
    sha,
    channel: intent.channel,
    version: intent.version,
    distTag: intent.distTag,
    packages: packages.map((pkg) => ({
      name: pkg.name,
      path: pkg.path,
      dependencies: pkg.dependencies,
    })),
  };

  validateReleasePlan(plan, policy);
  return deepFreeze(plan);
}

export function validateReleasePlan(plan, policy) {
  validateReleasePolicy(policy);
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    throw new Error('Invalid plan object');
  }
  if (plan.planVersion !== 1) {
    throw new Error('Invalid plan version');
  }
  if (typeof plan.sha !== 'string' || !/^[0-9a-f]{40}$/.test(plan.sha)) {
    throw new Error('Invalid sha in release plan');
  }
  if (typeof plan.distTag !== 'string' || plan.distTag.length === 0) {
    throw new Error('Missing dist-tag');
  }

  const channelConfig = policy.channels[plan.channel];
  if (!channelConfig) {
    throw new Error(`Unknown channel: ${plan.channel}`);
  }
  if (plan.distTag !== channelConfig.distTag) {
    throw new Error(
      `Release plan dist-tag ${plan.distTag} does not match policy ${channelConfig.distTag}`,
    );
  }
  if (channelConfig.versionMode === 'stable-input') {
    const plainSemver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
    if (!plainSemver.test(plan.version)) {
      throw new Error(`Invalid stable version: ${plan.version}`);
    }
  } else if (channelConfig.versionMode === 'canary-run') {
    const pattern = new RegExp(
      `^${escapeRegex(channelConfig.baseVersion)}-${escapeRegex(channelConfig.prereleaseId)}\\.[1-9]\\d*\\.g[0-9a-f]{8}$`,
    );
    if (!pattern.test(plan.version)) {
      throw new Error(`Invalid canary version: ${plan.version}`);
    }
  }

  if (!Array.isArray(plan.packages)) {
    throw new Error('packages must be an array');
  }
  if (plan.packages.length !== policy.release.expectedPublicPackageCount) {
    throw new Error(
      `Public package count mismatch: expected ${policy.release.expectedPublicPackageCount}, found ${plan.packages.length}`,
    );
  }

  const seenPackages = new Set();
  const packageNames = new Set(plan.packages.map((pkg) => pkg?.name));

  for (const pkg of plan.packages) {
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
      throw new Error('Invalid package in release plan');
    }
    if (typeof pkg.name !== 'string' || pkg.name.length === 0) {
      throw new Error('Missing package name in release plan');
    }
    if (seenPackages.has(pkg.name)) {
      throw new Error(`Duplicate package in release plan: ${pkg.name}`);
    }
    if (typeof pkg.path !== 'string' || pkg.path.length === 0) {
      throw new Error('Missing package path in release plan');
    }
    if (
      pkg.path.includes('\\') ||
      pkg.path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`Unsafe package path in release plan: ${pkg.path}`);
    }
    if (!Array.isArray(pkg.dependencies)) {
      throw new Error('package dependencies must be an array');
    }

    const seenDependencies = new Set();
    for (const dependency of pkg.dependencies) {
      if (typeof dependency !== 'string') {
        throw new Error(`Invalid dependency for ${pkg.name}`);
      }
      if (seenDependencies.has(dependency)) {
        throw new Error(`Duplicate dependency ${dependency} for ${pkg.name}`);
      }
      seenDependencies.add(dependency);
      if (!packageNames.has(dependency)) {
        throw new Error(`Missing dependency ${dependency} in release plan`);
      }
      if (!seenPackages.has(dependency)) {
        throw new Error(
          `Package order violation: dependency ${dependency} must be ordered before its consumer ${pkg.name}`,
        );
      }
    }
    seenPackages.add(pkg.name);
  }
}
