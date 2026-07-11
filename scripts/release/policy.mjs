import { readFile } from 'node:fs/promises';

const PLAIN_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DIST_TAG_RE = /^[a-z][a-z0-9._-]*$/;
const PRERELEASE_ID_RE = /^[a-z][a-z0-9-]*$/;
const CHANNEL_NAME_RE = /^[a-z][a-z0-9._-]*$/;
const BIN_NAME_RE = /^[a-z0-9][a-z0-9._-]*$/;
const PACKAGE_NAME_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

function assertPlainSemver(value, label) {
  if (typeof value !== 'string' || !PLAIN_SEMVER_RE.test(value)) {
    throw new Error(`Invalid ${label} SemVer version: ${value}`);
  }
}

export async function loadReleasePolicy(policyPath) {
  const content = await readFile(policyPath, 'utf8');
  const policy = JSON.parse(content);
  validateReleasePolicy(policy);
  return policy;
}

export function validateReleasePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new Error('Invalid policy object');
  }
  if (policy.schemaVersion !== 1) {
    throw new Error('Unsupported schema version');
  }

  const release = policy.release;
  if (!release || typeof release !== 'object' || Array.isArray(release)) {
    throw new Error('release must be an object');
  }
  if (!Number.isSafeInteger(release.expectedPublicPackageCount) || release.expectedPublicPackageCount <= 0) {
    throw new Error('release.expectedPublicPackageCount must be a positive safe integer');
  }

  const registry = policy.registry;
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
    throw new Error('registry must be an object');
  }
  let registryUrl;
  try {
    registryUrl = new URL(registry.url);
  } catch {
    throw new Error(`Invalid registry url: ${registry.url}`);
  }
  if (registryUrl.protocol !== 'https:' || registryUrl.hostname !== 'registry.npmjs.org' || registryUrl.pathname !== '/') {
    throw new Error(`Invalid registry url: ${registry.url}`);
  }
  for (const field of ['timeoutMs', 'mutationTimeoutMs']) {
    if (!Number.isSafeInteger(registry[field]) || registry[field] <= 0) {
      throw new Error(`registry.${field} must be a positive safe integer`);
    }
  }
  if (typeof registry.clientCommand !== 'string' || !/^[a-z0-9._-]+$/.test(registry.clientCommand)) {
    throw new Error(`Invalid registry.clientCommand: ${registry.clientCommand}`);
  }

  const bundle = policy.bundle;
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new Error('bundle must be an object');
  }
  if (typeof bundle.namePrefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(bundle.namePrefix)) {
    throw new Error(`Invalid bundle.namePrefix: ${bundle.namePrefix}`);
  }
  if (!Number.isSafeInteger(bundle.maxNameLength) || bundle.maxNameLength <= 0) {
    throw new Error('bundle.maxNameLength must be a positive safe integer');
  }
  if (!Number.isSafeInteger(bundle.retentionDays) || bundle.retentionDays <= 0 || bundle.retentionDays > 90) {
    throw new Error('bundle.retentionDays must be a safe integer from 1 through 90');
  }
  for (const field of [
    'maxArchiveBytes',
    'maxExtractedBytes',
    'maxEntries',
    'maxPages',
    'commandTimeoutMs',
    'maxCommandOutputBytes',
  ]) {
    if (!Number.isSafeInteger(bundle[field]) || bundle[field] <= 0) {
      throw new Error(`bundle.${field} must be a positive safe integer`);
    }
  }
  if (!/^20[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/.test(bundle.githubApiVersion)) {
    throw new Error(`Invalid bundle.githubApiVersion: ${bundle.githubApiVersion}`);
  }

  const retry = policy.retry;
  if (!retry || typeof retry !== 'object' || Array.isArray(retry)) {
    throw new Error('retry must be an object');
  }
  if (!Number.isSafeInteger(retry.attempts) || retry.attempts <= 0) {
    throw new Error('retry.attempts must be a positive safe integer');
  }
  if (!Number.isSafeInteger(retry.delayMs) || retry.delayMs <= 0) {
    throw new Error('retry.delayMs must be a positive safe integer');
  }

  const staging = policy.staging;
  if (!staging || typeof staging !== 'object' || Array.isArray(staging)) {
    throw new Error('staging must be an object');
  }
  if (typeof staging.tagPrefix !== 'string' || !/^[a-z][a-z0-9-]*$/.test(staging.tagPrefix)) {
    throw new Error(`Invalid staging.tagPrefix: ${staging.tagPrefix}`);
  }

  const provenance = policy.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('provenance must be an object');
  }
  if (provenance.mode !== 'disabled-unverified') {
    throw new Error(
      `Invalid provenance.mode: ${provenance.mode}; required provenance remains disabled until external trusted-publisher verification is implemented`,
    );
  }

  const promotion = policy.promotion;
  if (!promotion || typeof promotion !== 'object' || Array.isArray(promotion)) {
    throw new Error('promotion must be an object');
  }
  if (typeof promotion.rootPackageName !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(promotion.rootPackageName)) {
    throw new Error(`Invalid promotion.rootPackageName: ${promotion.rootPackageName}`);
  }

  if (!Array.isArray(policy.packageRoots) || policy.packageRoots.length === 0) {
    throw new Error('At least one package root is required');
  }
  const seenRoots = new Set();
  for (const root of policy.packageRoots) {
    if (typeof root !== 'string' || root.length === 0) {
      throw new Error('packageRoot must be a string');
    }
    const segments = root.split('/');
    if (
      pathIsAbsolute(root) ||
      root.includes('\\') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`Unsafe package root: ${root}`);
    }
    if (seenRoots.has(root)) {
      throw new Error(`Duplicate package root: ${root}`);
    }
    seenRoots.add(root);
  }

  const artifacts = policy.artifacts;
  if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new Error('artifacts must be an object');
  }
  for (const field of [
    'maxTarballBytes',
    'maxUnpackedBytes',
    'maxPackageJsonBytes',
    'maxCommandOutputBytes',
    'commandTimeoutMs',
    'smokeTimeoutMs',
  ]) {
    if (!Number.isSafeInteger(artifacts[field]) || artifacts[field] <= 0) {
      throw new Error(`artifacts.${field} must be a positive safe integer`);
    }
  }
  if (artifacts.maxPackageJsonBytes > artifacts.maxUnpackedBytes) {
    throw new Error('artifacts.maxPackageJsonBytes cannot exceed maxUnpackedBytes');
  }
  if (!Array.isArray(artifacts.safeBins)) {
    throw new Error('artifacts.safeBins must be an array');
  }
  const safeBins = new Set();
  for (const bin of artifacts.safeBins) {
    if (typeof bin !== 'string' || !BIN_NAME_RE.test(bin)) {
      throw new Error(`Invalid artifacts.safeBins entry: ${bin}`);
    }
    if (safeBins.has(bin)) {
      throw new Error(`Duplicate artifacts.safeBins entry: ${bin}`);
    }
    safeBins.add(bin);
  }
  if (!Array.isArray(artifacts.consumerBuiltDependencies)) {
    throw new Error('artifacts.consumerBuiltDependencies must be an array');
  }
  const builtDependencies = new Set();
  for (const name of artifacts.consumerBuiltDependencies) {
    if (typeof name !== 'string' || !PACKAGE_NAME_RE.test(name)) {
      throw new Error(`Invalid artifacts.consumerBuiltDependencies entry: ${name}`);
    }
    if (builtDependencies.has(name)) {
      throw new Error(`Duplicate artifacts.consumerBuiltDependencies entry: ${name}`);
    }
    builtDependencies.add(name);
  }
  if (!Array.isArray(artifacts.importSmokeExclusions)) {
    throw new Error('artifacts.importSmokeExclusions must be an array');
  }
  const importSmokeExclusions = new Set();
  for (const name of artifacts.importSmokeExclusions) {
    if (typeof name !== 'string' || !PACKAGE_NAME_RE.test(name)) {
      throw new Error(`Invalid artifacts.importSmokeExclusions entry: ${name}`);
    }
    if (importSmokeExclusions.has(name)) {
      throw new Error(`Duplicate artifacts.importSmokeExclusions entry: ${name}`);
    }
    importSmokeExclusions.add(name);
  }

  if (
    !policy.channels ||
    typeof policy.channels !== 'object' ||
    Array.isArray(policy.channels) ||
    Object.keys(policy.channels).length === 0
  ) {
    throw new Error('channels must be an object');
  }

  for (const [name, channel] of Object.entries(policy.channels)) {
    if (!CHANNEL_NAME_RE.test(name)) {
      throw new Error(`Invalid channel name: ${name}`);
    }
    if (!channel || typeof channel !== 'object' || Array.isArray(channel)) {
      throw new Error(`Channel ${name} must be an object`);
    }
    if (!['stable-input', 'canary-run'].includes(channel.versionMode)) {
      throw new Error(`Unsupported version mode for channel ${name}: ${channel.versionMode}`);
    }
    if (
      typeof channel.distTag !== 'string' ||
      channel.distTag.length > 214 ||
      !DIST_TAG_RE.test(channel.distTag)
    ) {
      throw new Error(`Invalid dist-tag for channel ${name}: ${channel.distTag}`);
    }
    if (typeof channel.syncDev !== 'boolean') {
      throw new Error(`Channel ${name} must declare a boolean syncDev policy`);
    }

    if (channel.versionMode === 'canary-run') {
      assertPlainSemver(channel.baseVersion, `canary base for channel ${name}`);
      if (
        typeof channel.prereleaseId !== 'string' ||
        !PRERELEASE_ID_RE.test(channel.prereleaseId)
      ) {
        throw new Error(`Invalid prerelease id for channel ${name}: ${channel.prereleaseId}`);
      }
      if (channel.distTag === 'latest') {
        throw new Error(`Prerelease channel ${name} cannot map to latest dist-tag`);
      }
      if (channel.syncDev) {
        throw new Error(`Prerelease channel ${name} cannot sync dev`);
      }
    } else {
      if (channel.distTag !== 'latest') {
        throw new Error(`Stable channel ${name} must use latest dist-tag`);
      }
      if (!channel.syncDev) {
        throw new Error(`Stable channel ${name} must sync dev`);
      }
    }
  }
}

function pathIsAbsolute(p) {
  return p.startsWith('/') || /^[a-zA-Z]:/.test(p);
}

export function resolveReleaseIntent({ policy, channel, version, sha, runNumber }) {
  validateReleasePolicy(policy);

  if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
    throw new Error(`Invalid sha: ${sha}`);
  }

  const channelConfig = policy.channels[channel];
  if (!channelConfig) {
    throw new Error(`Unknown channel: ${channel}`);
  }

  if (channelConfig.versionMode === 'stable-input') {
    if (runNumber !== undefined) {
      throw new Error('Stable channel does not accept a run number');
    }
    assertPlainSemver(version, 'stable');
    return {
      channel,
      version,
      distTag: channelConfig.distTag,
      syncsDev: channelConfig.syncDev,
    };
  }

  if (channelConfig.versionMode === 'canary-run') {
    if (version !== undefined) {
      throw new Error('Canary channel does not accept a version input');
    }
    if (runNumber === undefined || runNumber === null) {
      throw new Error('Missing run number for canary-run channel');
    }
    const runStr = String(runNumber);
    if (!/^[1-9]\d*$/.test(runStr)) {
      throw new Error(`Invalid run number: ${runNumber}`);
    }
    const shortSha = sha.slice(0, 8);
    const resolvedVersion = `${channelConfig.baseVersion}-${channelConfig.prereleaseId}.${runStr}.g${shortSha}`;
    return {
      channel,
      version: resolvedVersion,
      distTag: channelConfig.distTag,
      syncsDev: channelConfig.syncDev,
    };
  }

  throw new Error(`Unsupported versionMode: ${channelConfig.versionMode}`);
}
