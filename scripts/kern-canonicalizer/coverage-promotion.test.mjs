import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectCanonicalExpressionKinds,
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
  validateCoveragePolicy,
} from './coverage.mjs';
import { baseExpressionProfileBlockers, profileBlockersForFunction } from './coverage-profile.mjs';
import { canonicalizerFunctionCompletes } from './coverage-selection.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.5c';
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
const CALL_PROMOTION = {
  family: 'call-expression',
  selectionProvenanceDigest: CALL_PROVENANCE_DIGEST,
};

test('M4.5c promotes the measured call family into one exact cumulative profile', () => {
  const policy = loadCoveragePolicy();
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.2');
  assert.equal(policy.base.id, PROFILE_ID);
  assert.deepEqual(policy.base.nodeKinds, ['else', 'fn', 'handler', 'if', 'param', 'return']);
  assert.deepEqual(policy.base.expressionKinds, [
    'binary', 'boolean', 'call', 'identifier', 'integer', 'list', 'null', 'text',
  ]);
  assert.deepEqual(policy.base.promotions, [BINARY_PROMOTION, CONDITIONAL_PROMOTION, CALL_PROMOTION]);
  assert.equal(policy.families.some(({ id }) => id === 'binary-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'conditional'), false);
  assert.equal(policy.families.some(({ id }) => id === 'call-expression'), false);

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

test('M4.5c rejects profile identity, facts, evidence, and candidate overlap drift', () => {
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
    (copy) => { copy.base.promotions[2].selectionProvenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions.reverse(); },
    (copy) => { copy.base.promotions.push(structuredClone(BINARY_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(CONDITIONAL_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(CALL_PROMOTION)); },
    (copy) => {
      copy.families.unshift({
        expressionKinds: ['call'],
        id: 'call-expression',
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

function expression(kind, fields) {
  return {
    tag: 'record',
    value: [
      {
        key: 'fields',
        value: {
          tag: 'record',
          value: Object.entries(fields).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([key, value]) => ({ key, value })),
        },
      },
      { key: 'kind', value: { tag: 'text', value: kind } },
    ],
  };
}

const identifier = (name) => expression('identifier', { name: { tag: 'text', value: name } });
const call = (callee, args = [], optional = { tag: 'bool', value: false }) => expression('call', {
  args: { tag: 'list', value: args },
  callee,
  optional,
});

function baseCompletionProfile(base) {
  const nodeKinds = new Set(base.nodeKinds);
  return {
    baseNodeKinds: nodeKinds,
    expressionKinds: new Set(base.expressionKinds),
    nodeKinds,
    propertyKeys: new Set(),
    statementNodeKinds: new Set(),
  };
}

function expressionOnlyFact(expressionKinds) {
  return {
    excludedProperties: [],
    expressionKinds,
    handlerChildProfiles: [],
    nodeKinds: [],
    nodeOccurrences: [],
    profileBlockers: [],
    profileRows: { nodes: 0, properties: 0, values: 0 },
    propertyKeys: [],
    propertyOccurrences: [],
  };
}

test('the promoted call profile admits only exact recursive non-optional calls', () => {
  const base = loadCoveragePolicy().base;
  const valid = call(call(identifier('f')), [call(identifier('g'), [identifier('x')])]);
  assert.deepEqual(baseExpressionProfileBlockers(valid, base), []);
  assert.deepEqual(
    baseExpressionProfileBlockers(call(identifier('f'), [], { tag: 'bool', value: true }), base),
    ['expression.call.optional'],
  );
  assert.deepEqual(
    baseExpressionProfileBlockers(call(call(identifier('f'), [], { tag: 'bool', value: true })), base),
    ['expression.call.optional'],
  );
  for (const malformed of [
    expression('call', { args: { tag: 'list', value: [] }, callee: identifier('f') }),
    call(identifier('f'), [], { tag: 'text', value: 'false' }),
    expression('call', {
      args: { tag: 'list', value: [] },
      callee: identifier('f'),
      future: { tag: 'null' },
      optional: { tag: 'bool', value: false },
    }),
  ]) {
    assert.deepEqual(baseExpressionProfileBlockers(malformed, base), ['expression.call.shape']);
  }
});

test('the promoted call profile keeps member and index dependencies outside the base', () => {
  const base = loadCoveragePolicy().base;
  const optional = { tag: 'bool', value: false };
  const member = expression('member', {
    object: identifier('service'),
    optional,
    property: { tag: 'text', value: 'run' },
  });
  const index = expression('index', {
    index: expression('integer', { value: { tag: 'int', value: '0' } }),
    object: identifier('items'),
    optional,
  });
  for (const candidate of [call(member), call(identifier('consume'), [index])]) {
    assert.deepEqual(baseExpressionProfileBlockers(candidate, base), []);
    const expressionKinds = [...new Set(collectCanonicalExpressionKinds(candidate))];
    assert.equal(
      canonicalizerFunctionCompletes(
        baseCompletionProfile(base),
        expressionOnlyFact(expressionKinds),
        loadCanonicalizerPolicy().profileLimits,
      ),
      false,
    );
  }
});

test('a future base expression kind fails closed until it has an exact local profile', () => {
  const base = structuredClone(loadCoveragePolicy().base);
  base.expressionKinds.push('member');
  const member = expression('member', {
    object: identifier('service'),
    optional: { tag: 'bool', value: false },
    property: { tag: 'text', value: 'run' },
  });
  assert.deepEqual(baseExpressionProfileBlockers(member, base), ['expression.member.profile']);
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
