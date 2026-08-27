import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const CLAIM = 'kern.runtime.kir.owner.v1';

export const R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: 'aae0a0fe44b1aaba88addcb1995cd66e2af2254d',
  successorCommit: '9e3e9fb40eb73810d6e4ee5af80b85f500a6a9fc',
  currentInventory: Object.freeze({
    count: 332,
    digest: '2258d6442315b54ad81f27f387ffa0c43239e28e442d0452efe0504f6d8e9bd2',
  }),
  predecessorInventory: Object.freeze({
    count: 322,
    digest: '7acc8276003ea732f7ae3e18d4feddb235d6726a4277828e704599ea35e1cefa',
  }),
  addedPaths: Object.freeze([
    'frontend-projection/verified-brand.js',
    'kir-runtime/capability.js',
    'kir-runtime/contracts.js',
    'kir-runtime/deadline.js',
    'kir-runtime/envelope.js',
    'kir-runtime/execute.js',
    'kir-runtime/expression.js',
    'kir-runtime/inspect.js',
    'kir-runtime/json.js',
    'runtime-kir.js',
  ]),
});

function fail(message) {
  throw new TypeError(`coverage dependency rejection: ${message}`);
}

function hasExactOwnDataPropertyTree(candidate, expected) {
  if (Object.is(candidate, expected)) return true;
  if (
    candidate === null ||
    expected === null ||
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
      candidateDescriptor === undefined ||
      expectedDescriptor === undefined ||
      !Object.hasOwn(candidateDescriptor, 'value') ||
      !Object.hasOwn(expectedDescriptor, 'value') ||
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
  if (!Array.isArray(paths)) fail('R1 runtime owner successor compiled core inventory must be an array');
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
    ) fail('R1 runtime owner successor inventory must contain unique normalized JavaScript paths');
    seen.add(name);
  }
}

export function validateR1RuntimeOwnerHistoricalTransition(
  candidate = R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION,
) {
  if (!hasExactOwnDataPropertyTree(candidate, R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION)) {
    throw new TypeError('R1 runtime owner historical transition immutable identity changed');
  }
  return true;
}

export function reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths);
  validateR1RuntimeOwnerHistoricalTransition();
  const transition = R1_RUNTIME_OWNER_COMPILED_SUCCESSOR_TRANSITION;
  if (
    paths.length !== transition.currentInventory.count ||
    hashPathInventory(paths) !== transition.currentInventory.digest
  ) fail('R1 runtime owner historical membership requires the authenticated current inventory');
  const addedPaths = new Set(transition.addedPaths);
  const predecessorPaths = paths.filter((path) => !addedPaths.has(path));
  if (
    predecessorPaths.length !== transition.predecessorInventory.count ||
    hashPathInventory(predecessorPaths) !== transition.predecessorInventory.digest
  ) fail('R1 runtime owner predecessor inventory must reproduce the frontend projection successor');
  return predecessorPaths;
}
