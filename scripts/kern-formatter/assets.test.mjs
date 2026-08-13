import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  KERN_FORMATTER_ASSET_NAMES,
  loadKernFormatterAssets,
} from '../../packages/cli/dist/kern-formatter-assets.js';

const DIST = fileURLToPath(new URL('../../packages/cli/dist/kern-formatter/', import.meta.url));
const temporary = [];

afterEach(() => {
  while (temporary.length > 0) rmSync(temporary.pop(), { force: true, recursive: true });
});

function copyAssets() {
  const directory = mkdtempSync(join(tmpdir(), 'kern-formatter-assets-'));
  temporary.push(directory);
  for (const name of KERN_FORMATTER_ASSET_NAMES) copyFileSync(resolve(DIST, name), resolve(directory, name));
  return directory;
}

test('compiled trust anchors admit the exact packaged regular-file set', () => {
  const assets = loadKernFormatterAssets();
  assert.equal(assets.formatter.bytes, Buffer.byteLength(assets.source));
  assert.equal(assets.policy.format, 'kern.formatter.policy.1');
  assert.equal(assets.policy.profileLimits.maxLexicalDepth, 64);
  assert.ok(
    assets.policy.profileLimits.maxResultCodePoints >= assets.policy.profileLimits.maxCodePoints + 2,
  );
});

test('extra and symlinked assets fail closed', () => {
  const extra = copyAssets();
  writeFileSync(resolve(extra, 'extra.txt'), 'unexpected');
  assert.throws(() => loadKernFormatterAssets(extra), /must contain exactly/u);

  const linked = copyAssets();
  unlinkSync(resolve(linked, 'policy.json'));
  symlinkSync(resolve(DIST, 'policy.json'), resolve(linked, 'policy.json'));
  assert.throws(() => loadKernFormatterAssets(linked), /must be a regular file/u);
});

test('mutating source and rewriting its self-manifest cannot bypass compiled identities', () => {
  const directory = copyAssets();
  const sourcePath = resolve(directory, 'formatter.composed.kern');
  const source = readFileSync(sourcePath);
  source[0] ^= 1;
  writeFileSync(sourcePath, source);
  const manifestPath = resolve(directory, 'assets.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.source.sha256 = '0'.repeat(64);
  writeFileSync(manifestPath, `${JSON.stringify(manifest)}\n`);
  assert.throws(() => loadKernFormatterAssets(directory), /digest identity changed/u);
});
