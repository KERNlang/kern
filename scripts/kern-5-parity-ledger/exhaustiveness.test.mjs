import assert from 'node:assert/strict';
import test from 'node:test';

import { expressionLowering, linkedKinds, requestSource, statementLowering } from './ledger-support.mjs';

const STATEMENT_KINDS = Object.freeze(['assign', 'capability', 'for', 'if', 'let', 'print', 'return']);
const EXPRESSION_KINDS = Object.freeze([
  'binary',
  'identifier',
  'json-call',
  'list',
  'literal',
  'member',
  'record',
  'unary',
  'user-call',
]);
const STATES = Object.freeze(['deferred', 'lowered']);

test('the linked unions carry the kind sets the mapping must cover', () => {
  const kinds = linkedKinds();
  assert.deepEqual(kinds.statement, [...STATEMENT_KINDS], 'PARITY_LEDGER_SURFACE_DRIFT: the statement union moved');
  assert.deepEqual(kinds.expression, [...EXPRESSION_KINDS], 'PARITY_LEDGER_SURFACE_DRIFT: the expression union moved');
});

// `nodeKind` is the ledger's primary key, so a kind that named both a statement and an expression
// would make a row ambiguous. The two unions are disjoint today, and this is what notices otherwise.
test('statement and expression kinds are disjoint, so nodeKind alone is a stable identity', () => {
  const kinds = linkedKinds();
  const shared = kinds.statement.filter((kind) => kinds.expression.includes(kind));
  assert.deepEqual(shared, [], 'PARITY_LEDGER_AMBIGUOUS_ID: a kind names both a statement and an expression');
});

test('the statement lowering mapping covers every linked statement kind', async () => {
  const mapping = await statementLowering();
  assert.deepEqual(
    Object.keys(mapping).sort(),
    linkedKinds().statement,
    'PARITY_LEDGER_MAPPING_GAP: the statement mapping and the statement union disagree',
  );
});

test('the expression lowering mapping covers every linked expression kind', async () => {
  const mapping = await expressionLowering();
  assert.deepEqual(
    Object.keys(mapping).sort(),
    linkedKinds().expression,
    'PARITY_LEDGER_MAPPING_GAP: the expression mapping and the expression union disagree',
  );
});

test('every mapping value is one of the two admitted lowering states', async () => {
  for (const mapping of [await statementLowering(), await expressionLowering()]) {
    for (const [kind, state] of Object.entries(mapping)) {
      assert.ok(STATES.includes(state), `PARITY_LEDGER_MAPPING_STATE: ${kind} carries ${String(state)}`);
    }
  }
});

test('both mappings are exhaustive by type, not only by measurement', () => {
  const text = requestSource();
  for (const union of ['LinkedKernKirStatement', 'LinkedKernKirExpression']) {
    assert.ok(
      text.includes(`satisfies Record<${union}['kind']`),
      `PARITY_LEDGER_TYPE_GATE: request.ts must constrain its mapping with satisfies Record<${union}['kind'], …>`,
    );
  }
});

test('every node kind the Python emitter lowers today is mapped lowered', async () => {
  const statements = await statementLowering();
  const expressions = await expressionLowering();
  const deferred = [
    ...Object.entries(statements).filter(([, state]) => state === 'deferred'),
    ...Object.entries(expressions).filter(([, state]) => state === 'deferred'),
  ].map(([kind]) => kind);
  assert.deepEqual(deferred, [], 'PARITY_LEDGER_EMPTY_START: the mechanism slice defers no node kind');
});
