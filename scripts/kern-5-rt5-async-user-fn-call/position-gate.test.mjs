import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_BOOLEAN_HELPER,
  ASYNC_TEXT_HELPER,
  BOOLEAN_FLAG,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  assertLinkRejected,
  entryFn,
  linkFailureMessage,
  linkedProgram,
  moduleSource,
} from './k0-support.mjs';

const LIST_HELPER = Object.freeze({
  body: Object.freeze(['return value="true"']),
  name: 'any',
  parameters: Object.freeze([Object.freeze({ name: 'xs', type: 'boolean[]' })]),
  returns: 'boolean',
});

const WRAP_HELPER = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'wrap',
  parameters: TEXT_INPUT,
  returns: 'string',
});

const REJECTED = Object.freeze({
  'binary-left-operand': () =>
    moduleSource([ASYNC_BOOLEAN_HELPER, entryFn(['return value="fetchFlag(flag) && flag"'])]),
  'binary-right-operand': () =>
    moduleSource([ASYNC_BOOLEAN_HELPER, entryFn(['return value="flag && fetchFlag(flag)"'])]),
  'if-condition': () =>
    moduleSource([
      ASYNC_BOOLEAN_HELPER,
      entryFn(['if cond="fetchFlag(flag)"', '  return value="true"', 'return value="false"']),
    ]),
  'let-value-inside-a-binary': () =>
    moduleSource([
      ASYNC_BOOLEAN_HELPER,
      entryFn(['let name=x value="fetchFlag(flag) || flag"', 'return value="x"']),
    ]),
  'list-literal-item': () =>
    moduleSource([
      ASYNC_BOOLEAN_HELPER,
      LIST_HELPER,
      entryFn(['return value="any([fetchFlag(flag), flag])"']),
    ]),
  'nested-argument-of-an-async-call': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      RELAY_HELPER,
      entryFn(['return value="relay(fetchIt(t))"'], TEXT_INPUT, 'string'),
    ]),
  'nested-argument-of-a-sync-call': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(['return value="echo(fetchIt(t))"'], TEXT_INPUT, 'string'),
    ]),
  'nested-two-calls-deep': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      WRAP_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(['return value="echo(wrap(fetchIt(t)))"'], TEXT_INPUT, 'string'),
    ]),
  'print-value-inside-a-record': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      entryFn(['print value="Json.stringify({ a: fetchIt(t) })"', 'return value="t"'], TEXT_INPUT, 'string'),
    ]),
  'transitive-async-in-an-argument': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      RELAY_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(['return value="echo(relay(t))"'], TEXT_INPUT, 'string'),
    ]),
});

const ADMITTED = Object.freeze({
  'let-value': () =>
    moduleSource([ASYNC_TEXT_HELPER, entryFn(['let name=x value="fetchIt(t)"', 'return value="x"'], TEXT_INPUT, 'string')]),
  'nested-block-let-value': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      entryFn(
        ['if cond="true"', '  let name=x value="fetchIt(t)"', '  return value="x"', 'return value="t"'],
        TEXT_INPUT,
        'string',
      ),
    ]),
  'print-value': () =>
    moduleSource([ASYNC_TEXT_HELPER, entryFn(['print value="fetchIt(t)"', 'return value="t"'], TEXT_INPUT, 'string')]),
  'return-value': () =>
    moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="fetchIt(t)"'], TEXT_INPUT, 'string')]),
  'sync-argument-of-an-async-call': () =>
    moduleSource([
      ASYNC_TEXT_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(['return value="fetchIt(echo(t))"'], TEXT_INPUT, 'string'),
    ]),
});

test('positive admission is green before any negative counts', async () => {
  for (const name of Object.keys(ADMITTED).sort()) {
    const program = await linkedProgram(ADMITTED[name]());
    assert.ok(program.helpers.some((helper) => helper.async === true), `${name} must link an async helper`);
  }
});

test('every non-statement position for an async callee fails closed on all three legs', async () => {
  for (const name of Object.keys(REJECTED).sort()) {
    await assertLinkRejected(REJECTED[name](), name);
  }
});

test('the position gate names its label, and the narrowed capability label rides with it', async () => {
  for (const name of Object.keys(REJECTED).sort()) {
    const message = await linkFailureMessage(REJECTED[name]());
    assert.ok(
      message?.includes('KIR_ASYNC_CALL_EXPRESSION_POSITION'),
      `${name}: the position gate must name KIR_ASYNC_CALL_EXPRESSION_POSITION, got ${message}`,
    );
    assert.ok(
      message?.includes('KIR_CALL_CALLEE_CAPABILITY'),
      `${name}: RT-4's callee-capability label is narrowed, never deleted, got ${message}`,
    );
  }
});

test('an async call as the whole statement value carries no position label at all', async () => {
  for (const name of Object.keys(ADMITTED).sort()) {
    assert.equal(await linkFailureMessage(ADMITTED[name]()), undefined, `${name} must link`);
  }
});

test('a synchronous callee is still admissible in every RT-4 position', async () => {
  const source = moduleSource([
    SYNC_TEXT_HELPER,
    WRAP_HELPER,
    entryFn(['let name=x value="echo(wrap(t))"', 'return value="wrap(echo(x))"'], TEXT_INPUT, 'string'),
  ]);
  const program = await linkedProgram(source);
  assert.equal(program.helpers.some((helper) => helper.async === true), false, 'the fixture is entirely synchronous');
});

test('recursion is still rejected, and an async callee does not smuggle a cycle past it', async () => {
  await assertLinkRejected(
    moduleSource([
      {
        body: ['capability namespace=fixture operation=resolve name=reply', 'return value="loop(t)"'],
        name: 'loop',
        parameters: TEXT_INPUT,
        returns: 'string',
      },
      entryFn(['return value="loop(t)"'], TEXT_INPUT, 'string'),
    ]),
    'direct recursion through an async callee',
  );
  await assertLinkRejected(
    moduleSource([
      {
        body: ['capability namespace=fixture operation=resolve name=reply', 'return value="pong(t)"'],
        name: 'ping',
        parameters: TEXT_INPUT,
        returns: 'string',
      },
      { body: ['return value="ping(t)"'], name: 'pong', parameters: TEXT_INPUT, returns: 'string' },
      entryFn(['return value="ping(t)"'], TEXT_INPUT, 'string'),
    ]),
    'mutual recursion through an async callee',
  );
});
