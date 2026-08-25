import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

const CLAIM = 'kern.frontend.projection-packaging.r0';

export const FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION = Object.freeze({
  claim: CLAIM,
  predecessorCommit: '80f22655fa4cca12ba752f899564c9427f191508',
  successorCommit: 'c33c3f530ccde0e43f12a176e05fd7c4b5a6d75c',
  currentInventory: Object.freeze({
    count: 322,
    digest: '7acc8276003ea732f7ae3e18d4feddb235d6726a4277828e704599ea35e1cefa',
  }),
  predecessorInventory: Object.freeze({
    count: 318,
    digest: '601fce8b504c09757523253d616fbaf118b1b17064d7b1ae9f91d3395fa32d93',
  }),
  addedPaths: Object.freeze([
    'frontend-projection.js',
    'frontend-projection/assets.js',
    'frontend-projection/contracts.js',
    'frontend-projection/integrity.js',
  ]),
});

const EXACT_TRANSITION = JSON.stringify(FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION);

function fail(message) {
  throw new TypeError(`coverage dependency rejection: ${message}`);
}

function hashPathInventory(paths) {
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) hash.update(`${name.length}:${name}`);
  return hash.digest('hex');
}

function assertCanonicalRelativeJavaScriptPaths(paths) {
  if (!Array.isArray(paths)) {
    fail('frontend projection successor compiled core inventory must be an array');
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
      fail('frontend projection successor inventory must contain unique normalized JavaScript paths');
    }
    seen.add(name);
  }
}

export function validateFrontendProjectionHistoricalTransition(
  candidate = FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION,
) {
  if (JSON.stringify(candidate) !== EXACT_TRANSITION) {
    throw new TypeError('frontend projection historical transition immutable identity changed');
  }
  return true;
}

export function reconstructFrontendProjectionCompiledCoreJavaScriptPaths(paths) {
  assertCanonicalRelativeJavaScriptPaths(paths);
  validateFrontendProjectionHistoricalTransition();
  const transition = FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION;
  if (
    paths.length !== transition.currentInventory.count ||
    hashPathInventory(paths) !== transition.currentInventory.digest
  ) {
    fail('frontend projection historical membership requires the authenticated current inventory');
  }
  const addedPaths = new Set(transition.addedPaths);
  const predecessorPaths = paths.filter((path) => !addedPaths.has(path));
  if (
    predecessorPaths.length !== transition.predecessorInventory.count ||
    hashPathInventory(predecessorPaths) !== transition.predecessorInventory.digest
  ) {
    fail('frontend projection predecessor inventory must reproduce the runner-call-cache successor');
  }
  return predecessorPaths;
}
