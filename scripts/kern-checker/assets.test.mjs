import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KERN_CHECKER_ASSET_NAMES,
  loadKernCheckerAssets,
} from '../../packages/cli/dist/kern-checker-assets.js';
import { verifyKernCheckerNativeWorkPolicy } from './native-work-policy.mjs';

const DIST = fileURLToPath(new URL('../../packages/cli/dist/kern-checker/', import.meta.url));
const temporary = [];

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop(), { force: true, recursive: true });
});

function copyAssets() {
  const directory = mkdtempSync(join(tmpdir(), 'kern-checker-assets-'));
  temporary.push(directory);
  for (const name of KERN_CHECKER_ASSET_NAMES) copyFileSync(resolve(DIST, name), resolve(directory, name));
  return directory;
}

test('compiled trust anchors admit the exact packaged regular-file set', () => {
  const assets = loadKernCheckerAssets();
  assert.equal(assets.checker.bytes, Buffer.byteLength(assets.source));
  assert.equal(assets.policy.format, 'kern.checker.policy.1');
  assert.deepEqual(verifyKernCheckerNativeWorkPolicy(assets.policy), assets.policy.nativeWork);
});

test('extra and symlinked assets fail closed', () => {
  const extra = copyAssets();
  writeFileSync(resolve(extra, 'extra.txt'), 'unexpected');
  assert.throws(() => loadKernCheckerAssets(extra), /must contain exactly/);

  const linked = copyAssets();
  unlinkSync(resolve(linked, 'policy.json'));
  symlinkSync(resolve(DIST, 'policy.json'), resolve(linked, 'policy.json'));
  assert.throws(() => loadKernCheckerAssets(linked), /must be a regular file/);
});

test('mutating bytes and rewriting the self-manifest cannot bypass compiled identities', () => {
  const directory = copyAssets();
  const sourcePath = resolve(directory, 'checker.composed.kern');
  const source = readFileSync(sourcePath);
  source[0] ^= 1;
  writeFileSync(sourcePath, source);
  const manifestPath = resolve(directory, 'assets.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.composite.sha256 = '0'.repeat(64);
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  assert.throws(() => loadKernCheckerAssets(directory), /digest identity changed/);
});
