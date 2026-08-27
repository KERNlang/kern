import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const OWNER_MARKER = 'kern.compiler.kir-python.owner.v1';
export const COMPILER_FORMAT = 'kern.compiler.kir-python.v1';
export const ARTIFACT_FORMAT = 'kern.target.kir-python.v1';
export const HOST_PROFILE = 'kern.python.asyncio.v1';
export const OWNER_SUBPATH = './compiler/kir-python';
export const MISSING_OWNER_CODE = 'KIR_PYTHON_OWNER_MISSING';
export const AMBIGUOUS_OWNER_CODE = 'KIR_PYTHON_OWNER_AMBIGUOUS';
export const MISSING_OWNER = `${MISSING_OWNER_CODE}: @kernlang/core does not export ${OWNER_SUBPATH}`;

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

function missingOwner() {
  const error = new Error(MISSING_OWNER);
  error.code = MISSING_OWNER_CODE;
  return error;
}

export async function discoverPythonOwners(root) {
  const manifestPath = resolve(root, 'packages/core/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const target = manifest.exports?.[OWNER_SUBPATH];
  if (target === undefined) throw missingOwner();
  const candidates = [target?.default, target?.import, typeof target === 'string' ? target : undefined]
    .filter((value, index, values) => typeof value === 'string' && values.indexOf(value) === index);
  const owners = [];
  for (const candidate of candidates) {
    const pair = sourceTwin(resolve(manifestPath, '..'), candidate);
    if (!pair) continue;
    let namespace;
    try {
      namespace = await import(`${pathToFileURL(pair.builtPath).href}?owner=${Date.now()}-${Math.random()}`);
    } catch {
      continue;
    }
    if (
      namespace.KERN_KIR_PYTHON_COMPILER_OWNER !== OWNER_MARKER
      || namespace.KERN_KIR_PYTHON_COMPILER_FORMAT !== COMPILER_FORMAT
      || namespace.KERN_KIR_PYTHON_ARTIFACT_FORMAT !== ARTIFACT_FORMAT
      || namespace.KERN_KIR_PYTHON_HOST_PROFILE !== HOST_PROFILE
      || typeof namespace.compileKernKirToPython !== 'function'
    ) continue;
    owners.push({
      packageName: manifest.name,
      manifestPath,
      subpath: OWNER_SUBPATH,
      target,
      ...pair,
      namespace,
    });
  }
  if (owners.length === 0) throw missingOwner();
  return owners;
}

export function assertExactlyOnePythonOwner(owners) {
  if (owners.length === 0) throw missingOwner();
  if (owners.length > 1) {
    const error = new Error(`${AMBIGUOUS_OWNER_CODE}: multiple built facades provide ${OWNER_SUBPATH}`);
    error.code = AMBIGUOUS_OWNER_CODE;
    throw error;
  }
  return owners[0];
}

export function assertOwnerManifest(root) {
  const manifestPath = resolve(root, 'packages/core/package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const target = manifest.exports?.[OWNER_SUBPATH];
  if (target === undefined) throw missingOwner();
  return { manifest, manifestPath, target };
}

export function sourceFacadeExists(root) {
  return existsSync(resolve(root, 'packages/core/src/compiler-kir-python.ts'));
}
