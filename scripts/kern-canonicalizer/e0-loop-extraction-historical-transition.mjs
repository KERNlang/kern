import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const CLAIM = 'kern.kir-runtime.loop-extraction.v1';

// No successorCommit: this record is authored by the commit it would name. The predecessor commit
// is slice D's tip, where none of the three added modules exists yet, and that is what the
// transition oracle checks against the git tree.
export const E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: '2d2167564d23bcbbb417539aeb624a1309cddf60',
  currentInventory: Object.freeze({
    count: 360,
    digest: 'e0f2374725c667b4fc7a0a58a75c8edfd41c5f212425d83ff1e9b0f52d175d9d',
  }),
  predecessorInventory: Object.freeze({
    count: 357,
    digest: 'fd1b58b4bc9979defe56533170c1969b709aeb375b147920b5838a312b5fa79e',
  }),
  addedPaths: Object.freeze([
    'compiler/kir-js-esm/statement-source.js',
    'kir-runtime/linked-kir-program/loop-statements.js',
    'kir-runtime/statement-walker.js',
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
  if (!Array.isArray(paths)) fail('E.0 loop extraction successor compiled core inventory must be an array');
  const seen = new Set();
  for (const name of paths) {
    const segments = typeof name === 'string' ? name.split('/') : [];
    if (
      segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !name.endsWith('.js') || isAbsolute(name) || name.includes('\\') || seen.has(name)
    ) fail('E.0 loop extraction successor inventory must contain unique normalized JavaScript paths');
    seen.add(name);
  }
}

export function validateE0LoopExtractionHistoricalTransition(
  candidate = E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION,
) {
  if (!hasExactOwnDataPropertyTree(candidate, E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION)) {
    throw new TypeError('E.0 loop extraction historical transition immutable identity changed');
  }
  return true;
}

export function reconstructE0LoopExtractionCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths);
  validateE0LoopExtractionHistoricalTransition();
  const transition = E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION;
  if (paths.length !== transition.currentInventory.count || hashPathInventory(paths) !== transition.currentInventory.digest) {
    fail('E.0 loop extraction historical membership requires the authenticated current inventory');
  }
  const addedPaths = new Set(transition.addedPaths);
  const predecessorPaths = paths.filter((path) => !addedPaths.has(path));
  if (
    predecessorPaths.length !== transition.predecessorInventory.count ||
    hashPathInventory(predecessorPaths) !== transition.predecessorInventory.digest
  ) fail('E.0 loop extraction predecessor inventory must reproduce the D.0 contracts split successor');
  return predecessorPaths;
}
