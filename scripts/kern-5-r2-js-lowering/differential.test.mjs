import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIMITS,
  SOURCE,
  assertCompileSuccess,
  compile,
  compilerRequest,
  emittedModule,
  executeKernKir,
  isolatedExecute,
  projection,
  runtimeRequest,
} from './support.mjs';

async function compiled(source = SOURCE) {
  const verified = await projection(source);
  const result = assertCompileSuccess(await compile(verified));
  return { verified, result, module: await emittedModule(result.artifact.bytes) };
}

function provider(reply, calls = []) {
  return {
    invoke: async (call) => {
      calls.push(call);
      return { presence: 'value', value: { tag: 'text', value: reply } };
    },
  };
}

test('emitted self-contained ESM has the exact public shape and matches RT-1 envelopes and events', async () => {
  const { verified, result, module } = await compiled();
  assert.deepEqual(Object.keys(module).sort(), ['execute', 'format', 'manifest']);
  assert.equal(module.format, 'kern.runtime.kir.v1');
  assert.equal(typeof module.execute, 'function');
  const input = runtimeRequest('exact', '{"items":[1,[2]],"meta":{"mode":"one"}}', ['one', 'two']);
  const directCalls = [];
  const emittedCalls = [];
  const expected = await executeKernKir(verified, input, provider('direct-reply', directCalls));
  const actual = await module.execute(input, provider('direct-reply', emittedCalls));
  assert.deepEqual(actual, expected);
  for (const calls of [directCalls, emittedCalls]) {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].namespace, 'fixture');
    assert.equal(calls[0].operation, 'resolve');
    assert.deepEqual(calls[0].input, { presence: 'absent' });
    assert.ok(calls[0].signal instanceof AbortSignal);
  }
  const isolated = await isolatedExecute(result.artifact.bytes, input, 'isolated-reply');
  const directIsolated = await executeKernKir(verified, input, provider('isolated-reply'));
  assert.equal(isolated.format, 'kern.runtime.kir.v1');
  assert.deepEqual(isolated.result, directIsolated);
});

test('isolated transport carries payloads larger than OS argument limits', async () => {
  const { result, module } = await compiled();
  const input = {
    ...runtimeRequest('stdin-transport', '{"ok":true}', []),
    padding: 'x'.repeat(3_000_000),
  };
  const expected = await module.execute(input, provider('reply'));
  const isolated = await isolatedExecute(result.artifact.bytes, input, 'reply');
  assert.deepEqual(isolated.result, expected);
});

test('isolated transport terminates a child that exceeds its process timeout', async () => {
  const bytes = new TextEncoder().encode([
    'export const format = "fixture";',
    'export const manifest = Object.freeze({});',
    'export async function execute() { return new Promise(() => { setInterval(() => {}, 1000); }); }',
  ].join('\n'));
  await assert.rejects(isolatedExecute(bytes, Object.create(null), null), /isolated execution exceeded 5000ms/u);
});

test('JSON hostile values, cancellation, timeout, every limit and abort stay differential', async () => {
  const { verified, module } = await compiled();
  const cases = [
    runtimeRequest('big', '{"😀":9007199254740993,"\uE000":2}', []),
    runtimeRequest('pre-cancel', '{"x":1}', [], { control: { preCancelled: true, timeoutMs: null } }),
    runtimeRequest('event-limit', '{"x":1}', [], { limits: { ...LIMITS, maxEvents: 1 } }),
    runtimeRequest('string-limit', '{"x":1}', [], { limits: { ...LIMITS, maxStringBytes: 4 } }),
    runtimeRequest('collection-limit', '{"x":[1,2]}', [], { limits: { ...LIMITS, maxCollectionLength: 1 } }),
    runtimeRequest('depth-limit', '{"x":[1]}', [], { limits: { ...LIMITS, maxDepth: 1 } }),
    runtimeRequest('step-limit', '{"x":1}', [], { limits: { ...LIMITS, maxSteps: 1 } }),
    runtimeRequest('byte-limit', '{"x":1}', [], { limits: { ...LIMITS, maxBytes: 100 } }),
  ];
  for (const input of cases) {
    assert.deepEqual(await module.execute(input, provider('reply')), await executeKernKir(verified, input, provider('reply')));
  }
  for (const text of ['{"x":1,"x":2}', '{"x":1e3}', '{"x":-0}', '{"x":"\\uD800"}']) {
    const input = runtimeRequest(`reject-${text.length}`, text, []);
    const direct = await executeKernKir(verified, input, provider('reply'));
    assert.equal(direct.outcome, 'failure', text);
    assert.deepEqual(await module.execute(input, provider('reply')), direct);
  }
  const safeProto = runtimeRequest('safe-proto', '{"__proto__":"safe"}', []);
  assert.deepEqual(await module.execute(safeProto, provider('reply')), await executeKernKir(verified, safeProto, provider('reply')));
  const timeout = runtimeRequest('timeout', '{"x":1}', [], { control: { preCancelled: false, timeoutMs: 5 } });
  assert.deepEqual(
    await module.execute(timeout, { invoke: () => new Promise(() => {}) }),
    await executeKernKir(verified, timeout, { invoke: () => new Promise(() => {}) }),
  );
  const controller = new AbortController();
  const pending = module.execute(runtimeRequest('abort', '{"x":1}', []), {
    signal: controller.signal,
    invoke: () => new Promise(() => {}),
  });
  setImmediate(() => controller.abort());
  assert.equal((await pending).diagnostics[0]?.code, 'execution-cancelled');
  const rejected = runtimeRequest('provider-rejection', '{"x":1}', []);
  const rejection = () => Promise.reject(new Error('provider rejected'));
  assert.deepEqual(await module.execute(rejected, { invoke: rejection }), await executeKernKir(verified, rejected, { invoke: rejection }));
  const malformed = runtimeRequest('malformed-slot', '{"x":1}', []);
  const malformedSlot = () => ({ presence: 'value', value: { tag: 'not-a-kir-value' } });
  assert.deepEqual(
    await module.execute(malformed, { invoke: malformedSlot }),
    await executeKernKir(verified, malformed, { invoke: malformedSlot }),
  );
});

test('concurrent executions isolate bindings and novel linked KIR changes program, digest, and output', async () => {
  const { module } = await compiled();
  const resolvers = new Map();
  const run = (id, reply) => module.execute(runtimeRequest(id, `{"mode":"${id}"}`, [id]), {
    invoke: () => new Promise((resolve) => resolvers.set(id, () => resolve({ presence: 'value', value: { tag: 'text', value: reply } }))),
  });
  const one = run('one', 'reply-one');
  const two = run('two', 'reply-two');
  while (resolvers.size !== 2) await new Promise((resolve) => setImmediate(resolve));
  resolvers.get('two')();
  resolvers.get('one')();
  const [oneEnvelope, twoEnvelope] = await Promise.all([one, two]);
  assert.match(oneEnvelope.result.value.value, /reply-one/u);
  assert.match(twoEnvelope.result.value.value, /reply-two/u);
  const changedSource = [
    'fn name=compose export=true returns=string', '  param name=text type=string', '  param name=labels type=string[]',
    '  handler lang=kern', '    return value="text"', '',
  ].join('\n');
  const original = await compiled();
  const changed = await compiled(changedSource);
  assert.notDeepEqual(original.result.artifact.bytes, changed.result.artifact.bytes);
  const input = runtimeRequest('novel', 'different', ['ignored']);
  const originalOutput = await original.module.execute(input, provider('reply'));
  const changedOutput = await changed.module.execute(input, provider('reply'));
  assert.notDeepEqual(originalOutput, changedOutput);
});

test('large Unicode module identifiers lower to ESM without argument-spread overflow and retain RT-1 parity', async () => {
  const moduleId = `entry-😀-${'x'.repeat(150_000)}.kern`;
  const limits = { ...LIMITS, maxBytes: 1_000_000, maxStringBytes: 200_000 };
  const entry = { moduleId, handlerName: 'compose' };
  const verified = await projection(SOURCE, moduleId);
  const result = assertCompileSuccess(await compile(verified, compilerRequest({ entry, limits })));
  const text = new TextDecoder().decode(result.artifact.bytes);
  assert.equal('😀'.codePointAt(0), 0x1f600);
  assert.notEqual('😀'.codePointAt(0), '😀'.charCodeAt(0), 'the emitted literal must retain its Unicode code point');
  assert.ok(text.includes('128512'), 'the non-BMP module identifier must be emitted as a code point');
  const module = await emittedModule(result.artifact.bytes);
  const input = runtimeRequest('large-module', '{"ok":true}', ['unicode'], { entry, limits });
  assert.deepEqual(await module.execute(input, provider('reply')), await executeKernKir(verified, input, provider('reply')));
});

test('maxBytes accepts the exact success-envelope boundary and rejects one byte below in direct and emitted paths', async () => {
  const { verified, module } = await compiled();
  const baseline = runtimeRequest('byte-boundary', '{"ok":true}', ['boundary']);
  const reference = await executeKernKir(verified, baseline, provider('reply'));
  assert.equal(reference.outcome, 'success');
  const resultText = reference.result.value.value;
  const maxBytes = Buffer.byteLength([
    '{"completion":{"kind":"return"},"diagnostics":[],"events":[',
    '{"input":{"presence":"absent"},"namespace":"fixture","op":"capability","operation":"resolve","result":{"presence":"value","value":"reply"}},',
    `{"op":"stdout","text":${JSON.stringify(resultText)}}`,
    '],"format":"kern.runtime.kir.v1","outcome":"success","requestId":"byte-boundary","result":{"presence":"value","value":',
    JSON.stringify(resultText),
    '}}',
  ].join(''));
  const atBoundary = runtimeRequest('byte-boundary', '{"ok":true}', ['boundary'], { limits: { ...LIMITS, maxBytes } });
  for (const execute of [
    () => executeKernKir(verified, atBoundary, provider('reply')),
    () => module.execute(atBoundary, provider('reply')),
  ]) assert.deepEqual(await execute(), reference);
  const belowBoundary = { ...atBoundary, limits: { ...atBoundary.limits, maxBytes: maxBytes - 1 } };
  for (const { label, execute } of [
    { label: 'direct', execute: () => executeKernKir(verified, belowBoundary, provider('reply')) },
    { label: 'emitted', execute: () => module.execute(belowBoundary, provider('reply')) },
  ]) {
    const result = await execute();
    assert.equal(result.outcome, 'failure', label);
    assert.equal(result.diagnostics[0]?.code, 'runtime-limit-exceeded', label);
  }
});
