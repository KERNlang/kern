import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BOOL_CONSTANT,
  BOOL_IDENTITY,
  CAPABILITY,
  INT_CONSTANT,
  POSITIONS,
  between,
  compileJavaScript,
  directStepBudget,
  emittedArtifacts,
  entrySource,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  positionArguments,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  stepRequest,
  threeLegBytes,
  withHelpers,
} from './k0-support.mjs';

const LINKED_EXPRESSION_URL = new URL(
  '../../packages/core/src/kir-runtime/linked-kir-program/expression.ts',
  import.meta.url,
);
const RT1_EXPRESSION_URL = new URL('../../packages/core/src/kir-runtime/expression.ts', import.meta.url);

const ASYNC_BOOL_HELPER_LOCAL = Object.freeze({
  body: Object.freeze([CAPABILITY, 'return value="true"']),
  name: 'ah',
  parameters: Object.freeze([]),
  returns: 'boolean',
});

// The boolean controls are RT-4 and RT-5 shapes measurable at base; every integer row is pinned
// against one of them, so the claim "the meter is unchanged" is an identity and not a belief.
const METERING = Object.freeze({
  'async-bool-let-control': () =>
    withHelpers([ASYNC_BOOL_HELPER_LOCAL], ['let name=n value="ah()"', 'return value="n"'], { returns: 'boolean' }),
  'bool-let-call-control': () =>
    withHelpers([BOOL_CONSTANT], ['let name=n value="h()"', 'return value="n"'], { returns: 'boolean' }),
  'bool-nullary-control': () => withHelpers([BOOL_CONSTANT], ['return value="h()"'], { returns: 'boolean' }),
  'bool-unary-control': () => withHelpers([BOOL_IDENTITY], ['return value="hb(true)"'], { returns: 'boolean' }),
  'int-accumulator': () => POSITIONS['int-accumulator'](),
  'int-arith-on-result': () => POSITIONS['int-arith-on-result'](),
  'int-async-let': () => POSITIONS['int-async-let'](),
  'int-big-argument': () => POSITIONS['int-big-argument'](),
  'int-both': () => POSITIONS['int-both'](),
  'int-let-call': () => withHelpers([INT_CONSTANT], ['let name=n value="hi()"', 'return value="n"']),
  'int-mixed-signature': () => POSITIONS['int-mixed-signature'](),
  'int-nested-call': () => POSITIONS['int-nested-call'](),
  'int-return': () => POSITIONS['int-return'](),
  'int-two-args': () => POSITIONS['int-two-args'](),
  'return-literal-control': () => entrySource(['return value="1"']),
});

// Hand-derived from RT-4's charge under RT-10-pre's corrected node model: one step per executed
// statement, one per evaluated expression node, one per declared parameter of the entry, one
// dispatch step per call, and nothing for a callee's declared parameters or its return statement.
const EXECUTION_STEPS = Object.freeze({
  'async-bool-let-control': 8,
  'bool-let-call-control': 6,
  'bool-nullary-control': 4,
  'bool-unary-control': 5,
  'int-accumulator': 11,
  'int-arith-on-result': 7,
  'int-async-let': 8,
  'int-big-argument': 5,
  'int-both': 5,
  'int-let-call': 6,
  'int-mixed-signature': 6,
  'int-nested-call': 8,
  'int-return': 4,
  'int-two-args': 8,
  'return-literal-control': 2,
});

test('every RT-10-X metering fixture consumes exactly the pinned number of execution steps', async () => {
  const observed = {};
  for (const name of Object.keys(METERING).sort()) {
    observed[name] = (await directStepBudget(METERING[name](), positionArguments(name), `rt10x-meter-${name}`))
      .execution;
  }
  assert.deepEqual(
    observed,
    EXECUTION_STEPS,
    'RT10X_METER_DRIFT: an absolute step count moved, so the per-call charge changed with the type',
  );
});

test('the cross-call type is not metered: an integer call costs exactly what its boolean twin costs', () => {
  assert.equal(EXECUTION_STEPS['int-return'], EXECUTION_STEPS['bool-nullary-control'], 'nullary');
  assert.equal(EXECUTION_STEPS['int-both'], EXECUTION_STEPS['bool-unary-control'], 'one argument');
  assert.equal(EXECUTION_STEPS['int-let-call'], EXECUTION_STEPS['bool-let-call-control'], 'in let position');
  assert.equal(EXECUTION_STEPS['int-async-let'], EXECUTION_STEPS['async-bool-let-control'], 'RT-5 suspension');
});

test('an argument node costs one step regardless of the magnitude crossing the boundary', () => {
  assert.equal(EXECUTION_STEPS['int-both'] - EXECUTION_STEPS['int-return'], 1, 'exactly one argument node');
  assert.equal(
    EXECUTION_STEPS['int-big-argument'],
    EXECUTION_STEPS['int-both'],
    'a 19-digit argument costs what a one-digit argument costs',
  );
});

test('a second argument and a second frame each add exactly their own nodes', () => {
  assert.equal(
    EXECUTION_STEPS['int-two-args'] - EXECUTION_STEPS['int-both'],
    3,
    'one argument node plus the callee body binary and its second identifier',
  );
  assert.equal(
    EXECUTION_STEPS['int-mixed-signature'] - EXECUTION_STEPS['int-both'],
    1,
    'a callee declared parameter costs nothing; only its argument node is charged',
  );
  assert.equal(
    EXECUTION_STEPS['int-nested-call'] - EXECUTION_STEPS['int-both'],
    3,
    'the inner call node, its dispatch step and the inner callee identifier',
  );
});

test('arithmetic over a call result and the accumulator decompose into the inherited node model', () => {
  assert.equal(
    EXECUTION_STEPS['int-arith-on-result'] - EXECUTION_STEPS['int-return'],
    3,
    'the binary node, its right literal and the callee argument node',
  );
  assert.equal(
    EXECUTION_STEPS['int-accumulator'] - EXECUTION_STEPS['int-both'],
    6,
    'one let and its literal, one assign, the binary and its identifier, and the final read',
  );
});

test('the linked type resolvers add no await point and no cancellation checkpoint', async () => {
  const source = await readFile(LINKED_EXPRESSION_URL, 'utf8');
  const resolvers = between(
    source,
    'export function staticExpressionType',
    'export function containsAsyncCall',
    'the linked type resolvers',
  );
  for (const token of ['await', 'Promise', 'queueMicrotask', 'setImmediate', 'checkAbort']) {
    assert.equal(resolvers.includes(token), false, `the type resolvers must not mention ${token}`);
  }
  const runtime = await readFile(RT1_EXPRESSION_URL, 'utf8');
  const guard = between(runtime, 'export function matchesType', 'type BinaryEvaluator', 'the RT-1 type guard');
  assert.ok(
    guard.includes('value.tag === type.kind'),
    'RT10X_GUARD_DRIFT: the runtime must keep comparing a value tag against the type record kind',
  );
  assert.equal(guard.includes('integer'), false, 'the runtime guard must stay type-generic, with no integer branch');
});

test('a synchronous integer helper is emitted with no await on either leg', async () => {
  const artifacts = await emittedArtifacts(POSITIONS['int-both']());
  const javascript = between(artifacts.javascript, 'const __f0=', 'try {', 'the emitted JavaScript integer helper');
  const python = between(artifacts.python, '    def _f0(', '    try:', 'the emitted Python integer helper');
  for (const token of ['await', 'async', 'Promise']) {
    assert.equal(javascript.includes(token), false, `the JavaScript integer helper must not mention ${token}`);
  }
  for (const token of ['await', 'async']) {
    assert.equal(python.includes(token), false, `the Python integer helper must not mention ${token}`);
  }
});

async function checkpointCensus(source) {
  const artifacts = await emittedArtifacts(source);
  const javascript = between(
    between(
      artifacts.javascript,
      'const __runSpecialized=',
      'const execute=async(input,executionOptions)',
      'the emitted JavaScript specialized handler',
    ),
    'try {',
    '} finally {',
    'the emitted JavaScript statement region',
  );
  const python = between(
    between(
      artifacts.python,
      'async def _run_specialized(',
      'async def execute(',
      'the emitted Python specialized handler',
    ),
    '    try:\n',
    '    finally:',
    'the emitted Python statement region',
  );
  return {
    javascript: (javascript.match(/__checkAbort\(\)/gu) ?? []).length,
    python: (python.match(/_check_abort\(\)/gu) ?? []).length,
  };
}

test('an integer call carries exactly the checkpoints of the boolean call of the same shape', async () => {
  assert.deepEqual(
    await checkpointCensus(POSITIONS['int-both']()),
    await checkpointCensus(METERING['bool-unary-control']()),
    'RT10X_CHECKPOINT_CENSUS_DRIFT: an integer call must check cancellation once per emitted statement, no more',
  );
  assert.deepEqual(
    await checkpointCensus(METERING['int-let-call']()),
    await checkpointCensus(METERING['bool-let-call-control']()),
    'RT10X_CHECKPOINT_CENSUS_DRIFT: the let-position twin must agree too',
  );
});

const QUEUE_DEPTHS = Object.freeze([0, 1, 2, 3, 4]);

test('a queued abort is never observable mid-chain and RT-1 agrees with the emitted JavaScript', async () => {
  const source = POSITIONS['int-nested-call']();
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the tick-discipline source');
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success', `javascript compile failed: ${compiled.code}`);
  for (const abortAfterMicrotasks of QUEUE_DEPTHS) {
    const request = runtimeRequest(`rt10x-abort-${abortAfterMicrotasks}`, {});
    const direct = await executeKernKir(verified, request, {
      ...provider([]),
      signal: queueAbort(abortAfterMicrotasks),
    });
    const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request, { abortAfterMicrotasks });
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      `RT10X_TICK_DIVERGENCE: depth ${abortAfterMicrotasks}`,
    );
    assert.ok(
      direct.outcome === 'success' || direct.diagnostics[0]?.code === 'execution-cancelled',
      'a synchronous integer call chain is either whole or cancelled, never partial',
    );
  }
});

test('an already-cancelled request is refused before any integer call runs', async () => {
  const { legs } = await threeLegBytes(
    POSITIONS['int-both'](),
    runtimeRequest('rt10x-pre-cancelled', {}, { preCancelled: true, timeoutMs: null }),
  );
  const result = legs.direct.envelope;
  assert.equal(result.outcome, 'failure');
  assert.equal(result.diagnostics[0]?.code, 'execution-cancelled');
  assert.deepEqual([...result.events], []);
});

// A shared `maxSteps` is not a shared budget across legs: RT-1 meters linking at run time while
// an emitted artifact has its linking baked in at compile time, so the pinned totals are RT-1's.
// What is comparable is the threshold itself, which this row pins as exact rather than monotone.
test('one step below the pinned total is the exact threshold, and it fails closed', async () => {
  const source = POSITIONS['int-both']();
  const budget = await directStepBudget(source, {}, 'rt10x-budget');
  const total = budget.link + budget.execution;
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the budget fixture');
  const sufficient = await executeKernKir(verified, stepRequest('rt10x-budget-ok', {}, total), provider([]));
  assert.equal(sufficient.outcome, 'success', 'the exact pinned budget must succeed');
  const starved = await executeKernKir(verified, stepRequest('rt10x-budget-short', {}, total - 1), provider([]));
  assert.equal(starved.outcome, 'failure', 'one step less must fail');
  assert.equal(starved.diagnostics[0]?.code, 'runtime-limit-exceeded');
  assert.deepEqual([...starved.events], []);
});
