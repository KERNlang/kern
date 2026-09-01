import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_TEXT_HELPER,
  BOOLEAN_FLAG,
  CAPABILITY_LINE,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  boolArgs,
  entryFn,
  moduleSource,
  runtimeRequest,
  textArgs,
  threeLegBytes,
} from './k0-support.mjs';

const TWO_CAPABILITIES = Object.freeze({
  body: Object.freeze([CAPABILITY_LINE, 'let name=first value="reply"', 'capability namespace=fixture operation=second name=again', 'return value="again"']),
  name: 'twice',
  parameters: TEXT_INPUT,
  returns: 'string',
});

const PRINTING_ASYNC = Object.freeze({
  body: Object.freeze(['print value="t"', CAPABILITY_LINE, 'print value="reply"', 'return value="reply"']),
  name: 'loud',
  parameters: TEXT_INPUT,
  returns: 'string',
});

const BRANCHING_ASYNC = Object.freeze({
  body: Object.freeze([
    'if cond="true"',
    `  ${CAPABILITY_LINE}`,
    '  print value="reply"',
    '  return value="reply"',
    'return value="t"',
  ]),
  name: 'branchy',
  parameters: TEXT_INPUT,
  returns: 'string',
});

// The false side of a callee branch: without it a walker that always took the then-branch would
// agree with the real one on every other fixture.
const ELSE_TAKING_ASYNC = Object.freeze({
  body: Object.freeze([
    'if cond="flag"',
    `  ${CAPABILITY_LINE}`,
    '  print value="reply"',
    'else',
    '  print value="\\"else-side\\""',
    'return value="\\"done\\""',
  ]),
  name: 'chooser',
  parameters: BOOLEAN_FLAG,
  returns: 'string',
});

const FALLTHROUGH_ASYNC = Object.freeze({
  body: Object.freeze([
    'if cond="flag"',
    '  print value="\\"taken\\""',
    CAPABILITY_LINE,
    'print value="reply"',
    'return value="\\"after\\""',
  ]),
  name: 'faller',
  parameters: BOOLEAN_FLAG,
  returns: 'string',
});

const ASYNC_LIST = Object.freeze({
  body: Object.freeze([CAPABILITY_LINE, 'return value="xs"']),
  name: 'pick',
  parameters: Object.freeze([Object.freeze({ name: 'xs', type: 'boolean[]' })]),
  returns: 'boolean[]',
});

const FIXTURES = Object.freeze({
  'async-and-sync-in-one-handler': {
    args: () => textArgs('mix'),
    source: moduleSource([
      ASYNC_TEXT_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(
        ['let name=a value="echo(t)"', 'let name=b value="fetchIt(a)"', 'print value="echo(b)"', 'return value="fetchIt(b)"'],
        TEXT_INPUT,
        'string',
      ),
    ]),
  },
  'async-callee-branching-internally': {
    args: () => textArgs('branch'),
    source: moduleSource([BRANCHING_ASYNC, entryFn(['return value="branchy(t)"'], TEXT_INPUT, 'string')]),
  },
  'async-callee-falling-through-an-untaken-branch': {
    args: () => boolArgs({ flag: false }),
    source: moduleSource([FALLTHROUGH_ASYNC, entryFn(['return value="faller(flag)"'], BOOLEAN_FLAG, 'string')]),
  },
  'async-callee-taking-the-else-side': {
    args: () => boolArgs({ flag: false }),
    source: moduleSource([ELSE_TAKING_ASYNC, entryFn(['return value="chooser(flag)"'], BOOLEAN_FLAG, 'string')]),
  },
  'async-callee-in-a-nested-block': {
    args: () => boolArgs({ flag: true }),
    source: moduleSource([
      ASYNC_TEXT_HELPER,
      {
        body: [
          'if cond="flag"',
          '  let name=x value="fetchIt(\\"seed\\")"',
          '  return value="x"',
          'return value="\\"skipped\\""',
        ],
        exported: 'true',
        name: 'route',
        parameters: BOOLEAN_FLAG,
        returns: 'string',
      },
    ]),
  },
  'async-list-across-the-boundary': {
    args: () => ({ xs: { tag: 'list', value: [{ tag: 'boolean', value: true }, { tag: 'boolean', value: false }] } }),
    source: moduleSource([
      ASYNC_LIST,
      entryFn(['return value="pick(xs)"'], [{ name: 'xs', type: 'boolean[]' }], 'boolean[]'),
    ]),
  },
  'callee-prints-into-the-caller-buffer': {
    args: () => textArgs('shared'),
    source: moduleSource([PRINTING_ASYNC, entryFn(['print value="t"', 'return value="loud(t)"'], TEXT_INPUT, 'string')]),
  },
  'direct-async-callee-in-return': {
    args: () => textArgs('seed'),
    source: moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="fetchIt(t)"'], TEXT_INPUT, 'string')]),
  },
  'entry-capability-plus-async-callee': {
    args: () => textArgs('entry'),
    source: moduleSource([
      ASYNC_TEXT_HELPER,
      {
        body: [CAPABILITY_LINE, 'print value="reply"', 'let name=x value="fetchIt(t)"', 'return value="x"'],
        exported: 'true',
        name: 'route',
        parameters: TEXT_INPUT,
        returns: 'string',
      },
    ]),
  },
  'let-then-print-then-return': {
    args: () => textArgs('chain'),
    source: moduleSource([
      ASYNC_TEXT_HELPER,
      entryFn(
        ['let name=x value="fetchIt(t)"', 'print value="fetchIt(x)"', 'return value="fetchIt(x)"'],
        TEXT_INPUT,
        'string',
      ),
    ]),
  },
  'sync-argument-of-an-async-callee': {
    args: () => textArgs('inner'),
    source: moduleSource([
      ASYNC_TEXT_HELPER,
      SYNC_TEXT_HELPER,
      entryFn(['return value="fetchIt(echo(t))"'], TEXT_INPUT, 'string'),
    ]),
  },
  'transitive-async-callee': {
    args: () => textArgs('relayed'),
    source: moduleSource([ASYNC_TEXT_HELPER, RELAY_HELPER, entryFn(['return value="relay(t)"'], TEXT_INPUT, 'string')]),
  },
  'two-capabilities-in-one-callee': {
    args: () => textArgs('double'),
    source: moduleSource([TWO_CAPABILITIES, entryFn(['return value="twice(t)"'], TEXT_INPUT, 'string')]),
  },
});

for (const name of Object.keys(FIXTURES).sort()) {
  test(`RT-1, emitted JavaScript and emitted CPython agree byte for byte on ${name}`, async () => {
    const fixture = FIXTURES[name];
    const { legs } = await threeLegBytes(fixture.source, runtimeRequest(`rt5-behavior-${name}`, fixture.args()));
    assert.equal(legs.direct.envelope.outcome, 'success', JSON.stringify(legs.direct.envelope.diagnostics));
  });
}

test('a callee capability commits its event into the caller buffer in dispatch order', async () => {
  const { legs } = await threeLegBytes(
    FIXTURES['callee-prints-into-the-caller-buffer'].source,
    runtimeRequest('rt5-behavior-order', textArgs('shared')),
  );
  assert.deepEqual(
    [...legs.direct.envelope.events],
    [
      { op: 'stdout', text: 'shared' },
      { op: 'stdout', text: 'shared' },
      {
        input: { presence: 'absent' },
        namespace: 'fixture',
        op: 'capability',
        operation: 'resolve',
        result: { presence: 'value', value: { tag: 'text', value: 'reply-value' } },
      },
      { op: 'stdout', text: 'reply-value' },
    ],
    'the callee print, capability and caller print share one ordered buffer',
  );
});

const CAPABILITY_EVENT = Object.freeze({
  input: { presence: 'absent' },
  namespace: 'fixture',
  op: 'capability',
  operation: 'resolve',
  result: { presence: 'value', value: { tag: 'text', value: 'reply-value' } },
});

test('an untaken callee branch runs its else side and reaches no capability', async () => {
  const { legs } = await threeLegBytes(
    FIXTURES['async-callee-taking-the-else-side'].source,
    runtimeRequest('rt5-behavior-else-side', boolArgs({ flag: false })),
  );
  assert.deepEqual([...legs.direct.envelope.events], [{ op: 'stdout', text: 'else-side' }]);
  assert.equal(legs.direct.calls.length, 0, 'the capability lives on the untaken side');
  assert.equal(legs.javascript.calls.length, 0);
  assert.equal(legs.python.calls.length, 0);
});

test('the same callee takes its then side when the condition holds', async () => {
  const { legs } = await threeLegBytes(
    FIXTURES['async-callee-taking-the-else-side'].source,
    runtimeRequest('rt5-behavior-then-side', boolArgs({ flag: true })),
  );
  assert.deepEqual([...legs.direct.envelope.events], [CAPABILITY_EVENT, { op: 'stdout', text: 'reply-value' }]);
  assert.equal(legs.direct.calls.length, 1, 'the then-side capability dispatches exactly once');
});

test('a callee falls through an untaken branch without running it', async () => {
  const { legs } = await threeLegBytes(
    FIXTURES['async-callee-falling-through-an-untaken-branch'].source,
    runtimeRequest('rt5-behavior-fallthrough', boolArgs({ flag: false })),
  );
  assert.deepEqual([...legs.direct.envelope.events], [CAPABILITY_EVENT, { op: 'stdout', text: 'reply-value' }]);
  assert.deepEqual(legs.direct.envelope.result.value, { tag: 'text', value: 'after' });
});

test('a callee dispatches exactly once per occurrence and the provider sees every call', async () => {
  const { legs } = await threeLegBytes(
    FIXTURES['let-then-print-then-return'].source,
    runtimeRequest('rt5-behavior-dispatch', textArgs('chain')),
  );
  assert.equal(legs.direct.calls.length, 3, 'three async call sites dispatch three provider calls');
  assert.equal(legs.javascript.calls.length, 3);
  assert.equal(legs.python.calls.length, 3);
});
