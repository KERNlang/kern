import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertM4112KirDepthPromotion,
  m4112ActiveKirLimits,
  m4112ParameterMigration,
} from './coverage-m4-112-kir-depth-promotion.mjs';
import { loadCanonicalizerKirDepthHeadroomM4111 } from './kir-depth-headroom-m4-111.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const M4111_RECEIPT_DIGEST =
  '0acd91174c05caa96587876209abe1e3aa8744d3d8643204d07028c3e0526be9';

test('M4.112 promotes only the authenticated structural KIR depth', () => {
  const policy = loadCanonicalizerPolicy();
  assert.deepEqual(assertM4112KirDepthPromotion(policy), {
    maxBytes: 262_144,
    maxDepth: 76,
    maxNodes: 4_096,
  });
  assert.deepEqual(m4112ActiveKirLimits(), {
    maxBytes: 262_144,
    maxDepth: 76,
    maxNodes: 4_096,
  });
  assert.equal(policy.kirLimits.maxDepth, 77);
  assert.equal(policy.runtimeLimits.maxCollectionLength, 65_536);
  assert.equal(policy.runtimeLimits.maxDepth, 64);
});

test('M4.112 consumes the exact immutable M4.111 GO', () => {
  const receiptBytes = readFileSync(
    new URL('./kir-depth-headroom-m4-111.json', import.meta.url),
  );
  const receipt = loadCanonicalizerKirDepthHeadroomM4111();
  assert.equal(createHash('sha256').update(receiptBytes).digest('hex'), M4111_RECEIPT_DIGEST);
  assert.deepEqual(receipt.promotion, {
    disposition: 'approved-with-headroom',
    kirDepthPromotionApproved: true,
    nextMilestone: 'M4.112',
    requiredDepth: 76,
  });
  assert.deepEqual(receipt.limits.activeKir, {
    maxBytes: 262_144,
    maxDepth: 64,
    maxNodes: 4_096,
  });
  assert.deepEqual(receipt.limits.candidateKir, m4112ActiveKirLimits());
  assert.equal(receipt.limits.runtimeMaxDepth, 64);
});

test('M4.112 publishes the exact nine-function 134-row M4.113 queue', () => {
  const queue = m4112ParameterMigration();
  assert.equal(queue.completeFunctions, 9);
  assert.equal(queue.completeTools, 4);
  assert.equal(queue.migratedParameterRows, 134);
  assert.deepEqual(
    queue.witnesses.map(({ id, parameterRows, tool }) => ({ id, parameterRows, tool })),
    [
      {
        id: 'examples/capstone-assertion-engine/compare.kern#2:compareList',
        parameterRows: 13,
        tool: 'assertion-engine',
      },
      {
        id: 'examples/capstone-assertion-engine/compare.kern#3:compareMap',
        parameterRows: 13,
        tool: 'assertion-engine',
      },
      {
        id: 'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
        parameterRows: 12,
        tool: 'checker',
      },
      {
        id: 'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
        parameterRows: 16,
        tool: 'checker',
      },
      {
        id: 'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
        parameterRows: 23,
        tool: 'checker',
      },
      {
        id: 'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
        parameterRows: 9,
        tool: 'checker',
      },
      {
        id: 'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
        parameterRows: 12,
        tool: 'checker',
      },
      {
        id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
        parameterRows: 15,
        tool: 'canonicalizer',
      },
      {
        id: 'examples/selfhost-validator/validator.kern#15:exportkind',
        parameterRows: 21,
        tool: 'validator',
      },
    ],
  );
  assert.equal(
    queue.witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0),
    134,
  );
});

test('M4.112 queue copies cannot mutate the published handoff', () => {
  const first = m4112ParameterMigration();
  first.witnesses[0].id = 'substituted';
  first.witnesses.reverse();
  assert.notDeepEqual(first, m4112ParameterMigration());
});
