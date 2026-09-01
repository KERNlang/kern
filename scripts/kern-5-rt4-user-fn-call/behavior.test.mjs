import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HELPER_IDENTITY,
  boolArgs,
  callProgram,
  directStepBudget,
  entryFn,
  moduleSource,
  runtimeRequest,
  threeLegBytes,
} from './k0-support.mjs';

const TEXT_PARAMETERS = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);
const LIST_PARAMETERS = Object.freeze([Object.freeze({ name: 'xs', type: 'boolean[]' })]);

const HELPER_NOT = Object.freeze({
  body: Object.freeze(['if cond="flag"', '  return value="false"', 'return value="true"']),
  name: 'negate',
  parameters: Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]),
  returns: 'boolean',
});

const HELPER_PAIR = Object.freeze({
  body: Object.freeze(['return value="a && b"']),
  name: 'both',
  parameters: Object.freeze([
    Object.freeze({ name: 'a', type: 'boolean' }),
    Object.freeze({ name: 'b', type: 'boolean' }),
  ]),
  returns: 'boolean',
});

async function result(source, args, requestId) {
  const { legs } = await threeLegBytes(source, runtimeRequest(requestId, args));
  assert.equal(legs.direct.envelope.outcome, 'success', JSON.stringify(legs.direct.envelope.diagnostics));
  return legs.direct.envelope;
}

test('a call in return position agrees on all three legs for both boolean arguments', async () => {
  const source = callProgram(['return value="helper(flag)"']);
  for (const flag of [false, true]) {
    const envelope = await result(source, boolArgs({ flag }), `rt4-return-${flag}`);
    assert.deepEqual(envelope.result.value, { tag: 'boolean', value: flag });
  }
});

test('a call in let, if-condition, and binary-operand position agrees on all three legs', async () => {
  const fixtures = [
    ['let', callProgram(['let name=x value="helper(flag)"', 'return value="x"']), (flag) => flag],
    [
      'if',
      callProgram(['if cond="negate(flag)"', '  return value="true"', 'return value="false"'], {
        helpers: [HELPER_NOT],
      }),
      (flag) => !flag,
    ],
    ['binary', callProgram(['return value="helper(flag) && flag"']), (flag) => flag],
  ];
  for (const [name, source, expected] of fixtures) {
    for (const flag of [false, true]) {
      const envelope = await result(source, boolArgs({ flag }), `rt4-${name}-${flag}`);
      assert.deepEqual(envelope.result.value, { tag: 'boolean', value: expected(flag) }, `${name} ${flag}`);
    }
  }
});

test('a nested call evaluates the inner call exactly once before the outer dispatch', async () => {
  const source = moduleSource([
    { body: ['print value="\\"inner\\""', 'return value="flag"'], name: 'helper', parameters: HELPER_IDENTITY.parameters, returns: 'boolean' },
    entryFn(['return value="helper(helper(flag))"']),
  ]);
  const envelope = await result(source, boolArgs({ flag: true }), 'rt4-nested');
  assert.deepEqual(
    envelope.events.map((event) => event.text),
    ['inner', 'inner'],
    'each nested dispatch prints exactly once',
  );
  assert.deepEqual(envelope.result.value, { tag: 'boolean', value: true });
});

test('arguments are evaluated left to right exactly once', async () => {
  const source = moduleSource([
    { body: ['print value="t"', 'return value="t"'], name: 'trace', parameters: TEXT_PARAMETERS, returns: 'string' },
    {
      body: ['return value="a"'],
      name: 'first',
      parameters: [
        { name: 'a', type: 'string' },
        { name: 'b', type: 'string' },
      ],
      returns: 'string',
    },
    entryFn(['return value="first(trace(\\"a\\"), trace(\\"b\\"))"'], [], 'string'),
  ]);
  const envelope = await result(source, {}, 'rt4-argument-order');
  assert.deepEqual(
    envelope.events.map((event) => event.text),
    ['a', 'b'],
    'left operand is traced before the right operand, each exactly once',
  );
  assert.deepEqual(envelope.result.value, { tag: 'text', value: 'a' });
});

test('a zero-argument call and a two-argument call agree on all three legs', async () => {
  const nullary = moduleSource([
    { body: ['return value="true"'], name: 'yes', parameters: [], returns: 'boolean' },
    entryFn(['return value="yes()"'], []),
  ]);
  assert.deepEqual((await result(nullary, {}, 'rt4-nullary')).result.value, { tag: 'boolean', value: true });
  const pair = moduleSource([HELPER_PAIR, entryFn(['return value="both(flag, flag)"'])]);
  for (const flag of [false, true]) {
    const envelope = await result(pair, boolArgs({ flag }), `rt4-pair-${flag}`);
    assert.deepEqual(envelope.result.value, { tag: 'boolean', value: flag });
  }
});

test('list-typed arguments and list return types cross the call boundary on all three legs', async () => {
  const source = moduleSource([
    { body: ['return value="xs"'], name: 'pick', parameters: LIST_PARAMETERS, returns: 'boolean[]' },
    entryFn(['return value="pick(xs)"'], LIST_PARAMETERS, 'boolean[]'),
  ]);
  const args = { xs: { tag: 'list', value: [{ tag: 'boolean', value: true }, { tag: 'boolean', value: false }] } };
  const envelope = await result(source, args, 'rt4-list');
  assert.deepEqual(envelope.result.value, args.xs);
  const literal = moduleSource([
    { body: ['return value="xs"'], name: 'pick', parameters: LIST_PARAMETERS, returns: 'boolean[]' },
    entryFn(['return value="pick([flag, flag])"'], HELPER_IDENTITY.parameters, 'boolean[]'),
  ]);
  const fromLiteral = await result(literal, boolArgs({ flag: true }), 'rt4-list-literal');
  assert.deepEqual(fromLiteral.result.value, {
    tag: 'list',
    value: [
      { tag: 'boolean', value: true },
      { tag: 'boolean', value: true },
    ],
  });
});

test('a helper body may branch and bind locally without leaking into the caller scope', async () => {
  const source = moduleSource([
    {
      body: ['let name=inner value="flag"', 'if cond="inner"', '  return value="false"', 'return value="true"'],
      name: 'negate',
      parameters: HELPER_IDENTITY.parameters,
      returns: 'boolean',
    },
    entryFn(['let name=inner value="flag"', 'return value="negate(inner)"']),
  ]);
  for (const flag of [false, true]) {
    const envelope = await result(source, boolArgs({ flag }), `rt4-scope-${flag}`);
    assert.deepEqual(envelope.result.value, { tag: 'boolean', value: !flag });
  }
});

test('metering charges the call node, each argument, one dispatch, and the body but never the callee return', async () => {
  const args = boolArgs({ flag: true });
  const control = await directStepBudget(callProgram(['return value="flag"'], { helpers: [] }), args, 'rt4-control');
  const call = await directStepBudget(callProgram(['return value="helper(flag)"']), args, 'rt4-call');
  const nested = await directStepBudget(callProgram(['return value="helper(helper(flag))"']), args, 'rt4-nested-meter');
  const pair = await directStepBudget(
    moduleSource([HELPER_PAIR, entryFn(['return value="both(flag, flag)"'])]),
    args,
    'rt4-pair-meter',
  );
  const bodyLet = await directStepBudget(
    moduleSource([
      {
        body: ['let name=y value="flag"', 'return value="y"'],
        name: 'helper',
        parameters: HELPER_IDENTITY.parameters,
        returns: 'boolean',
      },
      entryFn(['return value="helper(flag)"']),
    ]),
    args,
    'rt4-body-meter',
  );
  assert.equal(
    call.execution - control.execution,
    3,
    'one call adds exactly one argument node, one dispatch step, and the one-node callee return expression',
  );
  assert.equal(nested.execution - call.execution, 3, 'a second dispatch costs exactly the same three steps');
  assert.equal(
    pair.execution - control.execution,
    6,
    'two arguments plus one dispatch plus a three-node callee body',
  );
  assert.equal(
    bodyLet.execution - call.execution,
    2,
    'a callee let costs one statement step and one expression node; the callee return costs no statement step',
  );
});
