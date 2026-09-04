import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ASYNC_BOOLEAN_HELPER,
  ASYNC_TEXT_HELPER,
  BOOLEAN_FLAG,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  assertLinkRejected,
  containsAsyncCall,
  entryFn,
  linkFailureMessage,
  linkedProgram,
  moduleSource,
} from './k0-support.mjs';

const RT3_GOLDEN_URL = new URL('../kern-5-rt3-binary-expression/k0-golden.json', import.meta.url);

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

// One row per LinkedKernKirExpression variant. `carries` says whether the variant has a
// sub-expression the position gate has to look inside; `wrap` builds that variant around a call.
const VARIANTS = Object.freeze({
  binary: { carries: true, wrap: (inner) => ({ kind: 'binary', left: inner, op: '&&', right: inner }) },
  identifier: { carries: false, wrap: () => ({ kind: 'identifier', name: 'x' }) },
  'json-call': { carries: true, wrap: (inner) => ({ argument: inner, kind: 'json-call', operation: 'stringify' }) },
  list: { carries: true, wrap: (inner) => ({ items: [inner], kind: 'list' }) },
  literal: { carries: false, wrap: () => ({ kind: 'literal', value: { tag: 'boolean', value: true } }) },
  member: { carries: true, wrap: (inner) => ({ kind: 'member', object: inner, optional: false, property: 'p' }) },
  record: { carries: true, wrap: (inner) => ({ entries: [{ key: 'k', value: inner }], kind: 'record' }) },
  unary: { carries: true, wrap: (inner) => ({ argument: inner, kind: 'unary', op: '-' }) },
  'user-call': { carries: true, wrap: (inner) => ({ arguments: [inner], handlerName: 'syncOne', kind: 'user-call' }) },
});

test('the coverage table names every linked expression variant that exists', async () => {
  const golden = JSON.parse(await readFile(RT3_GOLDEN_URL, 'utf8'));
  assert.deepEqual(
    Object.keys(VARIANTS).sort(),
    [...golden.linkedExpressionKinds].sort(),
    'RT5_VARIANT_COVERAGE_GAP: a linked expression variant has no row in the position-gate coverage table',
  );
});

test('the position walk looks inside every variant that carries a sub-expression', () => {
  for (const name of Object.keys(VARIANTS).sort()) {
    const { carries, wrap } = VARIANTS[name];
    if (!carries) continue;
    assert.equal(
      containsAsyncCall(wrap(ASYNC_CALL), SCOPE),
      true,
      `RT5_VARIANT_COVERAGE_GAP: ${name} hides a nested async call from the position gate`,
    );
    assert.equal(
      containsAsyncCall(wrap(SYNC_CALL), SCOPE),
      false,
      `${name} must not report a synchronous callee as async`,
    );
  }
});

test('a variant that carries no sub-expression reports no async call', () => {
  for (const name of Object.keys(VARIANTS).sort()) {
    const { carries, wrap } = VARIANTS[name];
    if (carries) continue;
    assert.equal(containsAsyncCall(wrap(ASYNC_CALL), SCOPE), false, `${name} carries nothing to look inside`);
  }
});

test('a bare async call is reported, and a bare synchronous call is not', () => {
  assert.equal(containsAsyncCall(ASYNC_CALL, SCOPE), true);
  assert.equal(containsAsyncCall(SYNC_CALL, SCOPE), false);
});

test('nesting two variants deep is still reported', () => {
  const nested = VARIANTS.list.wrap(VARIANTS.binary.wrap(VARIANTS['json-call'].wrap(ASYNC_CALL)));
  assert.equal(containsAsyncCall(nested, SCOPE), true);
});

// The reachable half of the same table: what F5 can actually project into each variant.
const PROJECTED_NEGATIVES = Object.freeze({
  'binary-in-return': () =>
    moduleSource([ASYNC_BOOLEAN_HELPER, entryFn(['return value="fetchFlag(flag) && flag"'])]),
  'equality-operand-in-return': () =>
    moduleSource([ASYNC_BOOLEAN_HELPER, entryFn(['return value="fetchFlag(flag) == flag"'])]),
  'json-call-argument-in-return': () =>
    moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="Json.stringify(fetchIt(t))"'], TEXT_INPUT, 'string')]),
  'list-item-in-return': () =>
    moduleSource([
      ASYNC_BOOLEAN_HELPER,
      { body: ['return value="true"'], name: 'any', parameters: [{ name: 'xs', type: 'boolean[]' }], returns: 'boolean' },
      entryFn(['return value="any([fetchFlag(flag), flag])"']),
    ]),
  'record-entry-in-return': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      entryFn(['return value="Json.stringify({ a: fetchIt(t) })"'], TEXT_INPUT, 'string'),
    ]),
  'user-call-argument-of-an-async-callee-in-return': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      RELAY_HELPER,
      entryFn(['return value="relay(fetchIt(t))"'], TEXT_INPUT, 'string'),
    ]),
  'user-call-argument-of-a-sync-callee-in-return': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(['return value="echo(fetchIt(t))"'], TEXT_INPUT, 'string'),
    ]),
  'nested-two-calls-deep-in-a-callee-return': () =>
    moduleSource([
      ASYNC_BOOLEAN_HELPER,
      { body: ['return value="fetchFlag(flag) && flag"'], name: 'wrap', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      entryFn(['return value="wrap(flag)"']),
    ]),
});

test('every projected nested form in return position fails closed on all three legs', async () => {
  for (const name of Object.keys(PROJECTED_NEGATIVES).sort()) {
    await assertLinkRejected(PROJECTED_NEGATIVES[name](), name);
    const message = await linkFailureMessage(PROJECTED_NEGATIVES[name]());
    assert.ok(
      message?.includes('KIR_ASYNC_CALL_EXPRESSION_POSITION'),
      `${name}: expected the position label, got ${message}`,
    );
  }
});

test('an async call that is the entire return value stays admitted', async () => {
  const program = await linkedProgram(
    moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="fetchIt(t)"'], TEXT_INPUT, 'string')]),
  );
  assert.equal(program.helpers.find((helper) => helper.name === 'fetchIt').async, true);
  const relayed = await linkedProgram(
    moduleSource([ASYNC_TEXT_HELPER, RELAY_HELPER, entryFn(['return value="relay(t)"'], TEXT_INPUT, 'string')]),
  );
  assert.equal(relayed.helpers.find((helper) => helper.name === 'relay').async, true);
});
