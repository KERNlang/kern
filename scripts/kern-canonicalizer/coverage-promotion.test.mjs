import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
  validateCoveragePolicy,
} from './coverage.mjs';
import { baseExpressionProfileBlockers, profileBlockersForFunction } from './coverage-profile.mjs';

const PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.5';
const BINARY_PROVENANCE_DIGEST = '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027';
const CONDITIONAL_PROVENANCE_DIGEST = 'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b';
const CALL_PROVENANCE_DIGEST = '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605';
const BINARY_PROMOTION = {
  family: 'binary-expression',
  selectionProvenanceDigest: BINARY_PROVENANCE_DIGEST,
};
const CONDITIONAL_PROMOTION = {
  family: 'conditional',
  selectionProvenanceDigest: CONDITIONAL_PROVENANCE_DIGEST,
};

test('M4.5 promotes the measured conditional family into one exact cumulative profile', () => {
  const policy = loadCoveragePolicy();
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.2');
  assert.equal(policy.base.id, PROFILE_ID);
  assert.deepEqual(policy.base.nodeKinds, ['else', 'fn', 'handler', 'if', 'param', 'return']);
  assert.deepEqual(policy.base.expressionKinds, [
    'binary', 'boolean', 'identifier', 'integer', 'list', 'null', 'text',
  ]);
  assert.deepEqual(policy.base.promotions, [BINARY_PROMOTION, CONDITIONAL_PROMOTION]);
  assert.equal(policy.families.some(({ id }) => id === 'binary-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'conditional'), false);

  const receipt = measureCanonicalizerCoverage(policy);
  const summary = summarizeCanonicalizerCoverage(receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.coverage-receipt.5');
  assert.deepEqual(receipt.base, policy.base);
  assert.equal(summary.format, 'kern.kir-canonicalizer.coverage-summary.5');
  assert.deepEqual(summary.base, policy.base);
  assert.deepEqual(
    receipt.selectionProvenances.map(({ digest }) => digest),
    [BINARY_PROVENANCE_DIGEST, CONDITIONAL_PROVENANCE_DIGEST, CALL_PROVENANCE_DIGEST],
  );
  assert.equal(receipt.implementationSelectionProvenanceDigest, CALL_PROVENANCE_DIGEST);
});

test('M4.5 rejects profile identity, facts, evidence, and candidate overlap drift', () => {
  const policy = loadCoveragePolicy();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.coverage-policy.1'; },
    (copy) => { copy.base.future = true; },
    (copy) => { copy.base.id = 'kern.kir-canonicalizer.profile.future'; },
    (copy) => { copy.base.expressionKinds.shift(); },
    (copy) => { copy.base.nodeKinds.shift(); },
    (copy) => { copy.base.promotions.pop(); },
    (copy) => { copy.base.promotions[0].selectionProvenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[1].selectionProvenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions.reverse(); },
    (copy) => { copy.base.promotions.push(structuredClone(BINARY_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(CONDITIONAL_PROMOTION)); },
    (copy) => {
      copy.families.unshift({
        expressionKinds: [],
        id: 'conditional',
        nodeKinds: ['else', 'if'],
        propertyKeys: ['if.cond'],
      });
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(policy);
    mutate(copy);
    assert.throws(() => validateCoveragePolicy(copy), /coverage policy rejection/u);
  }
});

test('the promoted conditional profile rejects malformed shape and pairing', () => {
  const policy = loadCoveragePolicy();
  const returned = (value) => ({ children: [], props: { value }, type: 'return' });
  const conditional = {
    children: [returned('1')],
    props: { cond: 'flag' },
    type: 'if',
  };
  const alternate = {
    children: [returned('0')],
    props: {},
    type: 'else',
  };
  const functionRoot = {
    children: [{ children: [conditional, alternate], props: { lang: 'kern' }, type: 'handler' }],
    props: { name: 'choose', returns: 'number' },
    type: 'fn',
  };
  assert.deepEqual(profileBlockersForFunction(functionRoot, policy.base), []);
  const standalone = structuredClone(functionRoot);
  standalone.children[0].children = [standalone.children[0].children[0], returned('2')];
  assert.deepEqual(profileBlockersForFunction(standalone, policy.base), []);

  const mutations = [
    (copy) => { delete copy.children[0].children[0].props.cond; },
    (copy) => { copy.children[0].children[1].props.future = 'x'; },
    (copy) => { copy.children[0].children.reverse(); },
    (copy) => { copy.children[0].children.unshift(returned('2')); },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(functionRoot);
    mutate(copy);
    assert.notDeepEqual(profileBlockersForFunction(copy, policy.base), []);
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
