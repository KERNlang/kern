import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VOID_FALLTHROUGH,
  compileJavaScript,
  entryOf,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  text,
} from './k0-support.mjs';

// RT-1 reaches the void completion through an async frame walker; the emitted targets reach it
// inline. If the completion is built after the walker's promise resolves rather than inside it,
// RT-1 gains a cancellation checkpoint the emitted legs do not have, and an abort queued on the
// resolving microtask flips RT-1 to cancelled while the emitted leg succeeds. That is the RT-2
// tick-discipline bug class, and these depths are where it shows.
const QUEUE_DEPTHS = Object.freeze([0, 1, 2, 3, 4]);

const NON_VOID_CONTROL = entryOf([text('first'), text('second'), 'return value="\\"done\\""'], { returns: 'string' });

const CAPABILITY_VOID = entryOf([
  text('before'),
  'capability namespace=fixture operation=resolve name=reply',
  'print value="reply"',
]);

async function comparedUnderQueuedAbort(source, abortAfterMicrotasks, requestId) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the tick-discipline source');
  const compiled = compileJavaScript(verified);
  assert.equal(compiled.outcome, 'success', `javascript compile failed: ${compiled.code}`);
  const request = runtimeRequest(requestId, {});
  const direct = await executeKernKir(verified, request, {
    ...provider([]),
    signal: queueAbort(abortAfterMicrotasks),
  });
  const emitted = await executeJavaScriptChild(compiled.artifact.bytes, request, { abortAfterMicrotasks });
  return { direct, emitted };
}

for (const depth of QUEUE_DEPTHS) {
  test(`the void completion adds no RT-1-only checkpoint: abort queued at microtask depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(VOID_FALLTHROUGH, depth, `rt6-tick-void-${depth}`);
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT6_TICK_DISCIPLINE_DIVERGENCE: falling through to the void completion must not add an RT-1-only await point',
    );
  });
}

for (const depth of QUEUE_DEPTHS) {
  test(`a void handler behaves like its non-void control under an abort queued at depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(NON_VOID_CONTROL, depth, `rt6-tick-value-${depth}`);
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'the value-return control must stay byte-identical, so the void comparison is measured against a sound baseline',
    );
  });
}

for (const depth of QUEUE_DEPTHS) {
  test(`a void completion after an awaited capability stays byte-identical at depth ${depth}`, async () => {
    const { direct, emitted } = await comparedUnderQueuedAbort(CAPABILITY_VOID, depth, `rt6-tick-cap-${depth}`);
    assert.deepEqual(
      Buffer.from(envelopeBytes(emitted.envelope)),
      Buffer.from(envelopeBytes(direct)),
      'RT6_TICK_DISCIPLINE_DIVERGENCE: the void tail after a real await must agree with the emitted leg',
    );
  });
}

test('the queued-abort sweep is discriminating: it spans both a cancelled and a successful outcome', async () => {
  const outcomes = new Set();
  for (const depth of QUEUE_DEPTHS) {
    const { direct } = await comparedUnderQueuedAbort(CAPABILITY_VOID, depth, `rt6-tick-span-${depth}`);
    outcomes.add(direct.outcome);
  }
  assert.deepEqual(
    [...outcomes].sort(),
    ['failure', 'success'],
    'a sweep that never cancels, or never succeeds, would agree vacuously on every leg',
  );
});
