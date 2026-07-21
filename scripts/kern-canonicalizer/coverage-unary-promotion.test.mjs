import assert from 'node:assert/strict';
import test from 'node:test';

import { collectCanonicalExpressionKinds, loadCoveragePolicy } from './coverage.mjs';
import { baseExpressionProfileBlockers } from './coverage-profile.mjs';
import { canonicalizerFunctionCompletes } from './coverage-selection.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

function expression(kind, fields) {
  return {
    tag: 'record',
    value: [
      {
        key: 'fields',
        value: {
          tag: 'record',
          value: Object.entries(fields)
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([key, value]) => ({ key, value })),
        },
      },
      { key: 'kind', value: { tag: 'text', value: kind } },
    ],
  };
}

const identifier = (name) => expression('identifier', { name: { tag: 'text', value: name } });
const integer = (value) => expression('integer', { value: { tag: 'int', value } });
const unary = (op, argument) => expression('unary', {
  argument,
  op: { tag: 'text', value: op },
});

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

test('the promoted unary profile admits only exact recursive parser-portable unary expressions', () => {
  const base = loadCoveragePolicy().base;
  for (const candidate of [
    unary('!', identifier('ready')),
    unary('-', integer('1')),
    unary('~', unary('!', identifier('mask'))),
    unary('typeof', unary('~', identifier('value'))),
  ]) {
    assert.deepEqual(baseExpressionProfileBlockers(candidate, base), []);
  }

  for (const op of ['+', 'void']) {
    assert.deepEqual(
      baseExpressionProfileBlockers(unary(op, identifier('value')), base),
      [`expression.unary.operator.${op}`],
    );
  }
  assert.deepEqual(
    baseExpressionProfileBlockers(unary('-', integer('0')), base),
    ['expression.unary.shape'],
  );

  const malformed = [
    expression('unary', { argument: identifier('value') }),
    expression('unary', { op: { tag: 'text', value: '!' } }),
    expression('unary', {
      argument: identifier('value'),
      future: { tag: 'null' },
      op: { tag: 'text', value: '!' },
    }),
    expression('unary', {
      argument: identifier('value'),
      op: { tag: 'bool', value: true },
    }),
  ];
  for (const candidate of malformed) {
    assert.deepEqual(baseExpressionProfileBlockers(candidate, base), ['expression.unary.shape']);
  }

  const unsupportedArgument = expression('unary', {
    argument: expression('decimal', { value: { tag: 'decimal', value: '1.0' } }),
    op: { tag: 'text', value: '!' },
  });
  assert.deepEqual(baseExpressionProfileBlockers(unsupportedArgument, base), []);
  const expressionKinds = [...new Set(collectCanonicalExpressionKinds(unsupportedArgument))];
  const profile = {
    baseNodeKinds: new Set(base.nodeKinds),
    expressionKinds: new Set(base.expressionKinds),
    nodeKinds: new Set(base.nodeKinds),
    propertyKeys: new Set(),
    statementNodeKinds: new Set(),
  };
  assert.equal(
    canonicalizerFunctionCompletes(
      profile,
      expressionOnlyFact(expressionKinds),
      loadCanonicalizerPolicy().profileLimits,
    ),
    false,
  );
});
