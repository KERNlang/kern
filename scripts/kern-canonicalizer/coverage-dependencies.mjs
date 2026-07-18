import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const COMPILED_CORE_ROOT = resolve(ROOT, 'packages/core/dist');
const IMPLEMENTATION_ROOT = resolve(ROOT, 'scripts/kern-canonicalizer');

let authenticatedDependencies;

function fail(message) {
  throw new TypeError(`coverage dependency rejection: ${message}`);
}

function hashFramedFiles(root, paths) {
  const canonicalRoot = realpathSync(root);
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) {
    const path = resolve(canonicalRoot, name);
    const stat = lstatSync(path);
    const real = realpathSync(path);
    const relativePath = relative(canonicalRoot, real);
    const escaped = relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
    if (!stat.isFile() || real !== path || escaped) fail(`${name} must be a contained regular file`);
    const bytes = readFileSync(path);
    hash.update(`${name.length}:${name}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function compiledJavaScriptFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`compiled core entry ${path} must not be a symlink`);
    if (entry.isDirectory()) compiledJavaScriptFiles(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(path);
  }
  return output;
}

function localImplementationModules(directory = IMPLEMENTATION_ROOT, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) fail(`local implementation entry ${path} must not be a symlink`);
    if (entry.isDirectory()) localImplementationModules(path, output);
    else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      output.push(relative(ROOT, path).split(sep).join('/'));
    }
  }
  return output;
}

export function digestCompiledCoreJavaScript() {
  const stat = lstatSync(COMPILED_CORE_ROOT);
  if (!stat.isDirectory()) fail('compiled core root must be a regular directory');
  const canonicalRoot = realpathSync(COMPILED_CORE_ROOT);
  const paths = compiledJavaScriptFiles(canonicalRoot)
    .map((path) => relative(canonicalRoot, path).split(sep).join('/'));
  if (paths.length === 0) fail('compiled core JavaScript must not be empty');
  return hashFramedFiles(canonicalRoot, paths);
}

export function digestCoverageImplementationSources() {
  return hashFramedFiles(ROOT, localImplementationModules());
}

function currentDependencyReceipt() {
  return Object.freeze({
    compiledCoreDigest: digestCompiledCoreJavaScript(),
    coverageImplementationDigest: digestCoverageImplementationSources(),
  });
}

export function authenticateCoverageDependencies() {
  if (authenticatedDependencies !== undefined) return authenticatedDependencies;
  authenticatedDependencies = currentDependencyReceipt();
  return authenticatedDependencies;
}

export function requireAuthenticatedCoverageDependencies() {
  if (authenticatedDependencies === undefined) fail('coverage entry must authenticate dependencies first');
  return authenticatedDependencies;
}

export function verifyAuthenticatedCoverageDependencies(expected) {
  const current = currentDependencyReceipt();
  if (
    current.compiledCoreDigest !== expected.compiledCoreDigest ||
    current.coverageImplementationDigest !== expected.coverageImplementationDigest
  ) {
    fail('dependencies changed while loading the coverage implementation');
  }
}
