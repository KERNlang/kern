import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_TEXT_HELPER,
  BOOLEAN_FLAG,
  CAPABILITY_LINE,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  assertLegParity,
  boolArgs,
  compileJavaScript,
  entryFn,
  executeJavaScriptChild,
  executeKernKir,
  moduleSource,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  textArgs,
  threeLegAbort,
} from './k0-support.mjs';

const ASYNC_CHAIN = moduleSource([
  ASYNC_TEXT_HELPER,
  RELAY_HELPER,
  entryFn(['print value="t"', 'return value="relay(t)"'], TEXT_INPUT, 'string'),
]);

// The abort can only be delivered while a leg is suspended, and the only suspension point is the
// provider call. A single capability therefore cannot separate the commit from the next statement:
// the split needs a second capability, whose provider aborts after the first event is committed.
const TWO_CAPABILITY_CALLEE = moduleSource([
  {
    body: [
      CAPABILITY_LINE,
      'print value="reply"',
      'capability namespace=fixture operation=second name=again',
      'print value="again"',
      'return value="again"',
    ],
    name: 'twice',
    parameters: TEXT_INPUT,
    returns: 'string',
  },
  entryFn(['return value="twice(t)"'], TEXT_INPUT, 'string'),
]);

// RT-4 shaped: no capability anywhere, so no leg has a suspension point at all.
const SYNC_CHAIN = moduleSource([
  SYNC_TEXT_HELPER,
  { body: ['return value="echo(t)"'], name: 'outer', parameters: TEXT_INPUT, returns: 'string' },
  entryFn(['let name=a value="outer(t)"', 'return value="outer(a)"'], TEXT_INPUT, 'string'),
]);

test('already-aborted-before-call: every leg refuses before any statement runs', async () => {
  const request = {
    ...runtimeRequest('rt5-cancel-pre', textArgs('never')),
    control: { preCancelled: true, timeoutMs: null },
  };
  const legs = await threeLegAbort(ASYNC_CHAIN, request);
  const envelope = assertLegParity(legs, 'already-aborted-before-call');
  assert.equal(envelope.outcome, 'failure');
  assert.equal(envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual([...envelope.events], [], 'a pre-cancelled run commits nothing');
  assert.equal(legs.direct.calls.length, 0, 'the provider is never reached');
  assert.equal(legs.javascript.calls.length, 0);
  assert.equal(legs.python.calls.length, 0);
});

test('an already-aborted external signal is refused before any statement runs on RT-1', async () => {
  const verified = await project(ASYNC_CHAIN);
  const controller = new AbortController();
  controller.abort();
  const envelope = await executeKernKir(verified, runtimeRequest('rt5-cancel-signal', textArgs('never')), {
    ...provider([]),
    signal: controller.signal,
  });
  assert.equal(envelope.outcome, 'failure');
  assert.equal(envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual([...envelope.events], []);
});

test('queued-abort-before-call: a capability-free chain still completes identically on both legs', async () => {
  const verified = await project(SYNC_CHAIN);
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success', `javascript compile failed: ${compiled.code}`);
  for (const depth of [0, 1, 2, 3, 4]) {
    const request = runtimeRequest(`rt5-cancel-queued-${depth}`, textArgs('sync'));
    const direct = await executeKernKir(verified, request, { ...provider([]), signal: queueAbort(depth) });
    const javascript = await executeJavaScriptChild(compiled.artifact.bytes, request, {
      abortAfterMicrotasks: depth,
    });
    assert.equal(direct.outcome, 'success', `depth ${depth}: RT-5 must not add a suspension to a synchronous chain`);
    assert.equal(javascript.envelope.outcome, 'success', `depth ${depth}`);
    assert.deepEqual(direct.result.value, javascript.envelope.result.value, `depth ${depth}`);
  }
});

test('abort-during-provider-await: the post-await checkpoint fires on every leg and commits nothing', async () => {
  const legs = await threeLegAbort(ASYNC_CHAIN, runtimeRequest('rt5-cancel-during', textArgs('seed')), {
    abortAtInvocation: 1,
  });
  const envelope = assertLegParity(legs, 'abort-during-provider-await');
  assert.equal(envelope.outcome, 'failure');
  assert.equal(envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual(
    [...envelope.events],
    [{ op: 'stdout', text: 'seed' }],
    'the leading print is committed, the interrupted capability is not',
  );
  assert.equal(legs.direct.calls.length, 1, 'the provider observed the call it aborted inside');
  assert.equal(legs.javascript.calls.length, 1);
  assert.equal(legs.python.calls.length, 1);
});

test('abort-after-provider-resolves-before-next-statement: the committed event survives, the next one never lands', async () => {
  const legs = await threeLegAbort(TWO_CAPABILITY_CALLEE, runtimeRequest('rt5-cancel-split', textArgs('split')), {
    abortAtInvocation: 2,
  });
  const envelope = assertLegParity(legs, 'abort-after-provider-resolves-before-next-statement');
  assert.equal(envelope.outcome, 'failure');
  assert.equal(envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual(
    [...envelope.events],
    [
      {
        input: { presence: 'absent' },
        namespace: 'fixture',
        op: 'capability',
        operation: 'resolve',
        result: { presence: 'value', value: { tag: 'text', value: 'reply-value' } },
      },
      { op: 'stdout', text: 'reply-value' },
    ],
    'the first capability event and the print after it are committed; the second capability is not',
  );
  assert.equal(legs.direct.calls.length, 2);
  assert.equal(legs.javascript.calls.length, 2);
  assert.equal(legs.python.calls.length, 2);
});

test('a callee statement boundary is a cancellation checkpoint on every leg', async () => {
  const source = moduleSource([
    {
      body: [CAPABILITY_LINE, 'print value="reply"', 'print value="t"', 'return value="reply"'],
      name: 'after',
      parameters: TEXT_INPUT,
      returns: 'string',
    },
    entryFn(['return value="after(t)"'], TEXT_INPUT, 'string'),
  ]);
  const legs = await threeLegAbort(source, runtimeRequest('rt5-cancel-checkpoint', textArgs('cp')), {
    abortAtInvocation: 1,
  });
  const envelope = assertLegParity(legs, 'callee statement checkpoint');
  assert.equal(envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual([...envelope.events], [], 'the aborted capability commits nothing and the prints never run');
});

test('an uninterrupted run of the same fixtures is a success on all three legs', async () => {
  for (const [name, source] of [
    ['async-chain', ASYNC_CHAIN],
    ['two-capability-callee', TWO_CAPABILITY_CALLEE],
  ]) {
    const legs = await threeLegAbort(source, runtimeRequest(`rt5-cancel-control-${name}`, textArgs('ok')));
    const envelope = assertLegParity(legs, `${name} control`);
    assert.equal(envelope.outcome, 'success', `${name}: the control must not be cancelled`);
  }
});

test('an async callee under a boolean branch is cancelled at the same checkpoint on every leg', async () => {
  const source = moduleSource([
    ASYNC_TEXT_HELPER,
    {
      body: ['if cond="flag"', '  let name=x value="fetchIt(\\"deep\\")"', '  return value="x"', 'return value="\\"no\\""'],
      exported: 'true',
      name: 'route',
      parameters: BOOLEAN_FLAG,
      returns: 'string',
    },
  ]);
  const legs = await threeLegAbort(source, runtimeRequest('rt5-cancel-branch', boolArgs({ flag: true })), {
    abortAtInvocation: 1,
  });
  const envelope = assertLegParity(legs, 'branch checkpoint');
  assert.equal(envelope.diagnostics[0].code, 'execution-cancelled');
  assert.deepEqual([...envelope.events], []);
});
