import { readFile } from 'node:fs/promises';

const PLAIN_SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const DIST_TAG_RE = /^[a-z][a-z0-9._-]*$/;
const PRERELEASE_ID_RE = /^[a-z][a-z0-9-]*$/;
const CHANNEL_NAME_RE = /^[a-z][a-z0-9._-]*$/;

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
