import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseCanonicalJsonBytes } from './r0-abi-oracle-helpers.mjs';

const BUNDLE_FORMAT = 'kern.r0.contract-bundle.1';
const SHA256 = /^[0-9a-f]{64}$/u;
const SAFE_PATH = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/u;
const KINDS = new Set(['authority', 'fixture', 'generated', 'schema', 'test', 'validation']);

function fail(message) {
  throw new Error(`R0 contract bundle: ${message}`);
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} must contain exactly ${expected.join(',')}`);
  }
}

function safePath(value, label) {
  if (
    typeof value !== 'string' ||
    !SAFE_PATH.test(value) ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value
  ) {
    fail(`${label} must be a safe repository-relative path`);
  }
  return value;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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

function validateAbi(abi) {
  exactKeys(abi, ['compilerRequest', 'compilerResult', 'runtime', 'targetArtifact'], 'abi');
  const expected = {
    compilerRequest: 'kern.compiler.request.r0',
    compilerResult: 'kern.compiler.result.r0',
    runtime: 'kern.runtime.kir.r0',
    targetArtifact: 'kern.target.artifact.r0',
  };
  for (const [key, value] of Object.entries(expected)) if (abi[key] !== value) fail(`abi.${key} drifted`);
}

function validateCommand(command) {
  if (!Array.isArray(command) || command.length !== 2 || command[0] !== 'node') fail('commands.check must be node plus one script');
  safePath(command[1], 'commands.check[1]');
  if (command[1] !== 'scripts/kern-5-r0-contracts/check.mjs') fail('commands.check must name the authenticated R0 checker');
}

function validateBudgets(budgets) {
  exactKeys(budgets, ['javascript-esm', 'python'], 'budgets');
  for (const target of ['javascript-esm', 'python']) {
    const budget = budgets[target];
    exactKeys(budget, ['maxMedianLatencyMs', 'maxPeakRssBytes', 'samples', 'warmups'], `budgets.${target}`);
    for (const key of ['maxMedianLatencyMs', 'maxPeakRssBytes', 'samples']) {
      if (!Number.isSafeInteger(budget[key]) || budget[key] <= 0) fail(`budgets.${target}.${key} must be positive`);
    }
    if (!Number.isSafeInteger(budget.warmups) || budget.warmups < 0) fail(`budgets.${target}.warmups must be non-negative`);
    if (budget.samples < 3 || budget.samples % 2 === 0) fail(`budgets.${target}.samples must be odd and at least three`);
  }
}

function validateInventory(inventory, bundlePrefix) {
  if (!Array.isArray(inventory) || inventory.length === 0) fail('inventory must be non-empty');
  const paths = [];
  for (const [index, entry] of inventory.entries()) {
    exactKeys(entry, ['kind', 'path', 'sha256'], `inventory[${index}]`);
    safePath(entry.path, `inventory[${index}].path`);
    if (bundlePrefix && !entry.path.startsWith(`${bundlePrefix}/`)) fail(`inventory[${index}] must stay inside bundle directory`);
    if (!KINDS.has(entry.kind)) fail(`inventory[${index}].kind is unsupported`);
    if (!SHA256.test(entry.sha256)) fail(`inventory[${index}].sha256 must be lowercase SHA-256`);
    paths.push(entry.path);
  }
  const sorted = [...paths].sort();
  if (paths.some((entry, index) => entry !== sorted[index])) fail('inventory paths must be sorted');
  if (new Set(paths).size !== paths.length) fail('inventory paths must be unique');
  const folded = paths.map((entry) => entry.toLowerCase());
  if (new Set(folded).size !== folded.length) fail('inventory paths must be case-fold unique');
  return new Map(inventory.map((entry) => [entry.path, entry]));
}

function validateProbe(probe, inventory) {
  exactKeys(probe, ['expectedEnvelopes', 'input', 'topology'], 'probe');
  for (const key of ['input', 'expectedEnvelopes', 'topology']) {
    exactKeys(probe[key], ['path', 'sha256'], `probe.${key}`);
    safePath(probe[key].path, `probe.${key}.path`);
    if (!SHA256.test(probe[key].sha256)) fail(`probe.${key}.sha256 must be lowercase SHA-256`);
    const bound = inventory.get(probe[key].path);
    if (!bound || bound.sha256 !== probe[key].sha256) fail(`probe.${key} must bind an exact inventory entry`);
  }
}

function discoverBundleFiles(rootDir, bundlePath, manifestPath) {
  const result = [];
  function visit(relativeDirectory) {
    const absoluteDirectory = absolutePath(rootDir, relativeDirectory, 'bundle directory');
    assertNoSymlinkTraversal(rootDir, relativeDirectory, 'bundle directory');
    const stat = lstatSync(absoluteDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('bundle directory must be a real directory');
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const relative = `${relativeDirectory}/${entry.name}`;
      const absolute = absolutePath(rootDir, relative, 'bundle entry');
      const child = lstatSync(absolute);
      if (child.isSymbolicLink()) fail(`bundle entry cannot traverse a symlink: ${relative}`);
      if (child.isDirectory()) visit(relative);
      else if (child.isFile()) {
        if (relative !== manifestPath) result.push(relative);
      } else fail(`bundle entry must be a regular file or directory: ${relative}`);
    }
  }
  visit(bundlePath);
  return result.sort();
}

export function validateR0ContractBundle({ rootDir = process.cwd(), manifestPath = 'scripts/kern-5-r0-contracts/manifest.json' } = {}) {
  const root = path.resolve(rootDir);
  safePath(manifestPath, 'manifestPath');
  const bundlePath = path.posix.dirname(manifestPath);
  if (bundlePath === '.') fail('manifest must live in a bundle directory');
  const manifestBytes = regularBytes(root, manifestPath, 'manifest');
  const manifest = parseCanonicalJsonBytes(manifestBytes, 'R0 contract manifest');
  exactKeys(manifest, ['abi', 'budgets', 'bundleVersion', 'commands', 'format', 'inventory', 'probe'], 'manifest');
  if (manifest.format !== BUNDLE_FORMAT || manifest.bundleVersion !== 1) fail('unsupported bundle format or version');
  validateAbi(manifest.abi);
  exactKeys(manifest.commands, ['check'], 'commands');
  validateCommand(manifest.commands.check);
  validateBudgets(manifest.budgets);
  const inventory = validateInventory(manifest.inventory, bundlePath);
  validateProbe(manifest.probe, inventory);
  const discovered = discoverBundleFiles(root, bundlePath, manifestPath);
  const listed = [...inventory.keys()];
  if (discovered.length !== listed.length || discovered.some((entry, index) => entry !== listed[index])) {
    const unexpected = discovered.find((entry) => !inventory.has(entry));
    const missing = listed.find((entry) => !discovered.includes(entry));
    fail(`inventory does not exactly match bundle files${unexpected ? `; unexpected R0 bundle file ${unexpected}` : ''}${missing ? `; missing ${missing}` : ''}`);
  }
  for (const entry of manifest.inventory) {
    const bytes = regularBytes(root, entry.path, `inventory ${entry.path}`);
    if (sha256(bytes) !== entry.sha256) fail(`inventory digest drift for ${entry.path}`);
  }
  return Object.freeze({ inventory: manifest.inventory, manifest, manifestSha256: sha256(manifestBytes) });
}
