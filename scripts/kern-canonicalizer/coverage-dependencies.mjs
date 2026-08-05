import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reconstructHistoricalSource } from './historical-source.mjs';
import { PRE_M4135_COMPILED_EXPRESSION_REPLACEMENTS } from './new-expression-structural-target.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const COMPILED_CORE_ROOT = resolve(ROOT, 'packages/core/dist');
const IMPLEMENTATION_ROOT = resolve(ROOT, 'scripts/kern-canonicalizer');
const M4145_SUCCESSOR_COMPILED_CORE_INVENTORY = Object.freeze({
  count: 307,
  digest: 'ee23cb36b34cc20a6f16a6c89cb83f6ba0d87e0d5e5a62e74fa3def18f78d191',
});
const POST_M4145_COMPILED_CORE_PATHS = Object.freeze([
  'kir-structural/runtime-inflate.js',
  'runtime-envelope/kir-handler.js',
]);

let authenticatedDependencies;

function fail(message) {
  throw new TypeError(`coverage dependency rejection: ${message}`);
}

function hashFramedFiles(root, paths, overrides = new Map()) {
  const canonicalRoot = realpathSync(root);
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) {
    const path = resolve(canonicalRoot, name);
    const stat = lstatSync(path);
    const real = realpathSync(path);
    const relativePath = relative(canonicalRoot, real);
    const escaped = relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
    if (!stat.isFile() || real !== path || escaped) fail(`${name} must be a contained regular file`);
    const bytes = overrides.get(name) ?? readFileSync(path);
    hash.update(`${name.length}:${name}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function hashPathInventory(paths) {
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) hash.update(`${name.length}:${name}`);
  return hash.digest('hex');
}

function assertCanonicalRelativeJavaScriptPaths(paths, label) {
  if (!Array.isArray(paths)) {
    fail(`${label} must be an array`);
  }
  const seen = new Set();
  for (const name of paths) {
    const segments = typeof name === 'string' ? name.split('/') : [];
    if (
      segments.length === 0 ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !name.endsWith('.js') ||
      isAbsolute(name) ||
      name.includes('\\') ||
      seen.has(name)
    ) {
      fail(`${label} must contain unique normalized relative JavaScript paths`);
    }
    seen.add(name);
  }
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

function compiledCoreJavaScriptPaths() {
  const stat = lstatSync(COMPILED_CORE_ROOT);
  if (!stat.isDirectory()) fail('compiled core root must be a regular directory');
  const canonicalRoot = realpathSync(COMPILED_CORE_ROOT);
  const paths = compiledJavaScriptFiles(canonicalRoot)
    .map((path) => relative(canonicalRoot, path).split(sep).join('/'));
  if (paths.length === 0) fail('compiled core JavaScript must not be empty');
  assertCanonicalRelativeJavaScriptPaths(paths, 'compiled core inventory');
  return { canonicalRoot, paths };
}

export function reconstructM4145CompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths, 'M4.145 successor compiled core inventory');
  if (
    paths.length !== M4145_SUCCESSOR_COMPILED_CORE_INVENTORY.count ||
    hashPathInventory(paths) !== M4145_SUCCESSOR_COMPILED_CORE_INVENTORY.digest
  ) {
    fail('M4.145 historical membership requires the authenticated successor inventory');
  }
  assertCanonicalRelativeJavaScriptPaths(
    POST_M4145_COMPILED_CORE_PATHS,
    'post-M4.145 compiled core paths',
  );
  const successors = new Set(POST_M4145_COMPILED_CORE_PATHS);
  if (POST_M4145_COMPILED_CORE_PATHS.some((path) => !paths.includes(path))) {
    fail('post-M4.145 compiled core paths must exist in the authenticated successor inventory');
  }
  const historicalPaths = paths.filter((path) => !successors.has(path));
  if (historicalPaths.length + successors.size !== paths.length) {
    fail('M4.145 historical membership must remove every successor path exactly once');
  }
  return historicalPaths;
}

function m4145CompiledCoreJavaScriptPaths() {
  const { canonicalRoot, paths } = compiledCoreJavaScriptPaths();
  const historicalPaths = reconstructM4145CompiledCoreJavaScriptPaths(paths);
  return { canonicalRoot, paths: historicalPaths };
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
  const { canonicalRoot, paths } = compiledCoreJavaScriptPaths();
  return hashFramedFiles(canonicalRoot, paths);
}

export function digestM4145CompiledCoreJavaScript() {
  const { canonicalRoot, paths } = m4145CompiledCoreJavaScriptPaths();
  return hashFramedFiles(canonicalRoot, paths);
}

export function digestPreM4135CompiledCoreJavaScript() {
  const relativePath = 'kir-structural/expression.js';
  const currentSource = readFileSync(resolve(COMPILED_CORE_ROOT, relativePath));
  const historicalSource = reconstructHistoricalSource({
    currentSource,
    expectedDigest: 'b2f2383c9eb6ecfde619a3191dc539be1b33776af6f32f8c4001cb30449c2032',
    milestone: 'pre-M4.135 compiled structural expression',
    replacements: PRE_M4135_COMPILED_EXPRESSION_REPLACEMENTS,
  });
  const { canonicalRoot, paths } = m4145CompiledCoreJavaScriptPaths();
  return hashFramedFiles(canonicalRoot, paths, new Map([[relativePath, historicalSource]]));
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
