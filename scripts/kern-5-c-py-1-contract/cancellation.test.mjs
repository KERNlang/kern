import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCompileSuccess,
  compile,
  executeKernKir,
  nativeExecute,
  projection,
  runtimeRequest,
} from './support.mjs';

async function fixture() {
  const verified = await projection();
  const compiled = assertCompileSuccess(await compile(verified));
  return { verified, bytes: compiled.artifact.bytes };
}

async function nativeOne(bytes, run) {
  const output = await nativeExecute(bytes, { runs: [run] });
  return { result: output.results[0], metadata: output.metadata[0] };
}

function code(envelope) {
  assert.equal(envelope.outcome, 'failure');
  assert.equal(envelope.events.length, 0);
  return envelope.diagnostics[0]?.code;
}

test('preCancelled and an already-set external asyncio.Event fail before provider effects', async () => {
  const { verified, bytes } = await fixture();
  const preCancelled = runtimeRequest('pre-cancelled', '{"x":1}', [], {
    control: { preCancelled: true, timeoutMs: null },
  });
  let directCalls = 0;
  const directPre = await executeKernKir(verified, preCancelled, { invoke: () => { directCalls += 1; } });
  const nativePre = await nativeOne(bytes, { request: preCancelled, reply: 'reply' });
  assert.deepEqual(nativePre.result, directPre);
  assert.equal(code(nativePre.result), 'execution-cancelled');
  assert.equal(nativePre.metadata.calls.length, 0);
  assert.equal(directCalls, 0);

  const request = runtimeRequest('signal-before', '{"x":1}', []);
  const controller = new AbortController();
  controller.abort();
  const directSignal = await executeKernKir(verified, request, {
    signal: controller.signal,
    invoke: () => { directCalls += 1; },
  });
  const nativeSignal = await nativeOne(bytes, {
    request,
    reply: 'reply',
    scenario: 'signal-before',
    externalSignal: true,
  });
  assert.deepEqual(nativeSignal.result, directSignal);
  assert.equal(code(nativeSignal.result), 'execution-cancelled');
  assert.equal(nativeSignal.metadata.calls.length, 0);
  assert.equal(directCalls, 0);
});

test('external cancellation races an awaitable provider and best-effort cancels it without a later event', async () => {
  const { verified, bytes } = await fixture();
  const request = runtimeRequest('cancel-pending', '{"x":1}', []);
  const controller = new AbortController();
  let directStarted;
  const started = new Promise((resolve) => { directStarted = resolve; });
  const directPending = executeKernKir(verified, request, {
    signal: controller.signal,
    invoke: () => { directStarted(); return new Promise(() => {}); },
  });
  await started;
  controller.abort();
  const expected = await directPending;
  const native = await nativeOne(bytes, {
    request,
    scenario: 'slow-cancel',
    externalSignal: true,
    cancelDelayMs: 0,
  });
  assert.deepEqual(native.result, expected);
  assert.equal(code(native.result), 'execution-cancelled');
  assert.equal(native.metadata.calls.length, 1);
  assert.equal(native.metadata.calls[0].signalIsInternal, true);
  assert.equal(native.metadata.providerCancelled, true);
  assert.ok(native.metadata.elapsedMs < 300, `provider cancellation was awaited for ${native.metadata.elapsedMs}ms`);
});

test('a signal set by the provider is observed at the post-result checkpoint before capability append', async () => {
  const { verified, bytes } = await fixture();
  const request = runtimeRequest('cancel-after-provider', '{"x":1}', []);
  const controller = new AbortController();
  const expected = await executeKernKir(verified, request, {
    signal: controller.signal,
    invoke: () => {
      controller.abort();
      return { presence: 'value', value: { tag: 'text', value: 'reply' } };
    },
  });
  const native = await nativeOne(bytes, {
    request,
    reply: 'reply',
    scenario: 'signal-after-result',
    externalSignal: true,
  });
  assert.deepEqual(native.result, expected);
  assert.equal(code(native.result), 'execution-cancelled');
  assert.equal(native.metadata.calls.length, 1);
});

test('timeout at an awaitable-provider checkpoint matches RT-1 and wins over a later external signal', async () => {
  const { verified, bytes } = await fixture();
  const request = runtimeRequest('timeout', '{"x":1}', [], {
    control: { preCancelled: false, timeoutMs: 5 },
  });
  const expected = await executeKernKir(verified, request, { invoke: () => new Promise(() => {}) });
  const native = await nativeOne(bytes, { request, scenario: 'pending' });
  assert.deepEqual(native.result, expected);
  assert.equal(code(native.result), 'execution-timeout');
  assert.equal(native.metadata.calls.length, 1);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  const expectedRace = await executeKernKir(verified, request, {
    signal: controller.signal,
    invoke: () => new Promise(() => {}),
  });
  const nativeRace = await nativeOne(bytes, {
    request,
    scenario: 'pending',
    externalSignal: true,
    cancelDelayMs: 30,
  });
  assert.deepEqual(nativeRace.result, expectedRace);
  assert.equal(code(nativeRace.result), 'execution-timeout');
});

test('provider-owned CancelledError becomes capability-error while outer task cancellation still propagates', async () => {
  const { bytes } = await fixture();
  const request = runtimeRequest('provider-cancelled', '{"x":1}', []);
  const providerCancelled = await nativeOne(bytes, { request, scenario: 'provider-cancelled' });
  assert.equal(code(providerCancelled.result), 'capability-error');
  assert.equal(providerCancelled.metadata.calls.length, 1);

  const syncProviderCancelled = await nativeOne(bytes, { request, scenario: 'provider-cancelled-sync' });
  assert.equal(code(syncProviderCancelled.result), 'capability-error');
  assert.equal(syncProviderCancelled.metadata.calls.length, 1);

  const outerCancelled = await nativeOne(bytes, { request, scenario: 'outer-task-cancel' });
  assert.deepEqual(outerCancelled.result, { outerCancellationPropagated: true });
  assert.equal(outerCancelled.metadata.calls.length, 1);
  assert.equal(outerCancelled.metadata.providerCancelled, true);
  assert.ok(outerCancelled.metadata.elapsedMs < 1_000, `outer cancellation awaited the provider for ${outerCancelled.metadata.elapsedMs}ms`);
});

test('outer-task-cancel reports a pre-provider failure without waiting for a provider start', async () => {
  const { bytes } = await fixture();
  const request = {
    ...runtimeRequest('outer-cancel-pre-provider-fault', '{"x":1}', []),
    arguments: {},
  };
  const native = await nativeOne(bytes, { request, scenario: 'outer-task-cancel' });
  assert.equal(code(native.result), 'invalid-handler-arguments');
  assert.equal(native.metadata.calls.length, 0);
  assert.ok(native.metadata.elapsedMs < 1_000, `pre-provider failure waited for ${native.metadata.elapsedMs}ms`);
});
