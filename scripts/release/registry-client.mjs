import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  assertDeprecationMessage,
  assertDistTag,
  assertExactVersion,
  assertPackageName,
} from './registry-validation.mjs';

const execFileAsync = promisify(execFile);

function encodePackageName(packageName) {
  return packageName.startsWith('@')
    ? `@${encodeURIComponent(packageName.slice(1))}`
    : encodeURIComponent(packageName);
}

async function boundedJson(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Registry response exceeds configured limit: ${contentLength}`);
  }
  if (!response.body) throw new Error('Registry response has no body');
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`Registry response exceeds configured limit: ${total}`);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export class DefaultRegistryClient {
  constructor({
    registryUrl,
    timeoutMs,
    mutationTimeoutMs,
    maxOutputBytes,
    clientCommand,
    provenanceMode,
    fetchFn = fetch,
    runCommandFn = execFileAsync,
  }) {
    if (!registryUrl || !timeoutMs || !mutationTimeoutMs || !maxOutputBytes || !clientCommand) {
      throw new Error('Registry client requires explicit policy configuration');
    }
    this.registryUrl = registryUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.mutationTimeoutMs = mutationTimeoutMs;
    this.maxOutputBytes = maxOutputBytes;
    this.clientCommand = clientCommand;
    this.provenanceMode = provenanceMode;
    this.fetchFn = fetchFn;
    this.runCommandFn = runCommandFn;
  }

  async read(url, missingValue) {
    try {
      const response = await this.fetchFn(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'kern-release-reconciler' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (response.status === 404) return missingValue;
      if (!response.ok) throw new Error(`Registry returned HTTP ${response.status}`);
      return await boundedJson(response, this.maxOutputBytes);
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error(`Registry read timeout after ${this.timeoutMs}ms: ${url}`);
      }
      throw error;
    }
  }

  getVersion(packageName, version) {
    return this.read(`${this.registryUrl}/${encodePackageName(packageName)}/${version}`, null);
  }

  getDistTags(packageName) {
    return this.read(`${this.registryUrl}/-/package/${encodePackageName(packageName)}/dist-tags`, {});
  }

  async publishTarball(tarballPath, distTag) {
    if (typeof tarballPath !== 'string' || !path.isAbsolute(tarballPath) || !tarballPath.endsWith('.tgz')) {
      throw new Error(`Publish requires an absolute .tgz path: ${tarballPath}`);
    }
    const info = fs.lstatSync(tarballPath);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`Publish tarball is not a regular file: ${tarballPath}`);
    }
    assertDistTag(distTag, this.maxOutputBytes);
    const args = [
      'publish',
      tarballPath,
      '--tag',
      distTag,
      '--access',
      'public',
      '--registry',
      this.registryUrl,
      '--ignore-scripts',
    ];
    if (this.provenanceMode === 'required') args.push('--provenance');
    if (this.provenanceMode !== 'required' && this.provenanceMode !== 'disabled-unverified') {
      throw new Error(`Unsupported provenance mode: ${this.provenanceMode}`);
    }
    try {
      await this.runCommandFn(this.clientCommand, args, {
        timeout: this.mutationTimeoutMs,
        maxBuffer: this.maxOutputBytes,
      });
    } catch (error) {
      throw new Error(`Registry publish failed: ${error.message}`);
    }
  }

  async setDistTag(packageName, version, distTag) {
    assertPackageName(packageName, this.maxOutputBytes);
    assertExactVersion(version, this.maxOutputBytes);
    assertDistTag(distTag, this.maxOutputBytes);
    try {
      await this.runCommandFn(
        this.clientCommand,
        ['dist-tag', 'add', `${packageName}@${version}`, distTag, '--registry', this.registryUrl],
        { timeout: this.mutationTimeoutMs, maxBuffer: this.maxOutputBytes },
      );
    } catch (error) {
      throw new Error(`Registry dist-tag mutation failed: ${error.message}`);
    }
  }

  async removeDistTag(packageName, distTag) {
    assertPackageName(packageName, this.maxOutputBytes);
    assertDistTag(distTag, this.maxOutputBytes);
    try {
      await this.runCommandFn(
        this.clientCommand,
        ['dist-tag', 'rm', packageName, distTag, '--registry', this.registryUrl],
        { timeout: this.mutationTimeoutMs, maxBuffer: this.maxOutputBytes },
      );
    } catch (error) {
      throw new Error(`Registry dist-tag removal failed: ${error.message}`);
    }
  }

  async deprecateVersion(packageName, version, message) {
    assertPackageName(packageName, this.maxOutputBytes);
    assertExactVersion(version, this.maxOutputBytes);
    assertDeprecationMessage(message, this.maxOutputBytes);
    try {
      await this.runCommandFn(
        this.clientCommand,
        ['deprecate', `${packageName}@${version}`, message, '--registry', this.registryUrl],
        { timeout: this.mutationTimeoutMs, maxBuffer: this.maxOutputBytes },
      );
    } catch (error) {
      throw new Error(`Registry deprecation failed: ${error.message}`);
    }
  }
}
