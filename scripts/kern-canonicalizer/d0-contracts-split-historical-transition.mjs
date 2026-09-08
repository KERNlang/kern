import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const CLAIM = 'kern.kir-runtime.linked-kir-program.split.v1';

export const D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: '7a45f4896158ac162d050293061830dc39185599',
  successorCommit: '87ca787416eab0b2bb1b92b759ed0f4f1ab16a98',
  currentInventory: Object.freeze({
    count: 357,
    digest: 'fd1b58b4bc9979defe56533170c1969b709aeb375b147920b5838a312b5fa79e',
  }),
  predecessorInventory: Object.freeze({
    count: 354,
    digest: '78ab887dbbf137326046a27fcabe4da3cc0adead7586005ce4b5987773a21ecb',
  }),
  addedPaths: Object.freeze([
    'kir-runtime/linked-kir-program/link-support.js',
    'kir-runtime/linked-kir-program/statements.js',
    'kir-runtime/linked-kir-program/walkers.js',
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
  if (!Array.isArray(paths)) fail('D.0 contracts split successor compiled core inventory must be an array');
  const seen = new Set();
  for (const name of paths) {
    const segments = typeof name === 'string' ? name.split('/') : [];
    if (
      segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !name.endsWith('.js') || isAbsolute(name) || name.includes('\\') || seen.has(name)
    ) fail('D.0 contracts split successor inventory must contain unique normalized JavaScript paths');
    seen.add(name);
  }
}

export function validateD0ContractsSplitHistoricalTransition(
  candidate = D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION,
) {
  if (!hasExactOwnDataPropertyTree(candidate, D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION)) {
    throw new TypeError('D.0 contracts split historical transition immutable identity changed');
  }
  return true;
}

export function reconstructD0ContractsSplitCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths);
  validateD0ContractsSplitHistoricalTransition();
  const transition = D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION;
  if (paths.length !== transition.currentInventory.count || hashPathInventory(paths) !== transition.currentInventory.digest) {
    fail('D.0 contracts split historical membership requires the authenticated current inventory');
  }
  const addedPaths = new Set(transition.addedPaths);
  const predecessorPaths = paths.filter((path) => !addedPaths.has(path));
  if (
    predecessorPaths.length !== transition.predecessorInventory.count ||
    hashPathInventory(predecessorPaths) !== transition.predecessorInventory.digest
  ) fail('D.0 contracts split predecessor inventory must reproduce the C-PY-1 lowering successor');
  return predecessorPaths;
}
