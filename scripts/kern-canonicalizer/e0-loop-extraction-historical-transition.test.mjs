import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION,
  reconstructE0LoopExtractionCompiledCoreJavaScriptPaths,
  validateE0LoopExtractionHistoricalTransition,
} from './e0-loop-extraction-historical-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST_ROOT = resolve(ROOT, 'packages/core/dist');

function sourcePathFor(addedPath) {
  return `packages/core/src/${addedPath.replace(/\.js$/u, '.ts')}`;
}

function treeEntry(commit, path) {
  const listing = execFileSync('git', ['ls-tree', '--name-only', commit, '--', path], { cwd: ROOT, encoding: 'utf8' });
  return listing.trim() === path ? 'present' : 'absent';
}

function compiledPaths() {
  const files = [];
  (function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  })(DIST_ROOT);
  return files.map((path) => relative(DIST_ROOT, path).split(sep).join('/')).sort();
}

test('E.0 loop extraction transition has immutable identity', () => {
  assert.equal(validateE0LoopExtractionHistoricalTransition(), true);
  assert.equal(E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION.currentInventory.count, 360);
  assert.equal(E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION.predecessorInventory.count, 357);
  assert.throws(
    () =>
      validateE0LoopExtractionHistoricalTransition({
        ...E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION,
        claim: 'tampered',
      }),
    /immutable identity changed/u,
  );
});

test('E.0 loop extraction reconstructor rejects malformed inventories', () => {
  assert.throws(
    () => reconstructE0LoopExtractionCompiledCoreJavaScriptPaths('not-an-array'),
    /coverage dependency rejection/u,
  );
  const live = compiledPaths();
  for (const malformed of [
    [...live, 'kir-runtime/extra.js'],
    live.slice(1),
    [...live, live[0]],
    [...live.slice(1), '../escaping.js'],
    [...live.slice(1), 'kir-runtime\\backslashed.js'],
  ]) {
    assert.throws(
      () => reconstructE0LoopExtractionCompiledCoreJavaScriptPaths(malformed),
      /coverage dependency rejection/u,
    );
  }
});

test('E.0 loop extraction reconstructs the authenticated D.0 successor inventory', () => {
  const predecessor = reconstructE0LoopExtractionCompiledCoreJavaScriptPaths(compiledPaths());
  assert.equal(predecessor.length, 357);
  for (const added of E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION.addedPaths) {
    assert.equal(predecessor.includes(added), false, `${added} leaked into the predecessor inventory`);
  }
});

test('none of the three extracted modules exists at the predecessor commit', () => {
  const transition = E0_LOOP_EXTRACTION_COMPILED_SUCCESSOR_TRANSITION;
  for (const addedPath of transition.addedPaths) {
    const path = sourcePathFor(addedPath);
    assert.equal(treeEntry(transition.predecessorCommit, path), 'absent', path);
  }
});
