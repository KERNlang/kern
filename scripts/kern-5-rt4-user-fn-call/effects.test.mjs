import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ENTRY,
  LIMITS,
  createLinkedKirClosureWalk,
  helperLadder,
  linkWithPolicy,
  linkedProgramHelpers,
  linkedStatementsInvokeCapability as linkedStatementsInvokeCapability,
  boolArgs,
  compileJavaScript,
  compilePython,
  entryFn,
  executeJavaScriptChild,
  executeKernKir,
  executePythonChild,
  linkedProgram,
  moduleSource,
  project,
  provider,
  runtimeRequest,
  threeLegBytes,
} from './k0-support.mjs';

const TEXT_PARAMETERS = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

const SHOUT = Object.freeze({
  body: Object.freeze(['print value="t"', 'return value="t"']),
  name: 'shout',
  parameters: TEXT_PARAMETERS,
  returns: 'string',
});

function textArgs(t) {
  return { t: { tag: 'text', value: t } };
}

test('a print inside a callee lands in the caller output buffer in dispatch order', async () => {
  const source = moduleSource([
    SHOUT,
    entryFn(['print value="\\"before\\""', 'print value="shout(t)"', 'return value="t"'], TEXT_PARAMETERS, 'string'),
  ]);
  const { legs } = await threeLegBytes(source, runtimeRequest('rt4-print-order', textArgs('middle')));
  assert.deepEqual(
    legs.direct.envelope.events.map((event) => [event.op, event.text]),
    [
      ['stdout', 'before'],
      ['stdout', 'middle'],
      ['stdout', 'middle'],
    ],
    'the callee print is committed before the caller print that consumed its value',
  );
});

test('callee prints consume the caller event budget', async () => {
  const source = moduleSource([
    SHOUT,
    entryFn(['print value="shout(t)"', 'print value="shout(t)"', 'return value="t"'], TEXT_PARAMETERS, 'string'),
  ]);
  const verified = await project(source);
  assert.ok(verified !== undefined);
  const request = (maxEvents) => ({
    ...runtimeRequest('rt4-print-budget', textArgs('x')),
    limits: { ...LIMITS, maxEvents },
  });
  const withinBudget = await executeKernKir(verified, request(4), provider([]));
  assert.equal(withinBudget.outcome, 'success');
  assert.equal(withinBudget.events.length, 4, 'two callee prints plus two caller prints share one buffer');
  const overBudget = await executeKernKir(verified, request(3), provider([]));
  assert.equal(overBudget.outcome, 'failure');
  assert.equal(overBudget.diagnostics[0].code, 'runtime-limit-exceeded');
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success');
  assert.equal(python.outcome, 'success');
  const emittedJavaScript = await executeJavaScriptChild(javascript.artifact.bytes, request(3));
  const emittedPython = await executePythonChild(python.artifact.bytes, request(3));
  assert.equal(emittedJavaScript.envelope.diagnostics[0].code, 'runtime-limit-exceeded');
  assert.equal(emittedPython.envelope.diagnostics[0].code, 'runtime-limit-exceeded');
});

test('the shared capability predicate traverses the whole reachable closure, not just the entry', async () => {
  const source = moduleSource([
    SHOUT,
    { body: ['return value="shout(t)"'], name: 'wrap', parameters: TEXT_PARAMETERS, returns: 'string' },
    entryFn(['return value="wrap(shout(t))"'], TEXT_PARAMETERS, 'string'),
  ]);
  const program = await linkedProgram(source);
  assert.deepEqual(
    (program.helpers ?? []).map((helper) => helper.name),
    ['shout', 'wrap'],
    'every reachable helper is linked, name-sorted, including one reached only through an argument',
  );
  const helpers = new Map(program.helpers.map((helper) => [helper.name, helper.handler]));
  assert.equal(linkedStatementsInvokeCapability(program.program.statements, helpers), false);
  const withCapability = new Map(helpers);
  withCapability.set('shout', {
    ...helpers.get('shout'),
    statements: [
      { input: undefined, kind: 'capability', name: 'reply', namespace: 'fixture', operation: 'resolve' },
      ...helpers.get('shout').statements,
    ],
  });
  assert.equal(
    linkedStatementsInvokeCapability(program.program.statements, withCapability),
    true,
    'a capability reached only through an argument-position call of a transitive callee is detected',
  );
  assert.equal(
    linkedStatementsInvokeCapability(program.program.statements, undefined),
    false,
    'without the closure the entry statements alone invoke nothing',
  );
});

test('an entry capability still requires a provider when the handler also calls a helper', async () => {
  const source = moduleSource([
    { body: ['return value="flag"'], name: 'helper', parameters: [{ name: 'flag', type: 'boolean' }], returns: 'boolean' },
    {
      body: [
        'capability namespace=fixture operation=resolve name=reply',
        'let name=checked value="helper(flag)"',
        'return value="reply"',
      ],
      exported: 'true',
      name: ENTRY.handlerName,
      parameters: [{ name: 'flag', type: 'boolean' }],
      returns: 'string',
    },
  ]);
  const verified = await project(source);
  assert.ok(verified !== undefined);
  const request = runtimeRequest('rt4-provider', boolArgs({ flag: true }));
  const missing = await executeKernKir(verified, request, {});
  assert.equal(missing.outcome, 'failure');
  assert.equal(missing.diagnostics[0].code, 'capability-error');
  assert.deepEqual(missing.events, [], 'no event is committed when the provider is missing');
  const supplied = await executeKernKir(verified, request, provider([]));
  assert.equal(supplied.outcome, 'success');
  assert.deepEqual(supplied.result.value, { tag: 'text', value: 'reply-value' });
});

test('a call-free program still declares no helpers and no capability', async () => {
  const program = await linkedProgram(moduleSource([entryFn(['return value="flag"'])]));
  assert.equal(program.helpers, undefined, 'the optional helpers field is absent for a call-free program');
  assert.equal(linkedStatementsInvokeCapability(program.program.statements, undefined), false);
});

test('the capability closure visits every helper of a DAG exactly once', async () => {
  const width = 24;
  const verified = await project(helperLadder(width));
  assert.ok(verified !== undefined, 'F5 must project the ladder fixture');
  const linked = linkWithPolicy(verified, { maxCallDepth: width + 1 });
  assert.equal(linked.outcome, 'success', `ladder link failed: ${linked.code}`);
  const helpers = linkedProgramHelpers(linked.program.helpers);
  assert.equal(helpers.size, width, 'every ladder helper is reachable');
  const walk = createLinkedKirClosureWalk();
  assert.equal(linkedStatementsInvokeCapability(linked.program.program.statements, helpers, walk), false);
  assert.equal(
    walk.visits,
    width,
    'RT4_CLOSURE_BUDGET: a helper DAG must be traversed once per helper, never once per path',
  );
  const repeated = createLinkedKirClosureWalk();
  for (const helper of linked.program.helpers) {
    linkedStatementsInvokeCapability(helper.handler.statements, helpers, repeated);
  }
  assert.ok(
    repeated.visits <= width,
    `RT4_CLOSURE_BUDGET: a shared walk must stay linear across helpers, observed ${repeated.visits}`,
  );
});

test('a cycle is never memoized, so the closure answer stays exact', () => {
  const statements = [{ arguments: [], handlerName: 'a', kind: 'user-call' }].map((value) => ({
    kind: 'return',
    value,
  }));
  const helpers = new Map([
    ['a', { parameters: [], returnType: { kind: 'boolean' }, statements: [{ kind: 'return', value: { arguments: [], handlerName: 'b', kind: 'user-call' } }] }],
    ['b', { parameters: [], returnType: { kind: 'boolean' }, statements: [{ kind: 'return', value: { arguments: [], handlerName: 'a', kind: 'user-call' } }] }],
  ]);
  const walk = createLinkedKirClosureWalk();
  assert.equal(linkedStatementsInvokeCapability(statements, helpers, walk), false);
  assert.equal(walk.done.has('a'), false, 'a cycle-tainted result must never be cached');
  assert.equal(walk.done.has('b'), false, 'a cycle-tainted result must never be cached');
});
