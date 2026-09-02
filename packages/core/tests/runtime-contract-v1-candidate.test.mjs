import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  executeKernRuntimeHandlerAsync,
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
  KernRuntimeHandlerError,
} from '@kernlang/core/runtime/handler';
import { encodeInternalRuntimeEnvelope } from '../dist/runtime-envelope/normalize.js';
import { normalizeInternalRuntimeSlot } from '../dist/runtime-envelope/value.js';
import { observeRuntimeTimers } from './runtime-contract-v1-timer-observer.mjs';

const constitution = JSON.parse(
  readFileSync(new URL('../../../scripts/runtime-contract-v1/constitution.json', import.meta.url), 'utf8'),
);
const goldens = JSON.parse(
  readFileSync(new URL('../../../scripts/runtime-contract-v1/goldens.json', import.meta.url), 'utf8'),
);
const proofInventory = JSON.parse(
  readFileSync(new URL('../../../scripts/runtime-contract-v1/proof-inventory.json', import.meta.url), 'utf8'),
);

function request(fixture, abi = KERN_RUNTIME_HANDLER_ABI) {
  return {
    abi,
    arguments: fixture.arguments,
    identity: { handlerName: fixture.handlerName, sourcePath: fixture.sourcePath },
    source: fixture.source,
  };
}

function runtimeLimits(override = null) {
  return { ...goldens.limits, ...(override ?? {}) };
}

function providerMaps(fixture, calls) {
  if (fixture === null) return {};
  const { kind, namespace, operation } = fixture;
  const result = () => {
    calls.count += 1;
    if (kind === 'poison') throw new Error('poisoned provider invoked');
    if (kind === 'non-portable') return () => 'non-portable';
    if (kind === 'pending') return new Promise(() => {});
    return fixture.value;
  };
  return {
    asyncCapabilities: { [namespace]: { [operation]: async () => result() } },
    capabilities: { [namespace]: { [operation]: () => result() } },
  };
}

function scheduler(kind) {
  if (kind === null) return undefined;
  if (kind === 'pre-aborted') {
    const controller = new AbortController();
    controller.abort();
    return { signal: controller.signal };
  }
  if (kind === 'timeout') return { timeoutMs: 1 };
  throw new Error(`unknown scheduler ${kind}`);
}

function errorRecord(error) {
  assert.ok(error instanceof KernRuntimeHandlerError);
  return { name: error.name, code: error.code, message: error.message };
}

test('literal v1 behavior matrix matches public sync and async bytes', async () => {
  assert.deepEqual(goldens.cases.map(({ id }) => id), proofInventory.behavior.map(({ id }) => id));
  for (const fixture of goldens.cases) {
    const calls = { count: 0 };
    const maps = providerMaps(fixture.provider, calls);
    const options = {
      capabilities: maps.capabilities,
      enabled: true,
      limits: runtimeLimits(fixture.limits),
      scheduler: scheduler(fixture.scheduler),
    };
    const expected = goldens.envelopes[fixture.expected];
    if (fixture.modes.includes('sync')) {
      const sync = executeKernRuntimeHandlerSync(request(fixture.request), options);
      assert.deepEqual(sync, expected, `${fixture.id} sync envelope`);
      assert.equal(JSON.stringify(sync), JSON.stringify(expected), `${fixture.id} sync bytes`);
    }
    if (fixture.modes.includes('async')) {
      const asyncEnvelope = await executeKernRuntimeHandlerAsync(request(fixture.request), {
        ...options,
        asyncCapabilities: maps.asyncCapabilities,
        capabilityTimeoutMs: fixture.id === 'scheduler-timeout' ? 100 : 20,
      });
      assert.deepEqual(asyncEnvelope, expected, `${fixture.id} async envelope`);
      assert.equal(JSON.stringify(asyncEnvelope), JSON.stringify(expected), `${fixture.id} async bytes`);
    }
    if (fixture.provider?.kind === 'poison') assert.equal(calls.count, 0, `${fixture.id} provider calls`);
  }
});

test('literal ingress matrix freezes sync throws and async rejections', async () => {
  const baseFixture = goldens.cases[0];
  const baseRequest = request(baseFixture.request);
  for (const fixture of goldens.ingress) {
    let invocation = baseRequest;
    let options = { enabled: true, limits: runtimeLimits() };
    if (fixture.id === 'disabled') options = { ...options, enabled: false };
    if (fixture.id === 'invalid-abi') invocation = { ...invocation, abi: 'wrong-abi' };
    if (fixture.id === 'invalid-request') invocation = { ...invocation, arguments: {} };
    if (fixture.id === 'invalid-limits') options = { ...options, limits: { ...options.limits, maxBytes: 0 } };
    if (fixture.id === 'invalid-options') options = { ...options, unknown: true };
    assert.throws(
      () => executeKernRuntimeHandlerSync(invocation, options),
      (error) => assert.deepEqual(errorRecord(error), fixture.error) === undefined,
      `${fixture.id} sync throw`,
    );
    await assert.rejects(
      executeKernRuntimeHandlerAsync(invocation, { ...options, capabilityTimeoutMs: 20 }),
      (error) => assert.deepEqual(errorRecord(error), fixture.error) === undefined,
      `${fixture.id} async rejection`,
    );
  }
});

test('all seven limit fields, including maxIterations, freeze minimum-valid and zero-invalid boundaries', async () => {
  const fixture = goldens.cases[2];
  for (const boundary of goldens.limitValidation) {
    const minimum = runtimeLimits({ [boundary.id]: boundary.minimum });
    assert.doesNotThrow(() => executeKernRuntimeHandlerSync(request(fixture.request), { enabled: true, limits: minimum }));
    await assert.doesNotReject(
      executeKernRuntimeHandlerAsync(request(fixture.request), {
        capabilityTimeoutMs: 20,
        enabled: true,
        limits: minimum,
      }),
    );
    const invalid = runtimeLimits({ [boundary.id]: boundary.invalid });
    assert.throws(
      () => executeKernRuntimeHandlerSync(request(fixture.request), { enabled: true, limits: invalid }),
      (error) => errorRecord(error).code === 'invalid-limits',
    );
    await assert.rejects(
      executeKernRuntimeHandlerAsync(request(fixture.request), {
        capabilityTimeoutMs: 20,
        enabled: true,
        limits: invalid,
      }),
      (error) => errorRecord(error).code === 'invalid-limits',
    );
  }
});

test('literal enforcement witnesses freeze every declared limit family', async () => {
  const byId = Object.fromEntries(goldens.limitEnforcement.map((entry) => [entry.id, entry]));
  const source = goldens.cases[0].request.source;
  const byteLength = new TextEncoder().encode(source).length;
  const byteRequest = request(goldens.cases[0].request);
  const byteAt = executeKernRuntimeHandlerSync(byteRequest, {
    enabled: true,
    limits: runtimeLimits({ maxBytes: byteLength }),
  });
  const byteOver = executeKernRuntimeHandlerSync(byteRequest, {
    enabled: true,
    limits: runtimeLimits({ maxBytes: byteLength - 1 }),
  });
  assert.equal(byteAt.outcome, byId.bytes.expected[0]);
  assert.equal(byteOver.diagnostics[0]?.code, byId.bytes.expected[1]);

  const listSource = (values) => [
    'fn name=answer returns="string[]"',
    '  handler lang="kern"',
    `    return value="[${values.map((value) => `\\"${value}\\"`).join(', ')}]"`,
  ].join('\n');
  const listOptions = { enabled: true, limits: runtimeLimits({ maxCollectionLength: 1 }) };
  const listAt = executeKernRuntimeHandlerSync(request({ ...goldens.cases[0].request, arguments: [], source: listSource(['one']) }), listOptions);
  const listOver = executeKernRuntimeHandlerSync(request({ ...goldens.cases[0].request, arguments: [], source: listSource(['one', 'two']) }), listOptions);
  assert.equal(listAt.outcome, byId.collection.expected[0]);
  assert.equal(listOver.diagnostics[0]?.code, byId.collection.expected[1]);

  const depthLimits = runtimeLimits({ maxDepth: 1 });
  assert.equal(normalizeInternalRuntimeSlot({ outer: 'value' }, depthLimits, '$.depth').presence, 'value');
  assert.throws(
    () => normalizeInternalRuntimeSlot({ outer: { inner: 'value' } }, depthLimits, '$.depth'),
    (error) => error?.code === byId.depth.expected[1],
  );

  const diagnosticLimits = runtimeLimits({ maxDiagnostics: 1 });
  const failure = goldens.envelopes['failure-link'];
  const atBytes = encodeInternalRuntimeEnvelope(failure, diagnosticLimits);
  const truncatedBytes = encodeInternalRuntimeEnvelope(
    { ...failure, diagnostics: [...failure.diagnostics, ...failure.diagnostics] },
    diagnosticLimits,
  );
  assert.match(new TextDecoder().decode(atBytes), new RegExp(byId.diagnostics.expected[0], 'u'));
  assert.match(new TextDecoder().decode(truncatedBytes), new RegExp(byId.diagnostics.expected[1], 'u'));

  const eventOptions = { enabled: true, limits: runtimeLimits({ maxEvents: 1 }) };
  const eventSource = (count) => [
    'fn name=answer returns=string',
    '  handler lang="kern"',
    ...Array.from({ length: count }, (_, index) => `    print value="\\"${index}\\""`),
    '    return value="\\"ok\\""',
  ].join('\n');
  const eventAt = executeKernRuntimeHandlerSync(request({ ...goldens.cases[0].request, arguments: [], source: eventSource(1) }), eventOptions);
  const eventOver = executeKernRuntimeHandlerSync(request({ ...goldens.cases[0].request, arguments: [], source: eventSource(2) }), eventOptions);
  assert.equal(eventAt.outcome, byId.events.expected[0]);
  assert.equal(eventOver.diagnostics[0]?.code, byId.events.expected[1]);

  const shortFixture = { ...goldens.cases[0].request, handlerName: 'answer', sourcePath: 'a' };
  const stringAt = executeKernRuntimeHandlerSync(request(shortFixture), {
    enabled: true,
    limits: runtimeLimits({ maxStringBytes: 6 }),
  });
  const stringOver = executeKernRuntimeHandlerSync(request(shortFixture), {
    enabled: true,
    limits: runtimeLimits({ maxStringBytes: 5 }),
  });
  assert.equal(stringAt.outcome, byId['string-bytes'].expected[0]);
  assert.equal(stringOver.diagnostics[0]?.code, byId['string-bytes'].expected[1]);
});

test('phase ledger proves exact provider, publication, and timer permissions', async () => {
  const invalidInput = goldens.cases.find(({ id }) => id === 'failure-invalid-capability-input');
  async function observeInvalidInput(mode, witness) {
    const listenerCounts = {
      listenerAdds: 0,
      listenerRemoves: 0,
    };
    const poisonCalls = { count: 0 };
    const poisonMaps = providerMaps(invalidInput.provider, poisonCalls);
    const signal = {
      aborted: witness.id === 'invalid-input-pre-aborted',
      addEventListener() { listenerCounts.listenerAdds += 1; },
      removeEventListener() { listenerCounts.listenerRemoves += 1; },
    };
    const hasSignal = witness.id.includes('signal') || witness.id.includes('aborted');
    const hasTimeout = witness.id.includes('timeout');
    const schedulerControl = witness.id === 'invalid-input-no-scheduler'
      ? undefined
      : { ...(hasSignal ? { signal } : {}), ...(hasTimeout ? { timeoutMs: 20 } : {}) };
    const observed = await observeRuntimeTimers(async () => {
      const options = {
        capabilities: poisonMaps.capabilities,
        enabled: true,
        limits: runtimeLimits(),
        scheduler: schedulerControl,
      };
      return mode === 'sync'
        ? executeKernRuntimeHandlerSync(request(invalidInput.request), options)
        : executeKernRuntimeHandlerAsync(request(invalidInput.request), {
            ...options,
            asyncCapabilities: poisonMaps.asyncCapabilities,
            capabilityTimeoutMs: 20,
          });
    }, () => {
      const unrelatedTimer = globalThis.setTimeout(() => {}, 1_000);
      globalThis.clearTimeout(unrelatedTimer);
    });
    assert.equal(observed.value.diagnostics[0]?.code, witness.diagnostic, `${witness.id} ${mode}`);
    assert.deepEqual(observed.value.events, []);
    assert.deepEqual(observed.value.result, { presence: 'absent' });
    assert.equal(poisonCalls.count, 0);
    assert.deepEqual({ ...listenerCounts, ...observed.counts }, {
      listenerAdds: witness.listenerAdds,
      listenerRemoves: witness.listenerRemoves,
      timerRegistrations: witness.timerRegistrations,
      timerClears: witness.timerClears,
    });
  }
  for (const witness of goldens.schedulerEffects) {
    await observeInvalidInput('sync', witness);
    await observeInvalidInput('async', witness);
  }

  const invalidProvider = goldens.cases.find(({ id }) => id === 'failure-invalid-provider-result');
  const syncCalls = { count: 0 };
  const syncMaps = providerMaps(invalidProvider.provider, syncCalls);
  const syncEnvelope = executeKernRuntimeHandlerSync(request(invalidProvider.request), {
    capabilities: syncMaps.capabilities,
    enabled: true,
    limits: runtimeLimits(),
  });
  assert.equal(syncCalls.count, 1);
  assert.deepEqual(syncEnvelope, goldens.envelopes[invalidProvider.expected]);
  assert.deepEqual(syncEnvelope.events, []);

  const asyncCalls = { count: 0 };
  const asyncMaps = providerMaps(invalidProvider.provider, asyncCalls);
  const asyncObservation = await observeRuntimeTimers(() =>
    executeKernRuntimeHandlerAsync(request(invalidProvider.request), {
      asyncCapabilities: asyncMaps.asyncCapabilities,
      capabilities: asyncMaps.capabilities,
      capabilityTimeoutMs: 20,
      enabled: true,
      limits: runtimeLimits(),
    }));
  assert.equal(asyncCalls.count, 1);
  assert.deepEqual(asyncObservation.counts, { timerRegistrations: 1, timerClears: 1 });
  assert.deepEqual(asyncObservation.value, goldens.envelopes[invalidProvider.expected]);
});

test('candidate evidence keeps every promotion claim false', () => {
  assert.deepEqual(constitution.claims, {
    runtimeAbiFrozen: false,
    kirV1Frozen: false,
    publicKirReader: false,
    semanticCutover: false,
    phase1Complete: false,
  });
});
