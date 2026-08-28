import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OWNER_MARKER = 'kern.compiler.kir-js-esm.owner.v1';
export const COMPILER_FORMAT = 'kern.compiler.kir-js-esm.v1';
export const ARTIFACT_FORMAT = 'kern.target.kir-js-esm.v1';
export const HOST_PROFILE = 'kern.javascript-esm.node.v1';
export const MISSING_OWNER_CODE = 'KIR_JS_ESM_OWNER_MISSING';
export const AMBIGUOUS_OWNER_CODE = 'KIR_JS_ESM_OWNER_AMBIGUOUS';

const SOURCE_EXTENSIONS = new Map([
  ['.js', ['.ts', '.tsx', '.mts', '.cts']],
  ['.mjs', ['.mts', '.ts']],
  ['.cjs', ['.cts', '.ts']],
]);

function isInside(parent, child) {
  const value = relative(parent, child);
  return value !== '' && !value.startsWith('..') && !value.includes(`..${sep}`) && !value.startsWith(sep);
}

function regularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

function packageManifests(directory) {
  const results = [];
  const visit = (current) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name === 'package.json') results.push(path);
    }
  };
  visit(directory);
  return results.sort();
}

function exportTargets(value, subpath = '.', results = []) {
  if (typeof value === 'string') results.push({ subpath, target: value });
  else if (Array.isArray(value)) for (const item of value) exportTargets(item, subpath, results);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) exportTargets(item, key.startsWith('.') ? key : subpath, results);
  }
  return results;
}

function sourceTwin(packageDirectory, target) {
  if (typeof target !== 'string' || !target.startsWith('./dist/')) return undefined;
  const builtRoot = resolve(packageDirectory, 'dist');
  const sourceRoot = resolve(packageDirectory, 'src');
  const builtPath = resolve(packageDirectory, target);
  if (!isInside(builtRoot, builtPath) || !regularFile(builtPath)) return undefined;
  const extension = extname(builtPath);
  const stem = relative(builtRoot, builtPath).slice(0, -extension.length);
  for (const sourceExtension of SOURCE_EXTENSIONS.get(extension) ?? []) {
    const sourcePath = resolve(sourceRoot, `${stem}${sourceExtension}`);
    if (isInside(sourceRoot, sourcePath) && regularFile(sourcePath)) return { builtPath, sourcePath };
  }
  return undefined;
}

/** Discover the real package export; deliberately no assumed R2 subpath. */
export async function discoverJavaScriptEsmOwners(root) {
  const owners = new Map();
  for (const manifestPath of packageManifests(resolve(root, 'packages'))) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }
    if (!manifest?.name || !manifest.exports) continue;
    const packageDirectory = resolve(manifestPath, '..');
    for (const { subpath, target } of exportTargets(manifest.exports)) {
      const pair = sourceTwin(packageDirectory, target);
      if (!pair) continue;
      const identity = `${manifestPath}\0${pair.builtPath}`;
      let namespace;
      try {
        namespace = await import(pathToFileURL(pair.builtPath).href);
      } catch {
        continue;
      }
      if (
        namespace.KERN_KIR_JS_ESM_COMPILER_OWNER !== OWNER_MARKER
        || namespace.KERN_KIR_JS_ESM_COMPILER_FORMAT !== COMPILER_FORMAT
        || namespace.KERN_KIR_JS_ESM_ARTIFACT_FORMAT !== ARTIFACT_FORMAT
        || namespace.KERN_KIR_JS_ESM_HOST_PROFILE !== HOST_PROFILE
        || typeof namespace.compileKernKirToJavaScriptEsm !== 'function'
      ) continue;
      const owner = owners.get(identity) ?? {
        packageName: manifest.name,
        manifestPath,
        ...pair,
        subpaths: new Set(),
        namespace,
      };
      owner.subpaths.add(subpath);
      owners.set(identity, owner);
    }
  }
  return [...owners.values()]
    .map((owner) => ({ ...owner, subpaths: [...owner.subpaths].sort() }))
    .sort((a, b) => `${a.packageName}:${a.builtPath}`.localeCompare(`${b.packageName}:${b.builtPath}`));
}

export function assertExactlyOneJavaScriptEsmOwner(owners) {
  if (owners.length === 0) {
    const error = new Error(`${MISSING_OWNER_CODE}: no package export provides the R2 KIR JavaScript ESM owner`);
    error.code = MISSING_OWNER_CODE;
    throw error;
  }
  if (owners.length > 1) {
    const names = owners.map((owner) => `${owner.packageName}${owner.subpaths.join(',')}`).join('; ');
    const error = new Error(`${AMBIGUOUS_OWNER_CODE}: multiple package exports provide the R2 owner (${names})`);
    error.code = AMBIGUOUS_OWNER_CODE;
    throw error;
  }
  return owners[0];
}
