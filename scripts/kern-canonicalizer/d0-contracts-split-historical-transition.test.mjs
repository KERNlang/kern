import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION,
  reconstructD0ContractsSplitCompiledCoreJavaScriptPaths,
  validateD0ContractsSplitHistoricalTransition,
} from './d0-contracts-split-historical-transition.mjs';

const ROOT = resolve(process.cwd());

function sourcePathFor(addedPath) {
  return `packages/core/src/${addedPath.replace(/\.js$/u, '.ts')}`;
}

function treeEntry(commit, path) {
  const listing = execFileSync('git', ['ls-tree', '--name-only', commit, '--', path], { cwd: ROOT, encoding: 'utf8' });
  return listing.trim() === path ? 'present' : 'absent';
}

test('D.0 contracts split transition has immutable identity', () => {
  assert.equal(validateD0ContractsSplitHistoricalTransition(), true);
  assert.equal(D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION.currentInventory.count, 357);
  assert.throws(
    () => validateD0ContractsSplitHistoricalTransition({
      ...D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION,
      claim: 'tampered',
    }),
    /immutable identity changed/u,
  );
});

test('D.0 contracts split reconstructor rejects malformed inventories', () => {
  assert.throws(
    () => reconstructD0ContractsSplitCompiledCoreJavaScriptPaths('not-an-array'),
    /coverage dependency rejection/u,
  );
});

test('D.0 contracts split successor commit is the exact commit that added the modules', () => {
  const transition = D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION;
  const parent = `${transition.successorCommit}^`;
  for (const addedPath of transition.addedPaths) {
    const path = sourcePathFor(addedPath);
    assert.equal(treeEntry(transition.successorCommit, path), 'present', path);
    assert.equal(treeEntry(parent, path), 'absent', path);
    assert.equal(treeEntry(transition.predecessorCommit, path), 'absent', path);
  }
});
