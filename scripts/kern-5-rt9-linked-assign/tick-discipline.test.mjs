import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_TEXT_HELPER,
  BOOL_FLAG,
  POSITIONS,
  TEXT_AND_FLAG,
  compileJavaScript,
  directStepBudget,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  flagArgs,
  lit,
  project,
  provider,
  queueAbort,
  route,
  runtimeRequest,
  textArgs,
  withHelper,
} from './k0-support.mjs';

const T = lit;

const ASYNC_ARGS = (flag) => ({ ...textArgs('q'), ...flagArgs(flag) });

const ASYNC_LET_CONTROL = withHelper(
  ASYNC_TEXT_HELPER,
  [
    `let name=s value=${T('a')}`,
    'let name=r value="fetchIt(t)"',
    'let name=u value="r"',
    'if cond="flag"',
    `  let name=v value=${T('c')}`,
    'return value="u"',
  ],
  { parameters: TEXT_AND_FLAG },
);

const METERING = Object.freeze({
  'assign-binary': {
    args: () => ({}),
    source: route(['let name=b value="true"', 'assign target="b" value="1 < 2"', 'return value="b"'], {
      returns: 'boolean',
    }),
  },
  'assign-in-skipped-branch': {
    args: () => flagArgs(false),
    source: route(
      [`let name=s value=${T('a')}`, 'if cond="flag"', `  assign target="s" value=${T('b')}`, 'return value="s"'],
      { parameters: BOOL_FLAG },
    ),
  },
  'assign-in-taken-branch': {
    args: () => flagArgs(true),
    source: route(
      [`let name=s value=${T('a')}`, 'if cond="flag"', `  assign target="s" value=${T('b')}`, 'return value="s"'],
      { parameters: BOOL_FLAG },
    ),
  },
  'assign-literal': {
    args: () => ({}),
    source: route([`let name=s value=${T('a')}`, `assign target="s" value=${T('b')}`, 'return value="s"']),
  },
  'let-binary-control': {
    args: () => ({}),
    source: route(['let name=b value="true"', 'let name=c value="1 < 2"', 'return value="c"'], { returns: 'boolean' }),
  },
  'let-literal-control': {
    args: () => ({}),
    source: route([`let name=s value=${T('a')}`, `let name=t value=${T('b')}`, 'return value="s"']),
  },
  'assign-self-and': { args: () => ({}), source: POSITIONS['self-referential-and']() },
  'assign-self-or': { args: () => flagArgs(true), source: POSITIONS['self-referential-or']() },
  'let-self-and-control': {
    args: () => ({}),
    source: route(
      ['let name=b value="true"', 'let name=c value="false"', 'let name=d value="b && c"', 'return value="d"'],
      { returns: 'boolean' },
    ),
  },
  'let-self-or-control': {
    args: () => flagArgs(true),
    source: route(['let name=b value="false"', 'let name=d value="b || flag"', 'return value="d"'], {
      parameters: BOOL_FLAG,
      returns: 'boolean',
    }),
  },
  'assign-after-async-skipped': { args: () => ASYNC_ARGS(false), source: POSITIONS['after-async-suspension']() },
  'assign-after-async-taken': { args: () => ASYNC_ARGS(true), source: POSITIONS['after-async-suspension']() },
  'let-after-async-skipped-control': { args: () => ASYNC_ARGS(false), source: ASYNC_LET_CONTROL },
  'let-after-async-taken-control': { args: () => ASYNC_ARGS(true), source: ASYNC_LET_CONTROL },
});

// Hand-derived from the measured base model: a leaf statement costs one step plus one per
// expression node; a literal or a let-bound identifier is one node, a parameter read is two,
// and a binary is one plus its two operands. The async rows are deltas against their
// let-shaped control, which fixes the cost of `let r = fetchIt(t)` at 8.
const EXECUTION_STEPS = Object.freeze({
  'assign-after-async-skipped': 17,
  'assign-after-async-taken': 19,
  'assign-binary': 8,
  'assign-in-skipped-branch': 7,
  'assign-in-taken-branch': 9,
  'assign-literal': 6,
  'assign-self-and': 10,
  'assign-self-or': 9,
  'let-after-async-skipped-control': 17,
  'let-after-async-taken-control': 19,
  'let-binary-control': 8,
  'let-literal-control': 6,
  'let-self-and-control': 10,
  'let-self-or-control': 9,
});

test('every RT-9 metering fixture consumes exactly the pinned number of execution steps', async () => {
  const observed = {};
  for (const name of Object.keys(METERING).sort()) {
    const { args, source } = METERING[name];
    observed[name] = (await directStepBudget(source, args(), `rt9-meter-${name}`)).execution;
  }
  assert.deepEqual(
    observed,
    EXECUTION_STEPS,
    'RT9_METER_DRIFT: an absolute step count moved, so the assign metering model changed',
  );
});

test('an assign costs exactly one step plus its value, the same as a let of that value', () => {
  assert.equal(EXECUTION_STEPS['assign-literal'], EXECUTION_STEPS['let-literal-control']);
  assert.equal(EXECUTION_STEPS['assign-binary'], EXECUTION_STEPS['let-binary-control']);
});

test('the assign statement tick and the value walk are charged separately', () => {
  assert.equal(EXECUTION_STEPS['assign-literal'] - 4, 2, 'one statement tick plus one literal node');
  assert.equal(EXECUTION_STEPS['assign-binary'] - 4, 4, 'one statement tick plus three binary nodes');
});

test('an assign in a skipped branch is charged nothing at all', () => {
  assert.equal(EXECUTION_STEPS['assign-in-taken-branch'] - EXECUTION_STEPS['assign-in-skipped-branch'], 2);
});

test('reading the assign target inside its own value costs no more than reading any other binding', () => {
  assert.equal(EXECUTION_STEPS['assign-self-and'], EXECUTION_STEPS['let-self-and-control']);
  assert.equal(EXECUTION_STEPS['assign-self-or'], EXECUTION_STEPS['let-self-or-control']);
  assert.equal(
    EXECUTION_STEPS['assign-self-and'] - EXECUTION_STEPS['let-literal-control'],
    4,
    'one statement tick plus three binary nodes over two let-bound operands',
  );
  assert.equal(EXECUTION_STEPS['assign-self-or'] - 4, 5, 'the same shape costs one more when an operand is a parameter');
});

test('an assign across an async suspension is metered exactly as the let it replaces', () => {
  assert.equal(EXECUTION_STEPS['assign-after-async-taken'], EXECUTION_STEPS['let-after-async-taken-control']);
  assert.equal(EXECUTION_STEPS['assign-after-async-skipped'], EXECUTION_STEPS['let-after-async-skipped-control']);
  assert.equal(EXECUTION_STEPS['assign-after-async-taken'] - EXECUTION_STEPS['assign-after-async-skipped'], 2);
});

const QUEUE_DEPTHS = Object.freeze([0, 1, 2, 3, 4]);

async function comparedUnderQueuedAbort(source, args, abortAfterMicrotasks, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the tick-discipline source');
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success', `javascript compile failed: ${compiled.code}`);
  const request = runtimeRequest(`${requestId}-${abortAfterMicrotasks}`, args);
  const direct = await executeKernKir(verified, request, {
    ...provider([]),
    signal: queueAbort(abortAfterMicrotasks),
  });
  const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request, { abortAfterMicrotasks });
  return { direct, emitted };
}

for (const depth of QUEUE_DEPTHS) {
  test(`an assign adds no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(
      METERING['assign-literal'].source,
      {},
      depth,
      'rt9-tick-plain',
    );
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT9_TICK_DISCIPLINE_DIVERGENCE: an assign must not add an RT-1-only await point',
    );
  });
}

for (const depth of QUEUE_DEPTHS) {
  test(`an assign inside a branch adds no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(
      METERING['assign-in-taken-branch'].source,
      flagArgs(true),
      depth,
      'rt9-tick-branch',
    );
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT9_TICK_DISCIPLINE_DIVERGENCE: branch depth must not change the assign cancellation checkpoint',
    );
  });
}

test('pre-cancellation fails closed before an assign runs, byte-identically on both JavaScript legs', async () => {
  const source = METERING['assign-literal'].source;
  const verified = await project(source);
  assert.ok(verified !== undefined);
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success');
  const request = runtimeRequest('rt9-tick-pre-cancel', {}, { preCancelled: true, timeoutMs: null });
  const direct = await executeKernKir(verified, request, provider([]));
  const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request);
  assert.equal(direct.outcome, 'failure');
  assert.equal(direct.diagnostics[0]?.code, 'execution-cancelled');
  assert.deepEqual([...direct.events], []);
  assert.deepEqual(Buffer.from(envelopeBytes(emitted.envelope)), Buffer.from(envelopeBytes(direct)));
});
