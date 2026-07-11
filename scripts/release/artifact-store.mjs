import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

import { stringifyCanonical } from './artifact-types.mjs';
import { writeDurabilityReceipt } from './durability.mjs';

const execFileAsync = promisify(execFile);

function artifactHeaders(token, apiVersion) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': apiVersion,
    'User-Agent': 'kern-release-reconciler',
  };
}

function assertSafeZipEntries(stdout, maxEntries) {
  const entries = stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length === 0 || entries.length > maxEntries) {
    throw new Error(`Artifact archive entry count is invalid: ${entries.length}`);
  }
  if (new Set(entries).size !== entries.length) {
    throw new Error('Artifact archive contains duplicate entry paths');
  }
  for (const entry of entries) {
    const normalized = path.posix.normalize(entry);
    if (
      path.posix.isAbsolute(entry) ||
      normalized === '..' ||
      normalized.startsWith('../') ||
      entry.includes('\\')
    ) {
      throw new Error(`Artifact archive contains unsafe entry: ${entry}`);
    }
  }
}

function assertBoundedExtractedSize(stdout, maxExtractedBytes) {
  const summary = stdout.split(/\r?\n/).findLast((line) => /\bfiles?$/.test(line.trim()));
  // unzip -l ends with "<uncompressed bytes> <entry count> files".
  const match = summary?.trim().match(/^(\d+)\s+\d+\s+files?$/);
  if (!match) throw new Error('Artifact archive size listing is invalid');
  const extractedBytes = Number(match[1]);
  if (!Number.isSafeInteger(extractedBytes) || extractedBytes > maxExtractedBytes) {
    throw new Error(`Artifact extracted size exceeds configured limit: ${extractedBytes}`);
  }
}

function assertNoArchiveLinks(stdout) {
  const entryModes = stdout
    .split(/\r?\n/)
    .map((line) => line.trimStart())
    .filter((line) => /^[bcdlps-][rwxstST-]{9}\s/.test(line));
  if (entryModes.length === 0) throw new Error('Artifact archive mode listing is invalid');
  for (const line of entryModes) {
    if (line[0] !== '-' && line[0] !== 'd') {
      throw new Error(`Artifact archive contains a non-file entry: ${line}`);
    }
  }
}

export class DefaultArtifactStore {
  constructor({
    rootDir,
    token,
    runId,
    repo,
    apiUrl,
    limits,
    fetchFn = fetch,
    runCommandFn = execFileAsync,
  } = {}) {
    this.rootDir = rootDir || process.cwd();
    this.token = token || process.env.GITHUB_TOKEN;
    this.runId = runId || process.env.GITHUB_RUN_ID;
    this.repo = repo || process.env.GITHUB_REPOSITORY;
    this.apiUrl = apiUrl || process.env.GITHUB_API_URL || 'https://api.github.com';
    this.limits = limits;
    this.fetchFn = fetchFn;
    this.runCommandFn = runCommandFn;
  }

  assertRemoteContext() {
    if (!this.token || !this.runId || !this.repo) {
      throw new Error('GitHub Actions artifact context is required for a publish phase');
    }
    if (
      !Number.isSafeInteger(this.limits?.maxArchiveBytes) ||
      this.limits.maxArchiveBytes <= 0 ||
      !Number.isSafeInteger(this.limits?.maxEntries) ||
      this.limits.maxEntries <= 0 ||
      !Number.isSafeInteger(this.limits?.maxExtractedBytes) ||
      this.limits.maxExtractedBytes <= 0 ||
      !Number.isSafeInteger(this.limits?.commandTimeoutMs) ||
      this.limits.commandTimeoutMs <= 0 ||
      !Number.isSafeInteger(this.limits?.maxCommandOutputBytes) ||
      this.limits.maxCommandOutputBytes <= 0
    ) {
      throw new Error('Artifact recovery limits are missing or invalid');
    }
  }

  async findCurrentRunArtifact(artifactName, expectedSha) {
    this.assertRemoteContext();
    const matches = [];
    let page = 1;
    for (; page <= this.limits.maxPages; page += 1) {
      const url = `${this.apiUrl}/repos/${this.repo}/actions/runs/${this.runId}/artifacts?per_page=100&page=${page}`;
      const response = await this.fetchFn(url, {
        headers: artifactHeaders(this.token, this.limits.githubApiVersion),
        signal: AbortSignal.timeout(this.limits.commandTimeoutMs),
      });
      if (!response.ok) {
        throw new Error(`GitHub artifact listing failed with HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload.artifacts)) {
        throw new Error('GitHub artifact listing returned an invalid payload');
      }
      matches.push(...payload.artifacts.filter((artifact) => artifact.name === artifactName));
      if (payload.artifacts.length < 100) break;
    }
    if (page > this.limits.maxPages) {
      throw new Error(`GitHub artifact listing exceeded configured page limit: ${this.limits.maxPages}`);
    }
    if (matches.length > 1) {
      throw new Error(`Duplicate current-run artifact: ${artifactName}`);
    }
    if (matches.length === 0) return null;
    const artifact = matches[0];
    if (artifact.expired === true) {
      throw new Error(`Current-run artifact is expired: ${artifactName}`);
    }
    if (!Number.isSafeInteger(artifact.id) || artifact.id <= 0) {
      throw new Error(`Current-run artifact has an invalid id: ${artifactName}`);
    }
    if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes <= 0) {
      throw new Error(`Current-run artifact has an invalid size: ${artifactName}`);
    }
    if (artifact.size_in_bytes > this.limits.maxArchiveBytes) {
      throw new Error(`Current-run artifact exceeds configured archive limit: ${artifactName}`);
    }
    if (
      String(artifact.workflow_run?.id) !== String(this.runId) ||
      artifact.workflow_run?.head_sha !== expectedSha
    ) {
      throw new Error(`Current-run artifact provenance does not match this release: ${artifactName}`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(artifact.digest)) {
      throw new Error(`Current-run artifact has an invalid digest: ${artifactName}`);
    }
    return artifact;
  }

  async downloadArtifact(artifact, destinationDir) {
    const url = `${this.apiUrl}/repos/${this.repo}/actions/artifacts/${artifact.id}/zip`;
    const response = await this.fetchFn(url, {
      headers: artifactHeaders(this.token, this.limits.githubApiVersion),
      signal: AbortSignal.timeout(this.limits.commandTimeoutMs),
    });
    if (!response.ok) {
      throw new Error(`GitHub artifact download failed with HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('GitHub artifact download returned no body');
    const releaseDir = path.join(this.rootDir, '.release');
    const zipPath = path.join(releaseDir, `artifact-${artifact.id}.zip`);
    await mkdir(releaseDir, { recursive: true });
    const hash = crypto.createHash('sha256');
    let downloadedBytes = 0;
    const meter = new Transform({
      transform: (chunk, _encoding, callback) => {
        downloadedBytes += chunk.length;
        if (downloadedBytes > this.limits.maxArchiveBytes) {
          callback(new Error(`Downloaded artifact exceeds configured archive limit: ${downloadedBytes}`));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(zipPath, { mode: 0o600 }),
      );
      if (downloadedBytes === 0) throw new Error('Downloaded artifact archive is empty');
      if (artifact.digest) {
        const actualDigest = `sha256:${hash.digest('hex')}`;
        if (actualDigest !== artifact.digest) {
          throw new Error(`Downloaded artifact digest mismatch for ${artifact.name}`);
        }
      }
      const listResult = await this.runCommandFn('unzip', ['-Z1', zipPath], {
        timeout: this.limits.commandTimeoutMs,
        maxBuffer: this.limits.maxCommandOutputBytes,
      });
      assertSafeZipEntries(listResult.stdout.toString(), this.limits.maxEntries);
      const sizeResult = await this.runCommandFn('unzip', ['-l', zipPath], {
        timeout: this.limits.commandTimeoutMs,
        maxBuffer: this.limits.maxCommandOutputBytes,
      });
      assertBoundedExtractedSize(sizeResult.stdout.toString(), this.limits.maxExtractedBytes);
      const modeResult = await this.runCommandFn('unzip', ['-Z', '-l', zipPath], {
        timeout: this.limits.commandTimeoutMs,
        maxBuffer: this.limits.maxCommandOutputBytes,
      });
      assertNoArchiveLinks(modeResult.stdout.toString());
      await rm(destinationDir, { recursive: true, force: true });
      await mkdir(destinationDir, { recursive: true });
      await this.runCommandFn('unzip', ['-q', zipPath, '-d', destinationDir], {
        timeout: this.limits.commandTimeoutMs,
        maxBuffer: this.limits.maxCommandOutputBytes,
      });
    } finally {
      await rm(zipPath, { force: true });
    }
  }

  async recoverBundle({ artifactName, plan, bundleDir }) {
    const artifact = await this.findCurrentRunArtifact(artifactName, plan.sha);
    if (!artifact) return null;
    await this.downloadArtifact(artifact, bundleDir);
    await writeDurabilityReceipt({
      rootDir: this.rootDir,
      kind: 'bundle',
      artifactName,
      artifactId: artifact.id,
      artifactDigest: artifact.digest ?? null,
      contentPath: path.join(bundleDir, 'release-bundle.json'),
      plan,
      source: 'recovered',
    });
    return bundleDir;
  }

  async writeSnapshot(snapshotName, snapshot) {
    const snapshotPath = path.join(this.rootDir, '.release', `${snapshotName}.json`);
    await writeFile(snapshotPath, stringifyCanonical(snapshot), { mode: 0o600 });
    return snapshotPath;
  }

  async recoverSnapshot({ artifactName, plan }) {
    const artifact = await this.findCurrentRunArtifact(artifactName, plan.sha);
    if (!artifact) return null;
    const tempDir = path.join(this.rootDir, '.release', `snapshot-${artifact.id}`);
    await this.downloadArtifact(artifact, tempDir);
    const sourcePath = path.join(tempDir, `${artifactName}.json`);
    const snapshotEntries = await readdir(tempDir);
    if (snapshotEntries.length !== 1 || snapshotEntries[0] !== `${artifactName}.json`) {
      throw new Error('Recovered promotion snapshot artifact contains unexpected entries');
    }
    const sourceInfo = await lstat(sourcePath);
    if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink()) {
      throw new Error('Recovered promotion snapshot must be a regular file');
    }
    const snapshot = JSON.parse(await readFile(sourcePath, 'utf8'));
    const snapshotPath = await this.writeSnapshot(artifactName, snapshot);
    await writeDurabilityReceipt({
      rootDir: this.rootDir,
      kind: 'snapshot',
      artifactName,
      artifactId: artifact.id,
      artifactDigest: artifact.digest ?? null,
      contentPath: snapshotPath,
      plan,
      source: 'recovered',
    });
    await rm(tempDir, { recursive: true, force: true });
    return snapshot;
  }
}
