import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
  validateCoveragePolicy,
} from './coverage.mjs';
import { baseExpressionProfileBlockers } from './coverage-profile.mjs';

const PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.3c';
const PROVENANCE_DIGEST = '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027';
const BINARY_PROMOTION = {
  family: 'binary-expression',
  selectionProvenanceDigest: PROVENANCE_DIGEST,
};

test('M4.3c promotes the measured binary family into one exact cumulative profile', () => {
  const policy = loadCoveragePolicy();
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.2');
  assert.equal(policy.base.id, PROFILE_ID);
  assert.deepEqual(policy.base.expressionKinds, [
    'binary', 'boolean', 'identifier', 'integer', 'list', 'null', 'text',
  ]);
  assert.deepEqual(policy.base.promotions, [BINARY_PROMOTION]);
  assert.equal(policy.families.some(({ id }) => id === 'binary-expression'), false);

  const receipt = measureCanonicalizerCoverage(policy);
  const summary = summarizeCanonicalizerCoverage(receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.coverage-receipt.4');
  assert.deepEqual(receipt.base, policy.base);
  assert.equal(summary.format, 'kern.kir-canonicalizer.coverage-summary.4');
  assert.deepEqual(summary.base, policy.base);
  assert.equal(receipt.selectionProvenance.digest, PROVENANCE_DIGEST);
});

test('M4.3c rejects profile identity, facts, evidence, and candidate overlap drift', () => {
  const policy = loadCoveragePolicy();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.coverage-policy.1'; },
    (copy) => { copy.base.future = true; },
    (copy) => { copy.base.id = 'kern.kir-canonicalizer.profile.future'; },
    (copy) => { copy.base.expressionKinds.shift(); },
    (copy) => { copy.base.promotions = []; },
    (copy) => { copy.base.promotions[0].selectionProvenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions.push(structuredClone(BINARY_PROMOTION)); },
    (copy) => {
      copy.families.unshift({
        expressionKinds: ['binary'],
        id: 'binary-expression',
        nodeKinds: [],
        propertyKeys: [],
      });
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCoveragePolicy(copy), /coverage policy rejection/u);
  }
});

test('the promoted binary profile rejects malformed shape and operators', () => {
  const policy = loadCoveragePolicy();
  const identifier = {
    tag: 'record',
    value: [
      { key: 'fields', value: { tag: 'record', value: [{ key: 'name', value: { tag: 'text', value: 'x' } }] } },
      { key: 'kind', value: { tag: 'text', value: 'identifier' } },
    ],
  };
  const binary = (fields) => ({
    tag: 'record',
    value: [
      { key: 'fields', value: { tag: 'record', value: fields } },
      { key: 'kind', value: { tag: 'text', value: 'binary' } },
    ],
  });
  const invalidOperator = binary([
    { key: 'left', value: identifier },
    { key: 'op', value: { tag: 'text', value: 'not-an-operator' } },
    { key: 'right', value: identifier },
  ]);
  const missingRight = binary([
    { key: 'left', value: identifier },
    { key: 'op', value: { tag: 'text', value: '+' } },
  ]);
  assert.deepEqual(baseExpressionProfileBlockers(invalidOperator, policy.base), ['expression.binary.shape']);
  assert.deepEqual(baseExpressionProfileBlockers(missingRight, policy.base), ['expression.binary.shape']);
});
