import crypto from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import { createReleaseBundle, deriveBundleName } from './bundle.mjs';
import { writeDurabilityReceipt } from './durability.mjs';

export const policy = {
  schemaVersion: 1,
  packageRoots: ['packages'],
  release: { expectedPublicPackageCount: 2 },
  registry: {
    url: 'https://registry.npmjs.org',
    timeoutMs: 30000,
    mutationTimeoutMs: 120000,
    clientCommand: 'npm',
  },
  bundle: {
    namePrefix: 'kern-release',
    maxNameLength: 128,
    retentionDays: 90,
    maxArchiveBytes: 1073741824,
    maxExtractedBytes: 6442450944,
    maxEntries: 128,
    maxPages: 10,
    commandTimeoutMs: 60000,
    maxCommandOutputBytes: 1048576,
    githubApiVersion: '2026-03-10',
  },
  retry: { attempts: 2, delayMs: 1 },
  staging: { tagPrefix: 'kern-stage' },
  promotion: { rootPackageName: 'kern-lang' },
  provenance: { mode: 'disabled-unverified' },
  artifacts: {
    maxTarballBytes: 268435456,
    maxUnpackedBytes: 536870912,
    maxPackageJsonBytes: 1048576,
    maxCommandOutputBytes: 16777216,
    commandTimeoutMs: 600000,
    smokeTimeoutMs: 5000,
    safeBins: ['kern'],
    consumerBuiltDependencies: ['esbuild'],
    importSmokeExclusions: [],
  },
  channels: {
    stable: { versionMode: 'stable-input', distTag: 'latest', syncDev: true },
  },
};

export const plan = {
  planVersion: 1,
  sha: '0123456789abcdef0123456789abcdef01234567',
  channel: 'stable',
  version: '5.0.0',
  distTag: 'latest',
  syncsDev: true,
  packages: [
    { name: '@kernlang/core', path: 'packages/core', dependencies: [] },
    { name: 'kern-lang', path: 'packages/compat', dependencies: ['@kernlang/core'] },
  ],
};

function tarHeader(name, size) {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write(size.toString(8).padStart(11, '0'), 124, 'ascii');
  header.write('0', 156, 'ascii');
  header.write('ustar\0', 257, 'ascii');
  return header;
}

function tarEntry(name, contents) {
  const body = Buffer.from(contents);
  const padding = Buffer.alloc(Math.ceil(body.length / 512) * 512 - body.length);
  return Buffer.concat([tarHeader(name, body.length), body, padding]);
}

export async function createTestEnv() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kern-reconciler-test-'));
  const tarballDir = path.join(root, 'artifacts');
  const bundleDir = path.join(root, 'bundle');
  await mkdir(tarballDir);
  const manifestPackages = [];
  const packedInfo = [];
  for (const pkg of plan.packages) {
    const pkgJson = {
      name: pkg.name,
      version: plan.version,
      dependencies: Object.fromEntries(pkg.dependencies.map((name) => [name, plan.version])),
    };
    const bytes = zlib.gzipSync(Buffer.concat([
      tarEntry('package/package.json', JSON.stringify(pkgJson)),
      Buffer.alloc(1024),
    ]));
    const tarball = `${pkg.name.replace('@', '').replace('/', '-')}-${plan.version}.tgz`;
    await writeFile(path.join(tarballDir, tarball), bytes);
    const hash = crypto.createHash('sha512').update(bytes).digest();
    const info = {
      name: pkg.name,
      version: plan.version,
      tarball,
      size: bytes.length,
      sha512: hash.toString('hex'),
      integrity: `sha512-${hash.toString('base64')}`,
      pkgJson,
    };
    packedInfo.push(info);
    manifestPackages.push({
      name: pkg.name,
      path: pkg.path,
      version: plan.version,
      tarball,
      size: info.size,
      sha512: info.sha512,
      integrity: info.integrity,
      internalRuntimeDependencies: pkg.dependencies.map((name) => ({
        name,
        kind: 'dependency',
        version: plan.version,
      })),
      exports: null,
      bin: null,
    });
  }
  const manifest = {
    schemaVersion: 1,
    releasePlan: {
      planVersion: plan.planVersion,
      sha: plan.sha,
      channel: plan.channel,
      version: plan.version,
      distTag: plan.distTag,
    },
    packages: manifestPackages,
  };
  return {
    root,
    tarballDir,
    bundleDir,
    manifest,
    packFn: async () => packedInfo,
  };
}

export async function createDurableBundle(env) {
  const bundle = await createReleaseBundle({
    plan,
    manifest: env.manifest,
    tarballDir: env.tarballDir,
    bundleDir: env.bundleDir,
    policy,
  });
  await mkdir(path.join(env.root, '.release'), { recursive: true });
  await writeDurabilityReceipt({
    rootDir: env.root,
    kind: 'bundle',
    artifactName: deriveBundleName({ plan, policy }),
    artifactId: '123',
    artifactDigest: `sha256:${'a'.repeat(64)}`,
    contentPath: path.join(env.bundleDir, 'release-bundle.json'),
    plan,
    source: 'uploaded',
  });
  return bundle;
}

export class FakeRegistryClient {
  constructor(manifest) {
    this.manifest = manifest;
    this.versions = new Map();
    this.tags = new Map();
    this.calls = [];
    this.afterPublish = null;
  }
  async getVersion(name, version) {
    this.calls.push({ method: 'getVersion', name, version });
    return this.versions.get(`${name}@${version}`) ?? null;
  }
  async getDistTags(name) {
    this.calls.push({ method: 'getDistTags', name });
    return { ...(this.tags.get(name) ?? {}) };
  }
  async publishTarball(tarballPath, tag) {
    this.calls.push({ method: 'publishTarball', tarballPath, tag });
    const pkg = this.manifest.packages.find((candidate) => candidate.tarball === path.basename(tarballPath));
    if (!pkg) throw new Error(`Unknown fake-registry tarball: ${path.basename(tarballPath)}`);
    const metadata = {
      name: pkg.name,
      version: pkg.version,
      dist: { integrity: pkg.integrity },
      dependencies: Object.fromEntries(pkg.internalRuntimeDependencies.map((dep) => [dep.name, dep.version])),
    };
    this.versions.set(`${pkg.name}@${pkg.version}`, metadata);
    if (this.afterPublish) await this.afterPublish({ pkg, metadata });
  }
  async setDistTag(name, version, tag) {
    this.calls.push({ method: 'setDistTag', name, version, tag });
    this.tags.set(name, { ...(this.tags.get(name) ?? {}), [tag]: version });
  }
}

export class FakeArtifactStore {
  constructor(root) {
    this.root = root;
    this.snapshots = new Map();
  }
  async recoverBundle() { return null; }
  async recoverSnapshot({ artifactName }) { return this.snapshots.get(artifactName) ?? null; }
  async writeSnapshot(artifactName, snapshot) {
    this.snapshots.set(artifactName, snapshot);
    const snapshotPath = path.join(this.root, '.release', `${artifactName}.json`);
    await writeFile(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    return snapshotPath;
  }
}

export class FakeJournal {
  constructor() { this.events = []; }
  async writeEvent(event) { this.events.push(event); }
  async setFinalState(state) { this.finalState = state; }
  async setBundleDigest(digest) { this.bundleDigest = digest; }
}

export const clock = { now: () => new Date(0), sleep: async () => {} };
