import assert from 'node:assert/strict';
import test from 'node:test';

import { LINKED_KIR_CROSS_CALL_TYPES } from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import {
  HELPER_IDENTITY,
  LINKED_KIR_DEFAULT_CALL_POLICY,
  admission,
  assertLinkRejected,
  callProgram,
  entryFn,
  helperChain,
  linkWithPolicy,
  linkedProgramHelpers,
  linkedStatementsCallDepth,
  moduleSource,
  project,
} from './k0-support.mjs';

const TEXT_PARAMETERS = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

const TEXT_HELPER = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'helper',
  parameters: TEXT_PARAMETERS,
  returns: 'string',
});

test('arity is exact at link on all three legs', async () => {
  await assertLinkRejected(callProgram(['return value="helper()"']), 'too few arguments');
  await assertLinkRejected(callProgram(['return value="helper(flag, flag)"']), 'too many arguments');
  const nullary = moduleSource([
    { body: ['return value="true"'], name: 'yes', parameters: [], returns: 'boolean' },
    entryFn(['return value="yes(flag)"']),
  ]);
  await assertLinkRejected(nullary, 'argument passed to a nullary callee');
});

test('an argument whose static cross-call type differs from the parameter fails closed', async () => {
  await assertLinkRejected(
    moduleSource([TEXT_HELPER, entryFn(['return value="helper(flag)"'], HELPER_IDENTITY.parameters, 'string')]),
    'boolean argument for a text parameter',
  );
  await assertLinkRejected(
    callProgram(['return value="helper(t)"'], { helpers: [HELPER_IDENTITY], parameters: TEXT_PARAMETERS }),
    'text argument for a boolean parameter',
  );
  await assertLinkRejected(
    moduleSource([
      { body: ['return value="xs"'], name: 'pick', parameters: [{ name: 'xs', type: 'boolean[]' }], returns: 'boolean[]' },
      entryFn(['return value="pick(flag)"'], HELPER_IDENTITY.parameters, 'boolean[]'),
    ]),
    'scalar argument for a list parameter',
  );
});

test('an argument with no static cross-call type fails closed', async () => {
  await assertLinkRejected(
    moduleSource([
      TEXT_HELPER,
      {
        body: [
          'capability namespace=fixture operation=resolve name=reply',
          'return value="helper(reply)"',
        ],
        exported: 'true',
        name: 'route',
        parameters: [],
        returns: 'string',
      },
    ]),
    'capability result as an argument',
  );
  await assertLinkRejected(
    moduleSource([
      TEXT_HELPER,
      entryFn(['let name=parsed value="Json.parse(t)"', 'return value="helper(parsed)"'], TEXT_PARAMETERS, 'string'),
    ]),
    'Json intrinsic result as an argument',
  );
  await assertLinkRejected(
    moduleSource([
      { body: ['return value="xs"'], name: 'pick', parameters: [{ name: 'xs', type: 'boolean[]' }], returns: 'boolean[]' },
      entryFn(['return value="pick([])"'], [], 'boolean[]'),
    ]),
    'an empty list literal has no element type',
  );
  await assertLinkRejected(
    moduleSource([
      { body: ['return value="xs"'], name: 'pick', parameters: [{ name: 'xs', type: 'boolean[]' }], returns: 'boolean[]' },
      entryFn(['return value="pick([flag, t])"'], [...HELPER_IDENTITY.parameters, ...TEXT_PARAMETERS], 'boolean[]'),
    ]),
    'a mixed list literal has no element type',
  );
});

test('direct and mutual recursion are rejected at link on all three legs', async () => {
  await assertLinkRejected(
    callProgram(['return value="loop(flag)"'], {
      helpers: [{ ...HELPER_IDENTITY, body: ['return value="loop(flag)"'], name: 'loop' }],
    }),
    'direct recursion',
  );
  await assertLinkRejected(
    moduleSource([
      { ...HELPER_IDENTITY, body: ['return value="b(flag)"'], name: 'a' },
      { ...HELPER_IDENTITY, body: ['return value="a(flag)"'], name: 'b' },
      entryFn(['return value="a(flag)"']),
    ]),
    'mutual recursion',
  );
  await assertLinkRejected(
    callProgram(['return value="route(flag)"'], { helpers: [] }),
    'the entry calling itself',
  );
});

test('only a bare same-module identifier callee is admitted', async () => {
  await assertLinkRejected(callProgram(['return value="obj.helper(flag)"']), 'member callee');
  await assertLinkRejected(
    callProgram(['let name=obj value="flag"', 'return value="obj.helper(flag)"']),
    'member callee whose object is a live binding',
  );
  await assertLinkRejected(callProgram(['return value="helper?.(flag)"']), 'optional call');
  await assertLinkRejected(callProgram(['return value="nope(flag)"'], { helpers: [] }), 'unknown callee');
  await assertLinkRejected(
    callProgram(['let name=helper value="flag"', 'return value="helper(flag)"']),
    'a value binding shadowing a function name is not callable',
  );
  const crossModule = [
    { moduleId: 'lib.kern', source: moduleSource([{ ...HELPER_IDENTITY, exported: 'true' }]) },
    {
      moduleId: 'route.kern',
      source: `use path="./lib"\n  from name=helper\n${moduleSource([entryFn(['return value="helper(flag)"'])])}`,
    },
  ];
  await assertLinkRejected(crossModule, 'cross-module callee');
});

test('a capability in a callee reached from a non-statement position is rejected at link', async () => {
  const capabilityHelper = {
    body: ['capability namespace=fixture operation=resolve name=reply', 'return value="reply"'],
    name: 'fetch',
    parameters: TEXT_PARAMETERS,
    returns: 'string',
  };
  await assertLinkRejected(
    moduleSource([
      capabilityHelper,
      TEXT_HELPER,
      entryFn(['return value="helper(fetch(t))"'], TEXT_PARAMETERS, 'string'),
    ]),
    'capability reached only through an argument-position call',
  );
  await assertLinkRejected(
    moduleSource([
      capabilityHelper,
      { body: ['return value="t"'], name: 'wrap', parameters: TEXT_PARAMETERS, returns: 'string' },
      TEXT_HELPER,
      entryFn(['return value="helper(wrap(fetch(t)))"'], TEXT_PARAMETERS, 'string'),
    ]),
    'capability nested two argument-position calls deep',
  );
});

test('the closed cross-call type set is one exhaustive contract', () => {
  assert.deepEqual(Object.keys(LINKED_KIR_CROSS_CALL_TYPES).sort(), ['boolean', 'list<boolean>', 'list<text>', 'text']);
  assert.deepEqual(LINKED_KIR_CROSS_CALL_TYPES.boolean, { element: undefined, kind: 'boolean' });
  assert.deepEqual(LINKED_KIR_CROSS_CALL_TYPES['list<text>'], { element: 'text', kind: 'list' });
});

test('an integer signature in call position is gated by the closed cross-call type set, not by F5', async () => {
  const uncalled = await admission(
    moduleSource([
      { body: ['return value="n"'], name: 'inc', parameters: [{ name: 'n', type: 'integer' }], returns: 'integer' },
      entryFn(['return value="true"'], []),
    ]),
  );
  assert.equal(uncalled.projection, 'projected', 'RT-8 admitted the integer spelling at F5');
  assert.equal(uncalled.rt1, 'admitted', 'an uncalled integer helper is inert');
  for (const spelling of ['integer', 'number']) {
    const called = await admission(
      moduleSource([
        { body: ['return value="n"'], name: 'inc', parameters: [{ name: 'n', type: spelling }], returns: spelling },
        entryFn(['return value="inc(1) == 1"'], []),
      ]),
    );
    assert.equal(called.projection, 'projected', spelling);
    for (const leg of ['rt1', 'javascript', 'python']) {
      assert.equal(called[leg], 'handler-entry-unsupported', `${spelling} must stay outside the cross-call set on ${leg}`);
    }
  }
});

test('the call-depth policy admits a chain at the limit and rejects the next one identically on all three legs', async () => {
  const limit = LINKED_KIR_DEFAULT_CALL_POLICY.maxCallDepth;
  const atLimit = await admission(helperChain(limit));
  assert.equal(atLimit.projection, 'projected');
  assert.equal(atLimit.rt1, 'admitted', `a chain of ${limit} helpers must link`);
  assert.equal(atLimit.javascript, 'admitted');
  assert.equal(atLimit.python, 'admitted');
  await assertLinkRejected(helperChain(limit + 1), `a chain of ${limit + 1} helpers`);
});

test('the call-depth policy is configurable rather than a fixed literal', async () => {
  const deeper = LINKED_KIR_DEFAULT_CALL_POLICY.maxCallDepth + 1;
  const verified = await project(helperChain(deeper));
  assert.ok(verified !== undefined);
  assert.equal(linkWithPolicy(verified, LINKED_KIR_DEFAULT_CALL_POLICY).outcome, 'failure');
  const raised = linkWithPolicy(verified, { maxCallDepth: deeper });
  assert.equal(raised.outcome, 'success', 'a host may raise the bound for its own stack budget');
  assert.equal(linkedStatementsCallDepth(raised.program.program.statements, linkedProgramHelpers(raised.program.helpers)), deeper);
  const lowered = linkWithPolicy(await project(helperChain(4)), { maxCallDepth: 3 });
  assert.equal(lowered.outcome, 'failure', 'a host may lower the bound below the default');
  assert.equal(lowered.code, 'handler-entry-unsupported');
});

test('a duplicate function name is a frontend rejection, so the linker rule can never widen it', async () => {
  const duplicate = moduleSource([
    { body: ['return value="true"'], name: 'spare', parameters: [], returns: 'boolean' },
    { body: ['return value="false"'], name: 'spare', parameters: [], returns: 'boolean' },
    HELPER_IDENTITY,
    entryFn(['return value="helper(flag)"'], HELPER_IDENTITY.parameters),
  ]);
  const row = await admission(duplicate);
  assert.equal(
    row.projection,
    'not-projected',
    'F5 rejects any module declaring a duplicate function name, reachable or not',
  );
  const clean = await admission(
    moduleSource([
      { body: ['return value="true"'], name: 'spare', parameters: [], returns: 'boolean' },
      HELPER_IDENTITY,
      entryFn(['return value="helper(flag)"'], HELPER_IDENTITY.parameters),
    ]),
  );
  assert.equal(clean.rt1, 'admitted', 'an unreachable sibling function must not widen rejection');
  assert.equal(clean.javascript, 'admitted');
  assert.equal(clean.python, 'admitted');
});
