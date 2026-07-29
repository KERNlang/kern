import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertM4123KirDepthPromotion,
  m4123ActiveKirLimits,
  m4123ParameterMigration,
} from './coverage-m4-123-kir-depth-promotion.mjs';
import { loadCanonicalizerKirDepthHeadroomM4122 } from './kir-depth-headroom-m4-122.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const M4122_RECEIPT_DIGEST =
  'e9b5e413a81d5c2992cd31eb705728608407e934d0f7c5c3d765865e65ad290e';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker.kern#2:rejectLine';

test('M4.123 promotes only the authenticated structural KIR depth', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(assertM4123KirDepthPromotion(policy), {
    maxBytes: 262_144,
    maxDepth: 77,
    maxNodes: 4_096,
  });
  assert.deepEqual(m4123ActiveKirLimits(), {
    maxBytes: 262_144,
    maxDepth: 77,
    maxNodes: 4_096,
  });
  assert.deepEqual(policy.profileLimits, {
    maxNodeRows: 202,
    maxPropertyRows: 308,
    maxValueRows: 4_493,
  });
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
});

test('M4.123 consumes the exact immutable M4.122 GO', () => {
  const receiptBytes = readFileSync(
    new URL('./kir-depth-headroom-m4-122.json', import.meta.url),
  );
  const receipt = loadCanonicalizerKirDepthHeadroomM4122();
  assert.equal(createHash('sha256').update(receiptBytes).digest('hex'), M4122_RECEIPT_DIGEST);
  assert.deepEqual(receipt.promotion, {
    disposition: 'approved-with-headroom',
    kirDepthPromotionApproved: true,
    nextMilestone: 'M4.123',
    requiredDepth: 77,
  });
  assert.deepEqual(receipt.limits.activeKir, {
    maxBytes: 262_144,
    maxDepth: 76,
    maxNodes: 4_096,
  });
  assert.deepEqual(receipt.limits.candidateKir, m4123ActiveKirLimits());
  assert.equal(receipt.limits.runtimeMaxDepth, 64);
});

test('M4.123 publishes the exact one-function five-row M4.124 queue', () => {
  const queue = m4123ParameterMigration();
  assert.deepEqual(queue, {
    completeFunctions: 1,
    completeTools: 1,
    migratedParameterRows: 5,
    witnesses: [{
      id: WITNESS_ID,
      parameterRows: 5,
      profileRows: { nodes: 8, properties: 15, values: 106 },
      tool: 'checker',
    }],
  });
});

test('M4.123 queue copies cannot mutate the published handoff', () => {
  const first = m4123ParameterMigration();
  first.witnesses[0].id = 'substituted';
  first.witnesses.reverse();
  assert.notDeepEqual(first, m4123ParameterMigration());
});
