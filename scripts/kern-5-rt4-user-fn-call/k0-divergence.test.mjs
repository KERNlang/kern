import assert from 'node:assert/strict';
import test from 'node:test';

import { boolArgs, entryFn, moduleSource, runtimeRequest, threeLegBytes } from './k0-support.mjs';

const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
const LIST_INPUT = Object.freeze([Object.freeze({ name: 'xs', type: 'boolean[]' })]);

const FIXTURES = Object.freeze({
  'branching-callee': {
    args: () => boolArgs({ flag: true }),
    source: moduleSource([
      {
        body: ['if cond="flag"', '  print value="\\"yes\\""', '  return value="false"', 'return value="true"'],
        name: 'negate',
        parameters: BOOLEAN_FLAG,
        returns: 'boolean',
      },
      entryFn(['return value="negate(flag)"']),
    ]),
  },
  'callee-print-into-caller-buffer': {
    args: () => ({ t: { tag: 'text', value: 'shared' } }),
    source: moduleSource([
      { body: ['print value="t"', 'return value="t"'], name: 'shout', parameters: TEXT_INPUT, returns: 'string' },
      entryFn(['print value="shout(t)"', 'print value="shout(t)"', 'return value="t"'], TEXT_INPUT, 'string'),
    ]),
  },
  'chain-of-three': {
    args: () => boolArgs({ flag: false }),
    source: moduleSource([
      { body: ['return value="flag"'], name: 'inner', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      { body: ['return value="inner(flag)"'], name: 'middle', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      { body: ['return value="middle(flag)"'], name: 'outer', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      entryFn(['return value="outer(flag)"']),
    ]),
  },
  'entry-capability-with-call': {
    args: () => boolArgs({ flag: true }),
    source: moduleSource([
      { body: ['return value="flag"'], name: 'helper', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      {
        body: [
          'capability namespace=fixture operation=resolve name=reply',
          'let name=checked value="helper(flag)"',
          'if cond="checked"',
          '  return value="reply"',
          'return value="\\"skipped\\""',
        ],
        exported: 'true',
        name: 'route',
        parameters: BOOLEAN_FLAG,
        returns: 'string',
      },
    ]),
  },
  'list-across-the-boundary': {
    args: () => ({ xs: { tag: 'list', value: [{ tag: 'boolean', value: false }, { tag: 'boolean', value: true }] } }),
    source: moduleSource([
      { body: ['return value="xs"'], name: 'pick', parameters: LIST_INPUT, returns: 'boolean[]' },
      entryFn(['return value="pick(pick(xs))"'], LIST_INPUT, 'boolean[]'),
    ]),
  },
  'result-drives-a-binary': {
    args: () => boolArgs({ flag: true }),
    source: moduleSource([
      { body: ['return value="flag"'], name: 'helper', parameters: BOOLEAN_FLAG, returns: 'boolean' },
      entryFn(['return value="helper(flag) && (helper(flag) == flag)"']),
    ]),
  },
});

for (const name of Object.keys(FIXTURES).sort()) {
  test(`RT-1, emitted JavaScript, and emitted CPython agree byte for byte on ${name}`, async () => {
    const fixture = FIXTURES[name];
    const { legs } = await threeLegBytes(fixture.source, runtimeRequest(`rt4-k0-${name}`, fixture.args()));
    assert.equal(legs.direct.envelope.outcome, 'success', JSON.stringify(legs.direct.envelope.diagnostics));
  });
}

test('a rejected call chain produces the identical failure envelope on all three legs', async () => {
  const source = moduleSource([
    { body: ['return value="flag"'], name: 'helper', parameters: BOOLEAN_FLAG, returns: 'boolean' },
    entryFn(['return value="helper(flag)"']),
  ]);
  const { legs } = await threeLegBytes(source, {
    ...runtimeRequest('rt4-k0-cancelled', boolArgs({ flag: true })),
    control: { preCancelled: true, timeoutMs: null },
  });
  assert.equal(legs.direct.envelope.outcome, 'failure');
  assert.equal(legs.direct.envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual(legs.direct.envelope.events, [], 'a pre-cancelled call chain commits no event');
});
