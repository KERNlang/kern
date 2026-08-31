import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const CLAIM = 'kern.compiler.kir-python.owner.v1';

export const C_PY_1_LOWERING_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: '7ec88843d29ac1df257579d44747c9e81bfebcbd',
  successorCommit: '7a45f4896158ac162d050293061830dc39185599',
  currentInventory: Object.freeze({
    count: 354,
    digest: '78ab887dbbf137326046a27fcabe4da3cc0adead7586005ce4b5987773a21ecb',
  }),
  predecessorInventory: Object.freeze({
    count: 346,
    digest: '03f9dedb11af11fe4b6126d34ebd3bfc0a046f940bdea5f64ec9f9e2570206af',
  }),
  addedPaths: Object.freeze([
    'compiler-kir-python.js',
    'compiler/kir-python/contracts.js',
    'compiler/kir-python/emitter.js',
    'compiler/kir-python/index.js',
    'compiler/kir-python/request.js',
    'compiler/kir-python/target-base.js',
    'compiler/kir-python/target-execution.js',
    'compiler/kir-python/target-json.js',
  ]),
});

function fail(message) {
  throw new TypeError(`coverage dependency rejection: ${message}`);
}

function hasExactOwnDataPropertyTree(candidate, expected) {
  if (Object.is(candidate, expected)) return true;
  if (
    candidate === null || expected === null ||
    (typeof candidate !== 'object' && typeof candidate !== 'function') ||
    (typeof expected !== 'object' && typeof expected !== 'function') ||
    Object.getPrototypeOf(candidate) !== Object.getPrototypeOf(expected)
  ) return false;
  const candidateKeys = Reflect.ownKeys(candidate);
  const expectedKeys = Reflect.ownKeys(expected);
  if (candidateKeys.length !== expectedKeys.length) return false;
  for (let index = 0; index < expectedKeys.length; index += 1) {
    if (candidateKeys[index] !== expectedKeys[index]) return false;
    const candidateDescriptor = Object.getOwnPropertyDescriptor(candidate, candidateKeys[index]);
    const expectedDescriptor = Object.getOwnPropertyDescriptor(expected, expectedKeys[index]);
    if (
      candidateDescriptor === undefined || expectedDescriptor === undefined ||
      !Object.hasOwn(candidateDescriptor, 'value') || !Object.hasOwn(expectedDescriptor, 'value') ||
      candidateDescriptor.configurable !== expectedDescriptor.configurable ||
      candidateDescriptor.enumerable !== expectedDescriptor.enumerable ||
      candidateDescriptor.writable !== expectedDescriptor.writable ||
      !hasExactOwnDataPropertyTree(candidateDescriptor.value, expectedDescriptor.value)
    ) return false;
  }
  return true;
}

function hashPathInventory(paths) {
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) hash.update(`${name.length}:${name}`);
  return hash.digest('hex');
}

function assertCanonicalRelativeJavaScriptPaths(paths) {
  if (!Array.isArray(paths)) fail('C-PY-1 lowering successor compiled core inventory must be an array');
  const seen = new Set();
  for (const name of paths) {
    const segments = typeof name === 'string' ? name.split('/') : [];
    if (
      segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !name.endsWith('.js') || isAbsolute(name) || name.includes('\\') || seen.has(name)
    ) fail('C-PY-1 lowering successor inventory must contain unique normalized JavaScript paths');
    seen.add(name);
  }
}

export function validateCPy1LoweringHistoricalTransition(
  candidate = C_PY_1_LOWERING_COMPILED_SUCCESSOR_TRANSITION,
) {
  if (!hasExactOwnDataPropertyTree(candidate, C_PY_1_LOWERING_COMPILED_SUCCESSOR_TRANSITION)) {
    throw new TypeError('C-PY-1 lowering historical transition immutable identity changed');
  }
  return true;
}

export function reconstructCPy1LoweringCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths);
  validateCPy1LoweringHistoricalTransition();
  const transition = C_PY_1_LOWERING_COMPILED_SUCCESSOR_TRANSITION;
  if (paths.length !== transition.currentInventory.count || hashPathInventory(paths) !== transition.currentInventory.digest) {
    fail('C-PY-1 lowering historical membership requires the authenticated current inventory');
  }
  const addedPaths = new Set(transition.addedPaths);
  const predecessorPaths = paths.filter((path) => !addedPaths.has(path));
  if (
    predecessorPaths.length !== transition.predecessorInventory.count ||
    hashPathInventory(predecessorPaths) !== transition.predecessorInventory.digest
  ) fail('C-PY-1 lowering predecessor inventory must reproduce the R2 JavaScript lowering successor');
  return predecessorPaths;
}
