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

const PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.60';
const BINARY_PROVENANCE_DIGEST = '35d0904ddcf41c4d9e1421ea8edba8f215d2db820006d37b2cff5e1d48236027';
const CONDITIONAL_PROVENANCE_DIGEST = 'fe15f0ff4b8b80653ddef7f3b8736f38fa2b34a928d05a32bb9eff4d0f254f2b';
const CALL_PROVENANCE_DIGEST = '7eee28b09785d36539e45293afbe0325fe9b50c20ffc7057e0aa3997d9371605';
const MEMBER_PROVENANCE_DIGEST = '83e045d827f7865bd03003d882baf3fe42d66d998c0daa894a05f534cbf8df2d';
const INDEX_PROVENANCE_DIGEST = '3833955568710b89c7760bc579de5985d09b6c942ff006bac4bcc809757a7869';
const COUNTED_ITERATION_PROVENANCE_DIGEST = 'af26a9ccb4cfa8e320d88b8562a5c20c9e1f009a660a642ca2ae5916eab3c70b';
const BINDING_PROVENANCE_DIGEST = '00f67756052785ece657b451bc22c5f43ce088021cb6c1a48bb83d99ca2343ab';
const UNARY_PROVENANCE_DIGEST = 'e64147e572dff26720b7efae7353583ac2b97b0b37001a9cd835909684dfd9e5';
const DO_PROVENANCE_DIGEST = '3d865f4983e7febd26540db681c88d8749d156f5d180405b831b5ccd7fb54d72';
const WHILE_PROVENANCE_DIGEST = '5583173bffc4c6b4ebd33c245c2b71d1577c12e3bb26626d29a142aaa648cb07';
const BINARY_PROMOTION = {
  family: 'binary-expression',
  provenanceDigest: BINARY_PROVENANCE_DIGEST,
  provenanceKind: 'selection',
};
const CONDITIONAL_PROMOTION = {
  family: 'conditional',
  provenanceDigest: CONDITIONAL_PROVENANCE_DIGEST,
  provenanceKind: 'selection',
};
const CALL_PROMOTION = {
  family: 'call-expression',
  provenanceDigest: CALL_PROVENANCE_DIGEST,
  provenanceKind: 'selection',
};
const MEMBER_PROMOTION = {
  family: 'member-expression',
  provenanceDigest: MEMBER_PROVENANCE_DIGEST,
  provenanceKind: 'selection',
};
const INDEX_PROMOTION = {
  family: 'index-expression',
  provenanceDigest: INDEX_PROVENANCE_DIGEST,
  provenanceKind: 'prerequisite',
};
const COUNTED_ITERATION_PROMOTION = {
  family: 'counted-iteration',
  provenanceDigest: COUNTED_ITERATION_PROVENANCE_DIGEST,
  provenanceKind: 'prerequisite',
};
const BINDING_PROMOTION = {
  family: 'binding',
  provenanceDigest: BINDING_PROVENANCE_DIGEST,
  provenanceKind: 'prerequisite',
};
const UNARY_PROMOTION = {
  family: 'unary-expression',
  provenanceDigest: UNARY_PROVENANCE_DIGEST,
  provenanceKind: 'prerequisite',
};
const DO_PROMOTION = {
  family: 'do-statement',
  provenanceDigest: DO_PROVENANCE_DIGEST,
  provenanceKind: 'prerequisite',
};
const WHILE_PROMOTION = {
  family: 'while-iteration',
  provenanceDigest: WHILE_PROVENANCE_DIGEST,
  provenanceKind: 'prerequisite',
};
test('M4.60 promotes while iteration through exact prerequisite provenance', () => {
  const policy = loadCoveragePolicy();
  assert.equal(policy.format, 'kern.kir-canonicalizer.coverage-policy.3');
  assert.equal(policy.base.id, PROFILE_ID);
  assert.deepEqual(
    policy.base.nodeKinds,
    ['assign', 'do', 'else', 'fn', 'for', 'handler', 'if', 'let', 'param', 'return', 'while'],
  );
  assert.deepEqual(policy.base.expressionKinds, [
    'binary', 'boolean', 'call', 'identifier', 'index', 'integer', 'list', 'member', 'null', 'text', 'unary',
  ]);
  assert.deepEqual(
    policy.base.promotions,
    [
      BINARY_PROMOTION,
      CONDITIONAL_PROMOTION,
      CALL_PROMOTION,
      MEMBER_PROMOTION,
      INDEX_PROMOTION,
      COUNTED_ITERATION_PROMOTION,
      BINDING_PROMOTION,
      UNARY_PROMOTION,
      DO_PROMOTION,
      WHILE_PROMOTION,
    ],
  );
  assert.equal(policy.families.some(({ id }) => id === 'binary-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'conditional'), false);
  assert.equal(policy.families.some(({ id }) => id === 'call-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'member-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'index-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'counted-iteration'), false);
  assert.equal(policy.families.some(({ id }) => id === 'binding'), false);
  assert.equal(policy.families.some(({ id }) => id === 'unary-expression'), false);
  assert.equal(policy.families.some(({ id }) => id === 'do-statement'), false);
  assert.equal(policy.families.some(({ id }) => id === 'while-iteration'), false);
  assert.deepEqual(policy.families.map(({ id }) => id), ['exception-flow', 'new-expression']);
  assert.equal(policy.base.propertyKeys.includes('do.value'), true);
  assert.equal(policy.base.propertyKeys.includes('for.from'), true);
  assert.equal(policy.base.propertyKeys.includes('for.name'), true);
  assert.equal(policy.base.propertyKeys.includes('for.to'), true);
  assert.equal(policy.base.propertyKeys.includes('for.step'), false);
  assert.equal(policy.base.propertyKeys.includes('while.cond'), true);
  for (const property of ['assign.target', 'assign.value', 'let.name', 'let.value']) {
    assert.equal(policy.base.propertyKeys.includes(property), true);
  }
  for (const property of ['assign.op', 'assign.trailingComment', 'let.kind', 'let.trailingComment']) {
    assert.equal(policy.base.propertyKeys.includes(property), false);
  }

  const receipt = measureCanonicalizerCoverage(policy);
  const summary = summarizeCanonicalizerCoverage(receipt);
  assert.equal(receipt.format, 'kern.kir-canonicalizer.coverage-receipt.6');
  assert.deepEqual(receipt.base, policy.base);
  assert.equal(summary.format, 'kern.kir-canonicalizer.coverage-summary.6');
  assert.deepEqual(summary.base, policy.base);
  assert.deepEqual(
    receipt.selectionProvenances.map(({ digest }) => digest),
    [
      BINARY_PROVENANCE_DIGEST,
      CONDITIONAL_PROVENANCE_DIGEST,
      CALL_PROVENANCE_DIGEST,
      MEMBER_PROVENANCE_DIGEST,
    ],
  );
  assert.equal(receipt.implementationSelectionProvenanceDigest, MEMBER_PROVENANCE_DIGEST);
  assert.deepEqual(receipt.implementationProvenance, WHILE_PROMOTION);
  assert.deepEqual(summary.implementationProvenance, WHILE_PROMOTION);
  assert.deepEqual(
    receipt.prerequisiteProvenances.map(({ digest }) => digest),
    [
      INDEX_PROVENANCE_DIGEST,
      COUNTED_ITERATION_PROVENANCE_DIGEST,
      BINDING_PROVENANCE_DIGEST,
      UNARY_PROVENANCE_DIGEST,
      DO_PROVENANCE_DIGEST,
      WHILE_PROVENANCE_DIGEST,
    ],
  );
  assert.deepEqual(summary.prerequisiteProvenances, receipt.prerequisiteProvenances);
  assert.equal(
    receipt.prerequisiteProvenances[1].record.snapshot.selectedPrerequisite.family,
    'counted-iteration',
  );
});

test('M4.60 rejects profile identity, typed evidence, and candidate overlap drift', () => {
  const policy = loadCoveragePolicy();
  const mutations = [
    (copy) => { copy.format = 'kern.kir-canonicalizer.coverage-policy.2'; },
    (copy) => { copy.base.future = true; },
    (copy) => { copy.base.id = 'kern.kir-canonicalizer.profile.future'; },
    (copy) => { copy.base.expressionKinds.shift(); },
    (copy) => { copy.base.nodeKinds.shift(); },
    (copy) => { copy.base.promotions.pop(); },
    (copy) => { copy.base.promotions[0].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[1].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[2].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[3].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[4].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[5].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[6].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[7].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[8].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[9].provenanceDigest = '0'.repeat(64); },
    (copy) => { copy.base.promotions[0].provenanceKind = 'prerequisite'; },
    (copy) => { copy.base.promotions[4].provenanceKind = 'selection'; },
    (copy) => { copy.base.promotions[4].provenanceKind = 'future'; },
    (copy) => { copy.base.promotions[5].provenanceKind = 'selection'; },
    (copy) => { copy.base.promotions[6].provenanceKind = 'selection'; },
    (copy) => { copy.base.promotions[7].provenanceKind = 'selection'; },
    (copy) => { copy.base.promotions[8].provenanceKind = 'selection'; },
    (copy) => { copy.base.promotions[9].provenanceKind = 'selection'; },
    (copy) => { copy.base.promotions.reverse(); },
    (copy) => { copy.base.promotions.push(structuredClone(BINARY_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(CONDITIONAL_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(CALL_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(MEMBER_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(INDEX_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(COUNTED_ITERATION_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(BINDING_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(UNARY_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(DO_PROMOTION)); },
    (copy) => { copy.base.promotions.push(structuredClone(WHILE_PROMOTION)); },
    (copy) => {
      copy.families.unshift({
        expressionKinds: ['index'],
        id: 'index-expression',
        nodeKinds: [],
        propertyKeys: [],
      });
    },
    (copy) => {
      copy.families.unshift({
        expressionKinds: [],
        id: 'counted-iteration',
        nodeKinds: ['for'],
        propertyKeys: ['for.from', 'for.name', 'for.to'],
      });
    },
    (copy) => {
      copy.families.unshift({
        expressionKinds: [],
        id: 'binding',
        nodeKinds: ['assign', 'let'],
        propertyKeys: ['assign.target', 'assign.value', 'let.name', 'let.value'],
      });
    },
    (copy) => {
      copy.families.unshift({ expressionKinds: ['unary'], id: 'unary-expression', nodeKinds: [], propertyKeys: [] });
    },
    (copy) => {
      copy.families.unshift({ expressionKinds: [], id: 'do-statement', nodeKinds: ['do'], propertyKeys: ['do.value'] });
    },
    (copy) => {
      copy.families.push({
        expressionKinds: [],
        id: 'while-iteration',
        nodeKinds: ['while'],
        propertyKeys: ['while.cond'],
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
const member = (object, property = 'value', optional = { tag: 'bool', value: false }) => expression('member', {
  object,
  optional,
  property: { tag: 'text', value: property },
});
const indexExpression = (object, index, optional = { tag: 'bool', value: false }) => expression('index', {
  index,
  object,
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

test('the promoted index profile admits only exact recursive non-optional indices', () => {
  const base = loadCoveragePolicy().base;
  const optional = { tag: 'bool', value: false };
  const integer = expression('integer', { value: { tag: 'int', value: '0' } });
  const nested = indexExpression(indexExpression(identifier('matrix'), integer), integer);
  for (const candidate of [
    nested,
    member(nested, 'length', optional),
    call(identifier('consume'), [nested]),
  ]) {
    assert.deepEqual(baseExpressionProfileBlockers(candidate, base), []);
    const expressionKinds = [...new Set(collectCanonicalExpressionKinds(candidate))];
    assert.equal(
      canonicalizerFunctionCompletes(
        baseCompletionProfile(base),
        expressionOnlyFact(expressionKinds),
        loadCanonicalizerPolicy().profileLimits,
      ),
      true,
    );
  }
  assert.deepEqual(
    baseExpressionProfileBlockers(indexExpression(identifier('items'), integer, { tag: 'bool', value: true }), base),
    ['expression.index.optional'],
  );
  assert.deepEqual(
    baseExpressionProfileBlockers(
      indexExpression(indexExpression(identifier('items'), integer, { tag: 'bool', value: true }), integer),
      base,
    ),
    ['expression.index.optional'],
  );
  for (const malformed of [
    expression('index', { index: integer, object: identifier('items') }),
    indexExpression(identifier('items'), integer, { tag: 'text', value: 'false' }),
    expression('index', {
      future: { tag: 'null' },
      index: integer,
      object: identifier('items'),
      optional,
    }),
  ]) {
    assert.deepEqual(baseExpressionProfileBlockers(malformed, base), ['expression.index.shape']);
  }
});

test('the promoted counted-iteration profile admits only exact default-step loops', () => {
  const base = loadCoveragePolicy().base;
  const returned = (value) => ({ children: [], props: { value }, type: 'return' });
  const loop = {
    children: [returned('i')],
    props: { from: '0', name: 'i', to: 'limit' },
    type: 'for',
  };
  const functionRoot = {
    children: [
      { children: [loop, returned('limit')], props: { lang: 'kern' }, type: 'handler' },
    ],
    props: { name: 'lastIndex', returns: 'number' },
    type: 'fn',
  };
  assert.deepEqual(profileBlockersForFunction(functionRoot, base), []);
  const emptyBody = structuredClone(functionRoot);
  emptyBody.children[0].children[0].children = [];
  assert.deepEqual(profileBlockersForFunction(emptyBody, base), []);

  const mutations = [
    ['missing-from', (copy) => { delete copy.children[0].children[0].props.from; }],
    ['explicit-step', (copy) => { copy.children[0].children[0].props.step = '1'; }],
    ['future-property', (copy) => { copy.children[0].children[0].props.future = 'x'; }],
    ['dollar-name', (copy) => { copy.children[0].children[0].props.name = '$i'; }],
    ['malformed-name', (copy) => { copy.children[0].children[0].props.name = '1i'; }],
  ];
  for (const [label, mutate] of mutations) {
    const copy = structuredClone(functionRoot);
    mutate(copy);
    assert.notDeepEqual(profileBlockersForFunction(copy, base), [], label);
  }
});

test('a future base expression kind fails closed until it has an exact local profile', () => {
  const base = structuredClone(loadCoveragePolicy().base);
  base.expressionKinds.push('decimal');
  const decimal = expression('decimal', { value: { tag: 'decimal', value: '1.0' } });
  assert.deepEqual(baseExpressionProfileBlockers(decimal, base), ['expression.decimal.profile']);
});

test('the promoted member profile admits only exact recursive non-optional parser-safe members', () => {
  const base = loadCoveragePolicy().base;
  const valid = member(member(call(identifier('make')), 'new'), 'return');
  assert.deepEqual(baseExpressionProfileBlockers(valid, base), []);
  assert.deepEqual(baseExpressionProfileBlockers(member(identifier('service'), 'typeof'), base), []);
  assert.deepEqual(
    baseExpressionProfileBlockers(
      member(identifier('service'), 'run', { tag: 'bool', value: true }),
      base,
    ),
    ['expression.member.optional'],
  );
  assert.deepEqual(
    baseExpressionProfileBlockers(
      member(member(identifier('service'), 'client', { tag: 'bool', value: true }), 'run'),
      base,
    ),
    ['expression.member.optional'],
  );
  for (const property of ['null', 'none', 'undefined', 'true', 'false', 'await']) {
    assert.deepEqual(
      baseExpressionProfileBlockers(member(identifier('service'), property), base),
      [`expression.member.property.${property}`],
    );
  }
  for (const malformed of [
    expression('member', {
      object: identifier('service'),
      property: { tag: 'text', value: 'run' },
    }),
    member(identifier('service'), 'bad-name'),
    member(identifier('service'), 'run', { tag: 'text', value: 'false' }),
    expression('member', {
      future: { tag: 'null' },
      object: identifier('service'),
      optional: { tag: 'bool', value: false },
      property: { tag: 'text', value: 'run' },
    }),
  ]) {
    assert.deepEqual(baseExpressionProfileBlockers(malformed, base), ['expression.member.shape']);
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
