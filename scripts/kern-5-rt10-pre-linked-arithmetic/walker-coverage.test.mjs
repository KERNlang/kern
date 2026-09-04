import assert from 'node:assert/strict';
import test from 'node:test';

import {
  containsAsyncCall,
  linkedStatementsCallDepth,
  linkedStatementsInvokeCapability,
} from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';

// Three walks reach every linked expression variant and all three fail closed on an unknown one.
// These rows build the linked `unary` node directly, the way RT-5's variant-coverage suite does,
// so the walks are exercised without waiting for the frontend or the linker.
const ASYNC_CALL = Object.freeze({ arguments: Object.freeze([]), handlerName: 'asyncOne', kind: 'user-call' });
const SYNC_CALL = Object.freeze({ arguments: Object.freeze([]), handlerName: 'syncOne', kind: 'user-call' });

const SCOPE = Object.freeze({
  bindings: new Set(),
  calls: Object.freeze({
    isAsync: (name) => name === 'asyncOne',
    linked: new Map(),
    resolve: () => {
      throw new Error('the coverage scope never resolves');
    },
  }),
  crossCallTypes: new Map(),
  types: new Map(),
});

function negate(inner) {
  return Object.freeze({ argument: inner, kind: 'unary', op: '-' });
}

function returning(value) {
  return Object.freeze([Object.freeze({ kind: 'return', value })]);
}

const INTEGER = Object.freeze({ kind: 'integer' });

const CAPABILITY_HELPER = Object.freeze({
  parameters: Object.freeze([]),
  returnType: INTEGER,
  statements: Object.freeze([
    Object.freeze({ input: undefined, kind: 'capability', name: 'r', namespace: 'fixture', operation: 'resolve' }),
    Object.freeze({ kind: 'return', value: Object.freeze({ kind: 'identifier', name: 'r' }) }),
  ]),
});

const PURE_HELPER = Object.freeze({
  parameters: Object.freeze([]),
  returnType: INTEGER,
  statements: returning(Object.freeze({ kind: 'literal', value: Object.freeze({ tag: 'integer', value: '1' }) })),
});

const HELPERS = new Map([
  ['capabilityOne', CAPABILITY_HELPER],
  ['syncOne', PURE_HELPER],
]);

test('containsAsyncCall looks inside a unary argument', () => {
  assert.equal(
    containsAsyncCall(negate(ASYNC_CALL), SCOPE),
    true,
    'RT10PRE_WALKER_GAP: a unary hides a nested async call from the position gate',
  );
});

test('containsAsyncCall does not report a synchronous callee under a unary', () => {
  assert.equal(containsAsyncCall(negate(SYNC_CALL), SCOPE), false);
  assert.equal(containsAsyncCall(negate(negate(SYNC_CALL)), SCOPE), false);
});

test('containsAsyncCall reaches an async call nested two unary levels deep', () => {
  assert.equal(containsAsyncCall(negate(negate(ASYNC_CALL)), SCOPE), true);
});

test('linkedStatementsInvokeCapability sees a capability reached through a unary', () => {
  const call = Object.freeze({ arguments: Object.freeze([]), handlerName: 'capabilityOne', kind: 'user-call' });
  assert.equal(
    linkedStatementsInvokeCapability(returning(negate(call)), HELPERS),
    true,
    'RT10PRE_WALKER_GAP: the closure walk defaults to false on a unary, so a capability hides under it',
  );
  assert.equal(linkedStatementsInvokeCapability(returning(negate(SYNC_CALL)), HELPERS), false);
});

test('linkedStatementsCallDepth counts a call reached through a unary exactly as a bare call', () => {
  const bare = linkedStatementsCallDepth(returning(SYNC_CALL), HELPERS);
  assert.equal(bare, 1, 'a bare synchronous call is depth 1');
  assert.equal(
    linkedStatementsCallDepth(returning(negate(SYNC_CALL)), HELPERS),
    bare,
    'RT10PRE_WALKER_GAP: the depth walk defaults to 0 on a unary, so the call-depth policy cannot see it',
  );
});

const UNKNOWN_VARIANT = Object.freeze({ kind: 'rt10pre-unknown-variant' });

test('the closure walk fails closed on an expression variant it does not handle', () => {
  assert.throws(
    () => linkedStatementsInvokeCapability(returning(UNKNOWN_VARIANT), HELPERS),
    (error) => error.code === 'handler-entry-unsupported' && error.phase === 'link',
    'RT10PRE_WALKER_DEFAULT: the closure walk answered instead of failing closed on an unknown variant',
  );
});

test('the call-depth walk fails closed on an expression variant it does not handle', () => {
  assert.throws(
    () => linkedStatementsCallDepth(returning(UNKNOWN_VARIANT), HELPERS),
    (error) => error.code === 'handler-entry-unsupported' && error.phase === 'link',
    'RT10PRE_WALKER_DEFAULT: the depth walk answered instead of failing closed on an unknown variant',
  );
});

test('containsAsyncCall fails closed on the same unknown variant, so all three walks agree', () => {
  assert.throws(
    () => containsAsyncCall(UNKNOWN_VARIANT, SCOPE),
    (error) => error.code === 'handler-entry-unsupported' && error.phase === 'link',
  );
});
