import assert from 'node:assert/strict';
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const OWNER_MARKER = 'kern.runtime.kir.owner.v1';
const RUNTIME_FORMAT = 'kern.runtime.kir.v1';
const MISSING_OWNER_CODE = 'KIR_RUNTIME_OWNER_MISSING';
const AMBIGUOUS_OWNER_CODE = 'KIR_RUNTIME_OWNER_AMBIGUOUS';
const SOURCE_EXTENSIONS = new Map([
  ['.js', ['.ts', '.tsx', '.mts', '.cts']],
  ['.mjs', ['.mts', '.ts']],
  ['.cjs', ['.cts', '.ts']],
]);

function isInside(parent, child) {
  const childRelative = relative(parent, child);
  return childRelative !== '' && !childRelative.startsWith('..') && !childRelative.includes(`..${sep}`)
    && !childRelative.startsWith(sep);
}

function regularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function packageManifests(packagesRoot) {
  const manifests = [];
  const visit = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name === 'package.json') {
        manifests.push(entryPath);
      }
    }
  };
  visit(packagesRoot);
  return manifests.sort();
}

function exportTargets(exportsField) {
  const targets = [];
  const visit = (value, subpath = '.') => {
    if (typeof value === 'string') {
      targets.push({ subpath, target: value });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, subpath);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      visit(item, key.startsWith('.') ? key : subpath);
    }
  };
  visit(exportsField);
  return targets;
}

function sourceTwin(packageDirectory, builtTarget) {
  if (typeof builtTarget !== 'string' || !builtTarget.startsWith('./dist/')) return undefined;
  const builtRoot = resolve(packageDirectory, 'dist');
  const sourceRoot = resolve(packageDirectory, 'src');
  const builtPath = resolve(packageDirectory, builtTarget);
  if (!isInside(builtRoot, builtPath) || !regularFile(builtPath)) return undefined;

  const extension = extname(builtPath);
  const sourceExtensions = SOURCE_EXTENSIONS.get(extension);
  if (!sourceExtensions) return undefined;
  const builtRelative = relative(builtRoot, builtPath);
  const sourceStem = builtRelative.slice(0, -extension.length);
  for (const sourceExtension of sourceExtensions) {
    const sourcePath = resolve(sourceRoot, `${sourceStem}${sourceExtension}`);
    if (isInside(sourceRoot, sourcePath) && regularFile(sourcePath)) {
      return { builtPath, sourcePath };
    }
  }
  return undefined;
}

function manifestValue(manifestPath) {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return undefined;
  }
}

/**
 * Discover package-owned KIR runtime modules without depending on a planned
 * filename or subpath. Only package exports with a real dist/src pair can be
 * loaded; scripts and test adapters are outside this traversal by design.
 */
export async function discoverRuntimeOwners(rootDirectory = ROOT) {
  const owners = new Map();
  const packagesRoot = resolve(rootDirectory, 'packages');
  for (const manifestPath of packageManifests(packagesRoot)) {
    const manifest = manifestValue(manifestPath);
    if (!manifest || !manifest.name || !manifest.exports) continue;
    const packageDirectory = resolve(manifestPath, '..');
    for (const { subpath, target } of exportTargets(manifest.exports)) {
      const pair = sourceTwin(packageDirectory, target);
      if (!pair) continue;
      const identity = `${manifestPath}\0${pair.builtPath}`;
      if (owners.has(identity)) {
        owners.get(identity).subpaths.add(subpath);
        continue;
      }
      let namespace;
      try {
        namespace = await import(pathToFileURL(pair.builtPath).href);
      } catch {
        continue;
      }
      const values = Object.values(namespace);
      if (!values.includes(OWNER_MARKER) || !values.includes(RUNTIME_FORMAT)) continue;
      if (typeof namespace.executeKernKir !== 'function') continue;
      owners.set(identity, {
        packageName: manifest.name,
        manifestPath,
        builtPath: pair.builtPath,
        sourcePath: pair.sourcePath,
        subpaths: new Set([subpath]),
        namespace,
      });
    }
  }
  return [...owners.values()]
    .map((owner) => ({ ...owner, subpaths: [...owner.subpaths].sort() }))
    .sort((left, right) => `${left.packageName}:${left.builtPath}`.localeCompare(`${right.packageName}:${right.builtPath}`));
}

export function assertExactlyOneRuntimeOwner(owners) {
  if (owners.length === 0) {
    const error = new Error(`${MISSING_OWNER_CODE}: no package export provides the RT-1 KIR runtime owner`);
    error.code = MISSING_OWNER_CODE;
    throw error;
  }
  if (owners.length > 1) {
    const identities = owners.map(({ packageName, subpaths }) => `${packageName}${subpaths.join(',')}`).join('; ');
    const error = new Error(`${AMBIGUOUS_OWNER_CODE}: multiple package exports provide the RT-1 KIR runtime owner (${identities})`);
    error.code = AMBIGUOUS_OWNER_CODE;
    throw error;
  }
  return owners[0];
}

export function assertMcpServerExecutableOnlyManifest(manifest) {
  assert.deepEqual(manifest?.bin, { 'kern-mcp': './dist/index.js' });
  assert.deepEqual(manifest?.exports, {});
}

test('MCP server remains executable-only and exposes no JavaScript import target', () => {
  const manifest = manifestValue(resolve(ROOT, 'packages/mcp-server/package.json'));
  assertMcpServerExecutableOnlyManifest(manifest);
  assert.throws(
    () => assertMcpServerExecutableOnlyManifest({ ...manifest, exports: undefined }),
    assert.AssertionError,
  );
});

test('RT-1 has exactly one semantic package-owned KIR runtime owner', async () => {
  const owner = assertExactlyOneRuntimeOwner(await discoverRuntimeOwners());
  assert.ok(owner.sourcePath.startsWith(resolve(ROOT, 'packages')));
  assert.ok(owner.builtPath.startsWith(resolve(ROOT, 'packages')));
  assert.equal(existsSync(owner.sourcePath), true);
  assert.equal(existsSync(owner.builtPath), true);
});

test('ownership cardinality errors remain explicit and stable', () => {
  assert.throws(() => assertExactlyOneRuntimeOwner([]), { code: MISSING_OWNER_CODE });
  assert.throws(
    () => assertExactlyOneRuntimeOwner([
      { packageName: '@fixture/one', subpaths: ['.'] },
      { packageName: '@fixture/two', subpaths: ['.'] },
    ]),
    { code: AMBIGUOUS_OWNER_CODE },
  );
});
