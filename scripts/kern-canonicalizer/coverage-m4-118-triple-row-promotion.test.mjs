import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertM4118TripleRowPromotion,
  m4118ActiveProfile,
  m4118ParameterMigration,
} from './coverage-m4-118-triple-row-promotion.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const M4117_RECEIPT_DIGEST =
  '125529edf09c4523e778288052c3b66cf08c8099a4f0d18ef25038cb64b54778';

test('M4.118 promotes only the authenticated triple-row profile', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(assertM4118TripleRowPromotion(policy), {
    maxNodeRows: 122,
    maxPropertyRows: 193,
    maxValueRows: 2411,
  });
  assert.deepEqual(m4118ActiveProfile(), policy.profileLimits);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
  assert.equal(policy.kirLimits.maxDepth, 76);
});

test('M4.118 publishes the exact checkModule parameter queue', () => {
  assert.deepEqual(m4118ParameterMigration(), {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 58,
    witnesses: [{
      id: 'examples/capstone-checker-subset/checker.kern#24:checkModule',
      parameterRows: 58,
      profileRows: { nodes: 122, properties: 193, values: 2411 },
      tool: 'checker',
    }],
  });
});

test('M4.118 pins its exact M4.117 runtime input', () => {
  const bytes = readFileSync(new URL('./runtime-cost-m4-117.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), M4117_RECEIPT_DIGEST);
});

test('M4.118 queue copies cannot mutate the published handoff', () => {
  const first = m4118ParameterMigration();
  first.witnesses[0].id = 'substituted';
  first.witnesses.reverse();
  assert.notDeepEqual(first, m4118ParameterMigration());
});
