import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOLEAN_FLAG,
  CAPABILITY_LINE,
  TEXT_INPUT,
  boolArgs,
  entryFn,
  linkedProgram,
  moduleSource,
  runtimeRequest,
  textArgs,
  threeLegBytes,
} from './k0-support.mjs';

const ASYNC_LEAF = Object.freeze({
  body: Object.freeze([CAPABILITY_LINE, 'return value="reply"']),
  name: 'leaf',
  parameters: TEXT_INPUT,
  returns: 'string',
});

function asyncChain(depth) {
  const helpers = [ASYNC_LEAF];
  for (let index = 0; index < depth; index += 1) {
    helpers.push({
      body: [index === 0 ? 'return value="leaf(t)"' : `return value="h${index - 1}(t)"`],
      name: `h${index}`,
      parameters: TEXT_INPUT,
      returns: 'string',
    });
  }
  return moduleSource([...helpers, entryFn([`return value="h${depth - 1}(t)"`], TEXT_INPUT, 'string')]);
}

const FIXTURES = Object.freeze({
  'async-callee-inside-an-unselected-branch': {
    args: () => boolArgs({ flag: false }),
    source: moduleSource([
      {
        body: [CAPABILITY_LINE, 'return value="reply"'],
        name: 'fetchIt',
        parameters: TEXT_INPUT,
        returns: 'string',
      },
      {
        body: [
          'if cond="flag"',
          '  let name=x value="fetchIt(\\"taken\\")"',
          '  return value="x"',
          'return value="\\"untaken\\""',
        ],
        exported: 'true',
        name: 'route',
        parameters: BOOLEAN_FLAG,
        returns: 'string',
      },
    ]),
  },
  'async-chain-of-eight': { args: () => textArgs('deep'), source: asyncChain(8) },
  'async-leaf-under-a-sync-caller-chain': {
    args: () => textArgs('mixed'),
    source: moduleSource([
      ASYNC_LEAF,
      { body: ['return value="t"'], name: 'plain', parameters: TEXT_INPUT, returns: 'string' },
      {
        body: ['let name=a value="plain(t)"', 'return value="leaf(a)"'],
        name: 'both',
        parameters: TEXT_INPUT,
        returns: 'string',
      },
      entryFn(['return value="both(t)"'], TEXT_INPUT, 'string'),
    ]),
  },
  'async-list-return-through-two-hops': {
    args: () => ({ xs: { tag: 'list', value: [{ tag: 'boolean', value: true }] } }),
    source: moduleSource([
      {
        body: [CAPABILITY_LINE, 'print value="reply"', 'return value="xs"'],
        name: 'pick',
        parameters: [{ name: 'xs', type: 'boolean[]' }],
        returns: 'boolean[]',
      },
      {
        body: ['return value="pick(xs)"'],
        name: 'relay',
        parameters: [{ name: 'xs', type: 'boolean[]' }],
        returns: 'boolean[]',
      },
      entryFn(['return value="relay(xs)"'], [{ name: 'xs', type: 'boolean[]' }], 'boolean[]'),
    ]),
  },
  'three-capabilities-across-two-callees': {
    args: () => textArgs('three'),
    source: moduleSource([
      ASYNC_LEAF,
      {
        body: [CAPABILITY_LINE, 'print value="reply"', 'return value="leaf(t)"'],
        name: 'wrap',
        parameters: TEXT_INPUT,
        returns: 'string',
      },
      entryFn(
        ['capability namespace=fixture operation=entry name=first', 'print value="first"', 'return value="wrap(t)"'],
        TEXT_INPUT,
        'string',
      ),
    ]),
  },
});

for (const name of Object.keys(FIXTURES).sort()) {
  test(`RT-1, emitted JavaScript and emitted CPython agree byte for byte on ${name}`, async () => {
    const fixture = FIXTURES[name];
    const { legs } = await threeLegBytes(fixture.source, runtimeRequest(`rt5-k0-${name}`, fixture.args()));
    assert.equal(legs.direct.envelope.outcome, 'success', JSON.stringify(legs.direct.envelope.diagnostics));
  });
}

test('an async chain of eight classifies every hop and dispatches the provider once', async () => {
  const program = await linkedProgram(asyncChain(8));
  assert.equal(program.helpers.length, 9);
  assert.ok(
    program.helpers.every((helper) => helper.async === true),
    'every hop on the path to the capability is async',
  );
  const { legs } = await threeLegBytes(asyncChain(8), runtimeRequest('rt5-k0-chain-calls', textArgs('deep')));
  assert.equal(legs.direct.calls.length, 1);
  assert.equal(legs.javascript.calls.length, 1);
  assert.equal(legs.python.calls.length, 1);
});

test('an unselected async branch never dispatches its provider on any leg', async () => {
  const { legs } = await threeLegBytes(
    FIXTURES['async-callee-inside-an-unselected-branch'].source,
    runtimeRequest('rt5-k0-untaken', boolArgs({ flag: false })),
  );
  assert.deepEqual([...legs.direct.envelope.events], []);
  assert.equal(legs.direct.calls.length, 0);
  assert.equal(legs.javascript.calls.length, 0);
  assert.equal(legs.python.calls.length, 0);
});

test('a pre-cancelled async chain produces the identical failure envelope on all three legs', async () => {
  const { legs } = await threeLegBytes(asyncChain(3), {
    ...runtimeRequest('rt5-k0-cancelled', textArgs('never')),
    control: { preCancelled: true, timeoutMs: null },
  });
  assert.equal(legs.direct.envelope.outcome, 'failure');
  assert.equal(legs.direct.envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual([...legs.direct.envelope.events], [], 'a pre-cancelled async chain commits no event');
});

test('an event budget exhausted inside an async callee fails identically on all three legs', async () => {
  const source = moduleSource([
    {
      body: [
        'print value="t"',
        'print value="t"',
        'print value="t"',
        'print value="t"',
        'print value="t"',
        'print value="t"',
        CAPABILITY_LINE,
        'return value="reply"',
      ],
      name: 'chatty',
      parameters: TEXT_INPUT,
      returns: 'string',
    },
    entryFn(
      ['print value="t"', 'print value="t"', 'print value="t"', 'print value="t"', 'return value="chatty(t)"'],
      TEXT_INPUT,
      'string',
    ),
  ]);
  const { legs } = await threeLegBytes(source, runtimeRequest('rt5-k0-events', textArgs('x')));
  assert.equal(legs.direct.envelope.outcome, 'failure');
  assert.equal(legs.direct.envelope.diagnostics[0].code, 'runtime-limit-exceeded');
});
