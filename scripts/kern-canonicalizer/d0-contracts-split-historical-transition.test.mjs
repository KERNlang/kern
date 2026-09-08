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

function gitShowSucceeds(commit, path) {
  try {
    execFileSync('git', ['show', `${commit}:${path}`], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
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

test('D.0 contracts split successor commit actually contains the added modules', () => {
  const transition = D0_CONTRACTS_SPLIT_COMPILED_SUCCESSOR_TRANSITION;
  for (const addedPath of transition.addedPaths) {
    const path = sourcePathFor(addedPath);
    assert.equal(gitShowSucceeds(transition.successorCommit, path), true, path);
    assert.equal(gitShowSucceeds(transition.predecessorCommit, path), false, path);
  }
});
