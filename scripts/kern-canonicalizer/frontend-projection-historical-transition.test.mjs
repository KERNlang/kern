import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  reconstructFrontendProjectionCompiledCoreJavaScriptPaths,
  reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths,
  reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths,
} from './coverage-dependencies.mjs';
import {
  FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION,
  validateFrontendProjectionHistoricalTransition,
} from './frontend-projection-historical-transition.mjs';

const DIST = resolve(process.cwd(), 'packages/core/dist');

function compiledPaths(directory = DIST, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compiledPaths(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(relative(DIST, path).split(sep).join('/'));
    }
  }
  return output.sort();
}

function pathDigest(paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(`${path.length}:${path}`);
  return hash.digest('hex');
}

function r1SuccessorPaths() {
  return reconstructR2JavaScriptLoweringCompiledCoreJavaScriptPaths(compiledPaths());
}

test('frontend projection authenticates its exact 322-to-318 compiled inventory edge', () => {
  assert.equal(validateFrontendProjectionHistoricalTransition(), true);
  const transition = FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION;
  assert.equal(transition.predecessorCommit, '80f22655fa4cca12ba752f899564c9427f191508');
  assert.equal(transition.successorCommit, 'c33c3f530ccde0e43f12a176e05fd7c4b5a6d75c');
  const paths = r1SuccessorPaths();
  const r1RuntimeOwnerPredecessor = reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths(paths);
  assert.deepEqual(
    { count: r1RuntimeOwnerPredecessor.length, digest: pathDigest(r1RuntimeOwnerPredecessor) },
    transition.currentInventory,
  );
  const predecessor = reconstructFrontendProjectionCompiledCoreJavaScriptPaths(r1RuntimeOwnerPredecessor);
  assert.deepEqual(
    { count: predecessor.length, digest: pathDigest(predecessor) },
    transition.predecessorInventory,
  );
  assert.equal(transition.addedPaths.some((path) => predecessor.includes(path)), false);
});

test('frontend projection transition evidence is recursively frozen and immutable', () => {
  const transition = FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION;
  for (const evidence of [
    transition,
    transition.currentInventory,
    transition.predecessorInventory,
    transition.addedPaths,
  ]) {
    assert.equal(Object.isFrozen(evidence), true);
  }
  assert.throws(
    () => validateFrontendProjectionHistoricalTransition({ ...transition, claim: 'future' }),
    /immutable identity changed/u,
  );
});

test('frontend projection inventory rejects additions, removals, renames, duplicates, and escapes', () => {
  const paths = r1SuccessorPaths();
  const r1RuntimeOwnerPredecessor = reconstructR1RuntimeOwnerCompiledCoreJavaScriptPaths(paths);
  const projectionPath = FRONTEND_PROJECTION_COMPILED_SUCCESSOR_TRANSITION.addedPaths[0];
  const cases = [
    [...r1RuntimeOwnerPredecessor, 'unexpected.js'],
    r1RuntimeOwnerPredecessor.slice(1),
    r1RuntimeOwnerPredecessor.filter((path) => path !== projectionPath),
    r1RuntimeOwnerPredecessor.map((path) => (path === projectionPath ? 'frontend-projection-renamed.js' : path)),
    [...r1RuntimeOwnerPredecessor, r1RuntimeOwnerPredecessor[0]],
    [...r1RuntimeOwnerPredecessor.slice(1), '../escape.js'],
  ];
  for (const candidate of cases) {
    assert.throws(
      () => reconstructFrontendProjectionCompiledCoreJavaScriptPaths(candidate),
      /coverage dependency rejection/u,
    );
  }
});
