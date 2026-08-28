import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const CLAIM = 'kern.compiler.kir-js-esm.owner.v1';

export const R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: 'a8f5e9a7c8632faed10dd301056d1260928c9026',
  successorCommit: '41f6c5ec5479e76b61a7401db04c5c08cc2b4394',
  currentInventory: Object.freeze({
    count: 346,
    digest: '03f9dedb11af11fe4b6126d34ebd3bfc0a046f940bdea5f64ec9f9e2570206af',
  }),
  predecessorInventory: Object.freeze({
    count: 332,
    digest: '2258d6442315b54ad81f27f387ffa0c43239e28e442d0452efe0504f6d8e9bd2',
  }),
  addedPaths: Object.freeze([
    'compiler-kir-js-esm.js',
    'compiler/kir-js-esm/contracts.js',
    'compiler/kir-js-esm/emitter.js',
    'compiler/kir-js-esm/index.js',
    'compiler/kir-js-esm/request.js',
    'compiler/kir-js-esm/target-base.js',
    'compiler/kir-js-esm/target-execution.js',
    'compiler/kir-js-esm/target-hash.js',
    'compiler/kir-js-esm/target-json.js',
    'kir-runtime/digest.js',
    'kir-runtime/linked-kir-program/contracts.js',
    'kir-runtime/linked-kir-program/expression.js',
    'kir-runtime/linked-kir-program/index.js',
    'kir-runtime/linked-kir-program/link.js',
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
  if (!Array.isArray(paths)) fail('R2 JavaScript lowering successor compiled core inventory must be an array');
  const seen = new Set();
  for (const name of paths) {
    const segments = typeof name === 'string' ? name.split('/') : [];
    if (
      segments.length === 0 || segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      !name.endsWith('.js') || isAbsolute(name) || name.includes('\\') || seen.has(name)
    ) fail('R2 JavaScript lowering successor inventory must contain unique normalized JavaScript paths');
    seen.add(name);
  }
}

export function validateR2JavaScriptLoweringHistoricalTransition(
  candidate = R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION,
) {
  if (!hasExactOwnDataPropertyTree(candidate, R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION)) {
    throw new TypeError('R2 JavaScript lowering historical transition immutable identity changed');
  }
  return true;
}

export function reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths);
  validateR2JavaScriptLoweringHistoricalTransition();
  const transition = R2_JS_LOWERING_COMPILED_SUCCESSOR_TRANSITION;
  if (paths.length !== transition.currentInventory.count || hashPathInventory(paths) !== transition.currentInventory.digest) {
    fail('R2 JavaScript lowering historical membership requires the authenticated current inventory');
  }
  const addedPaths = new Set(transition.addedPaths);
  const predecessorPaths = paths.filter((path) => !addedPaths.has(path));
  if (
    predecessorPaths.length !== transition.predecessorInventory.count ||
    hashPathInventory(predecessorPaths) !== transition.predecessorInventory.digest
  ) fail('R2 JavaScript lowering predecessor inventory must reproduce the R1 runtime-owner successor');
  return predecessorPaths;
}
