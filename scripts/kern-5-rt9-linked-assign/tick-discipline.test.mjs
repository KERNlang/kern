import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BOOL_FLAG,
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
} from './k0-support.mjs';

const T = lit;

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
});

// Hand-derived from the measured base model: a leaf statement costs one step plus one
// per expression node; a literal or identifier is one node and a binary is three.
const EXECUTION_STEPS = Object.freeze({
  'assign-binary': 8,
  'assign-in-skipped-branch': 7,
  'assign-in-taken-branch': 9,
  'assign-literal': 6,
  'let-binary-control': 8,
  'let-literal-control': 6,
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
