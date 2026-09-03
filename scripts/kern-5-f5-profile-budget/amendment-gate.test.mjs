import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { PINS } from '../kern-frontend-closure/amend-record.mjs';
import { plan } from '../kern-frontend-closure/amend.mjs';
import { F5_POLICY_PATH, REPO_ROOT, bytes, json, policy, sha256 } from './support.mjs';

const CLOSURE_AMENDMENTS = 'scripts/kern-frontend-closure/amendments';
const CONTRACT_AMENDMENTS = 'scripts/runtime-contract-v1/amendments';

const names = (dir) => readdirSync(resolve(REPO_ROOT, dir)).sort();

test('B5: the closure amendment gate governs composition digests only', () => {
  assert.deepEqual(PINS, { [F5_POLICY_PATH]: 'composition' });
  const governed = new Set(policy().composition.map(({ path }) => path));
  assert.equal(governed.has(F5_POLICY_PATH), false, 'the policy is the pin container, not a pinned path');
  assert.equal(governed.size, policy().composition.length);
});

test('B5: every composition digest still matches its live source', () => {
  for (const { path, sha256: pinned } of policy().composition) {
    assert.equal(sha256(bytes(path)), pinned, path);
  }
});

test('B5: the closure chain verifies with no pending re-pin', () => {
  assert.deepEqual(plan(), []);
});

test('B5: this slice adds no closure amendment record', () => {
  assert.deepEqual(names(CLOSURE_AMENDMENTS), ['chain-anchor.json', 'rt8-integer-signatures.json']);
});

test('B5: this slice adds no runtime-contract-v1 amendment record', () => {
  assert.deepEqual(names(CONTRACT_AMENDMENTS),
    ['chain-anchor.json', 'kern-5-runtime-envelope-max-iterations.json']);
  assert.equal(json('scripts/runtime-contract-v1/lineage.json').versions.length, 1);
});
