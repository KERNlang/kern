import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
  validateCoveragePolicy,
} from './coverage.mjs';
import {
  loadCanonicalizerNewExpressionPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import { baseExpressionProfileBlockers } from './coverage-profile.mjs';
import { authenticateHistoricalCoveragePolicy } from './historical-coverage-auth.mjs';
import { loadPreM4135CoverageInputs } from './historical-parameter-sources.mjs';

const PROFILE_ID = 'kern.kir-canonicalizer.profile.m4.137';
const NEW_EXPRESSION_PROVENANCE_DIGEST =
  'ca3b4053df5707126d97c21300cf20004d7c01e9fcc0b78d40dd249fd8d1af0e';
const NEW_EXPRESSION_PROMOTION = {
  family: 'new-expression',
  provenanceDigest: NEW_EXPRESSION_PROVENANCE_DIGEST,
  provenanceKind: 'prerequisite',
};

function expression(kind, fields) {
  return {
    tag: 'record',
    value: [
      {
        key: 'fields',
        value: {
          tag: 'record',
          value: Object.entries(fields).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          ).map(([key, value]) => ({ key, value })),
        },
      },
      { key: 'kind', value: { tag: 'text', value: kind } },
    ],
  };
}

const text = (value) => expression('text', { value: { tag: 'text', value } });
const identifier = (name) => expression('identifier', { name: { tag: 'text', value: name } });
const newExpression = (constructor, args, extra = {}) => expression('new', {
  args: { tag: 'list', value: args },
  constructor: { tag: 'text', value: constructor },
  ...extra,
});

test('M4.137 promotes new-expression through the exact M4.136 provenance', () => {
  const policy = loadCoveragePolicy();
  assert.equal(policy.base.id, PROFILE_ID);
  assert.deepEqual(policy.base.expressionKinds, [
    'binary',
    'boolean',
    'call',
    'identifier',
    'index',
    'integer',
    'list',
    'member',
    'new',
    'null',
    'text',
    'unary',
  ]);
  assert.deepEqual(policy.base.promotions.at(-1), NEW_EXPRESSION_PROMOTION);
  assert.deepEqual(policy.families.map(({ id }) => id), ['exception-flow']);

  const handoff = loadCanonicalizerNewExpressionPrerequisiteProvenance();
  assert.equal(handoff.digest, NEW_EXPRESSION_PROVENANCE_DIGEST);
  const receipt = measureCanonicalizerCoverage(policy);
  const summary = summarizeCanonicalizerCoverage(receipt);
  assert.deepEqual(receipt.base, policy.base);
  assert.deepEqual(summary.base, policy.base);
  assert.deepEqual(receipt.implementationProvenance, NEW_EXPRESSION_PROMOTION);
  assert.deepEqual(summary.implementationProvenance, NEW_EXPRESSION_PROMOTION);
  assert.deepEqual(receipt.prerequisiteProvenances.slice(0, 7).at(-1), handoff);
});

test('M4.137 rejects profile, provenance, and family-registry drift', () => {
  const policy = loadCoveragePolicy();
  const mutations = [
    (copy) => { copy.base.id = 'kern.kir-canonicalizer.profile.future'; },
    (copy) => { copy.base.expressionKinds.splice(copy.base.expressionKinds.indexOf('new'), 1); },
    (copy) => { copy.base.promotions.at(-1).provenanceDigest = '0'.repeat(64); },
    (copy) => {
      copy.families.push({
        expressionKinds: ['new'],
        id: 'new-expression',
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

test('M4.137 accepts only digest-authenticated exact historical base policy', () => {
  const handoff = loadPreM4135CoverageInputs(loadCoveragePolicy());
  const historical = handoff.policy;
  assert.equal(
    validateCoveragePolicy(historical, { allowMissingCorpus: true }).base.id,
    'kern.kir-canonicalizer.profile.m4.60',
  );
  assert.throws(
    () => validateCoveragePolicy(
      structuredClone(historical),
      { allowMissingCorpus: true },
    ),
    /coverage policy rejection/u,
  );
  const fabricated = structuredClone(historical);
  fabricated.base.id = 'kern.kir-canonicalizer.profile.m4.59';
  assert.throws(
    () => authenticateHistoricalCoveragePolicy(
      fabricated,
      handoff.coveragePolicySource,
    ),
    /exact archived policy bytes/u,
  );
});

test('M4.137 profile admits only exact bounded new-expression shapes', () => {
  const base = loadCoveragePolicy().base;
  for (const candidate of [
    newExpression('Map', []),
    newExpression('Error', [text('failure')]),
  ]) {
    assert.deepEqual(baseExpressionProfileBlockers(candidate, base), []);
  }
  for (const candidate of [
    newExpression('Map', [identifier('value')]),
    newExpression('Error', []),
    newExpression('Set', []),
    newExpression('Map', [], { future: { tag: 'bool', value: true } }),
    expression('new', {
      args: { tag: 'text', value: 'not-a-list' },
      constructor: { tag: 'text', value: 'Map' },
    }),
    newExpression('Error', [expression('future', {})]),
  ]) {
    assert.deepEqual(
      baseExpressionProfileBlockers(candidate, base),
      ['expression.new.shape'],
    );
  }
});
