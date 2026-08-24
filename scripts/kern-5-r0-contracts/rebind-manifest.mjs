import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJsonBytes, parseCanonicalJsonBytes } from './r0-abi-oracle-helpers.mjs';

const DEFAULT_MANIFEST_PATH = 'scripts/kern-5-r0-contracts/manifest.json';
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;

function fail(message) {
  throw new Error(`R0 manifest rebind: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} must contain exactly ${expected.join(',')}`);
}

function safePath(value, label) {
  if (typeof value !== 'string' || !SAFE_PATH.test(value) || value.includes('\\') || path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) {
    fail(`${label} must be a safe repository-relative path`);
  }
  return value;
}

function absolutePath(rootDir, relativePath, label) {
  safePath(relativePath, label);
  const absolute = path.resolve(rootDir, relativePath);
  const relative = path.relative(rootDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`${label} escapes repository root`);
  return absolute;
}

function assertNoSymlinkTraversal(rootDir, relativePath, label) {
  let cursor = rootDir;
  for (const segment of relativePath.split('/')) {
    cursor = path.join(cursor, segment);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat) fail(`${label} is missing`);
    if (stat.isSymbolicLink()) fail(`${label} cannot traverse a symlink`);
  }
}

function regularBytes(rootDir, relativePath, label) {
  const absolute = absolutePath(rootDir, relativePath, label);
  assertNoSymlinkTraversal(rootDir, relativePath, label);
  const stat = lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} must be a regular file`);
  return readFileSync(absolute);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function discoverBundleFiles(rootDir, bundlePath, manifestPath) {
  const files = [];
  function visit(relativeDirectory) {
    const absolute = absolutePath(rootDir, relativeDirectory, 'bundle directory');
    assertNoSymlinkTraversal(rootDir, relativeDirectory, 'bundle directory');
    const stat = lstatSync(absolute);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('bundle directory must be a real directory');
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const relative = `${relativeDirectory}/${entry.name}`;
      const child = lstatSync(absolutePath(rootDir, relative, 'bundle entry'));
      if (child.isSymbolicLink()) fail(`bundle entry cannot traverse a symlink: ${relative}`);
      if (child.isDirectory()) visit(relative);
      else if (child.isFile()) {
        if (relative !== manifestPath) files.push(relative);
      } else fail(`bundle entry must be a regular file or directory: ${relative}`);
    }
  }
  visit(bundlePath);
  return files.sort();
}

function inventoryKind(relativePath, bundlePath) {
  const prefix = `${bundlePath}/`;
  if (relativePath.startsWith(`${prefix}fixtures/`)) return 'fixture';
  if (relativePath.startsWith(`${prefix}generated/`)) return 'generated';
  if (relativePath.startsWith(`${prefix}schema/`) && relativePath.endsWith('.json')) return 'schema';
  if (relativePath.endsWith('.test.mjs')) return 'test';
  if (relativePath === `${prefix}check.mjs` || relativePath === `${prefix}validate-manifest.mjs` || relativePath === `${prefix}rebind-manifest.mjs`) return 'validation';
  if (relativePath.endsWith('.mjs')) return 'authority';
  fail(`cannot classify inventory file ${relativePath}`);
}

function rebindProbe(probe, inventory) {
  exactKeys(probe, ['expectedEnvelopes', 'input', 'topology'], 'probe');
  const rebound = {};
  for (const key of ['expectedEnvelopes', 'input', 'topology']) {
    exactKeys(probe[key], ['path', 'sha256'], `probe.${key}`);
    safePath(probe[key].path, `probe.${key}.path`);
    const entry = inventory.find((candidate) => candidate.path === probe[key].path);
    if (!entry) fail(`probe.${key} is not an inventoried bundle file`);
    rebound[key] = { path: entry.path, sha256: entry.sha256 };
  }
  return rebound;
}

export function rebindR0ContractManifest({ manifestPath = DEFAULT_MANIFEST_PATH, rootDir = process.cwd() } = {}) {
  const root = path.resolve(rootDir);
  safePath(manifestPath, 'manifestPath');
  const bundlePath = path.posix.dirname(manifestPath);
  if (bundlePath === '.') fail('manifest must live in a bundle directory');
  const manifest = parseCanonicalJsonBytes(regularBytes(root, manifestPath, 'manifest'), 'R0 contract manifest');
  exactKeys(manifest, ['abi', 'budgets', 'bundleVersion', 'commands', 'format', 'inventory', 'probe'], 'manifest');
  const inventory = discoverBundleFiles(root, bundlePath, manifestPath).map((entry) => ({
    kind: inventoryKind(entry, bundlePath),
    path: entry,
    sha256: sha256(regularBytes(root, entry, `inventory ${entry}`)),
  }));
  const rebound = { ...manifest, inventory, probe: rebindProbe(manifest.probe, inventory) };
  return Object.freeze({ bytes: canonicalJsonBytes(rebound), inventory, manifest: rebound });
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') fail('invoke with --write to replace the manifest inventory');
  const result = rebindR0ContractManifest();
  writeFileSync(path.resolve(process.cwd(), DEFAULT_MANIFEST_PATH), result.bytes);
  process.stdout.write(`R0 manifest rebound ${result.inventory.length} entries\n`);
}
