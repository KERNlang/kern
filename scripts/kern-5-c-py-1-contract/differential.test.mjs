import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LIMITS,
  SOURCE,
  assertCompileSuccess,
  compile,
  compilerRequest,
  executeKernKir,
  nativeExecute,
  projection,
  provider,
  runtimeRequest,
} from './support.mjs';

async function compiled(source = SOURCE, moduleId = 'main.kern', request = compilerRequest()) {
  const verified = await projection(source, moduleId);
  const result = assertCompileSuccess(await compile(verified, request));
  return { verified, result };
}

async function nativeOne(bytes, run) {
  const output = await nativeExecute(bytes, { runs: [run] });
  assert.equal(output.results.length, 1);
  assert.equal(output.metadata.length, 1);
  return { result: output.results[0], metadata: output.metadata[0] };
}

test('clean-root CPython 3.12 execution matches RT-1 return and ordered event envelopes exactly', async () => {
  const { verified, result } = await compiled();
  const request = runtimeRequest('exact', '{"items":[1,[2]],"meta":{"mode":"one"}}', ['one', 'two']);
  const directCalls = [];
  const expected = await executeKernKir(verified, request, provider('direct-reply', directCalls));
  const native = await nativeOne(result.artifact.bytes, { request, reply: 'direct-reply' });
  assert.deepEqual(native.result, expected);
  assert.deepEqual(Object.keys(native.metadata.calls[0]).sort(), [
    'input', 'namespace', 'operation', 'signalIsEvent', 'signalIsInternal', 'signalSet',
  ]);
  assert.deepEqual(native.metadata.calls[0], {
    namespace: 'fixture',
    operation: 'resolve',
    input: { presence: 'absent' },
    signalIsEvent: true,
    signalIsInternal: true,
    signalSet: false,
  });
  assert.equal(directCalls.length, 1);
  assert.deepEqual(Object.keys(directCalls[0]).sort(), ['input', 'namespace', 'operation', 'signal']);
});

test('fresh inputs and provider results stay isolated across repeated and concurrent native executions', async () => {
  const { result } = await compiled();
  const runs = [
    { request: runtimeRequest('one', '{"mode":"one"}', ['one']), reply: 'reply-one', delayMs: 20 },
    { request: runtimeRequest('two', '{"mode":"two"}', ['two']), reply: 'reply-two', delayMs: 0 },
  ];
  const sequential = await nativeExecute(result.artifact.bytes, { runs });
  const concurrent = await nativeExecute(result.artifact.bytes, { mode: 'concurrent', runs });
  for (const output of [sequential, concurrent]) {
    assert.match(output.results[0].result.value.value, /"mode":"one"/u);
    assert.match(output.results[0].result.value.value, /"reply-one"/u);
    assert.doesNotMatch(output.results[0].result.value.value, /reply-two/u);
    assert.match(output.results[1].result.value.value, /"mode":"two"/u);
    assert.match(output.results[1].result.value.value, /"reply-two"/u);
    assert.doesNotMatch(output.results[1].result.value.value, /reply-one/u);
    assert.equal(output.metadata.every((item) => item.calls.length === 1), true);
  }
});

test('hostile KERN JSON and all runtime limits retain exact RT-1 envelope parity', async () => {
  const { verified, result } = await compiled();
  const cases = [
    runtimeRequest('big', '{"😀":9007199254740993,"\uE000":2}', []),
    runtimeRequest('event-limit', '{"x":1}', [], { limits: { ...LIMITS, maxEvents: 1 } }),
    runtimeRequest('string-limit', '{"x":1}', [], { limits: { ...LIMITS, maxStringBytes: 4 } }),
    runtimeRequest('collection-limit', '{"x":[1,2]}', [], { limits: { ...LIMITS, maxCollectionLength: 1 } }),
    runtimeRequest('depth-limit', '{"x":[1]}', [], { limits: { ...LIMITS, maxDepth: 1 } }),
    runtimeRequest('step-limit', '{"x":1}', [], { limits: { ...LIMITS, maxSteps: 1 } }),
    runtimeRequest('byte-limit', '{"x":1}', [], { limits: { ...LIMITS, maxBytes: 100 } }),
    runtimeRequest('safe-proto', '{"__proto__":"safe"}', []),
  ];
  for (const request of cases) {
    const expected = await executeKernKir(verified, request, provider('reply'));
    assert.deepEqual((await nativeOne(result.artifact.bytes, { request, reply: 'reply' })).result, expected, request.requestId);
  }
  for (const text of ['{"x":1,"x":2}', '{"x":1e3}', '{"x":-0}', '{"x":"\\uD800"}']) {
    const request = runtimeRequest(`reject-${text.length}`, text, []);
    const expected = await executeKernKir(verified, request, provider('reply'));
    assert.equal(expected.outcome, 'failure', text);
    assert.deepEqual((await nativeOne(result.artifact.bytes, { request, reply: 'reply' })).result, expected, text);
  }
});

test('malformed runtime requests, missing providers, rejected providers, and malformed results stay differential', async () => {
  const { verified, result } = await compiled();
  const scenarios = [
    { name: 'missing-provider', request: runtimeRequest('missing', '{"x":1}', []), options: {}, scenario: 'missing-provider' },
    {
      name: 'rejection', request: runtimeRequest('rejection', '{"x":1}', []),
      options: { invoke: () => Promise.reject(new Error('provider rejected')) }, scenario: 'rejection',
    },
    {
      name: 'malformed-result', request: runtimeRequest('malformed-result', '{"x":1}', []),
      options: { invoke: () => ({ presence: 'value', value: { tag: 'not-a-kir-value' } }) }, scenario: 'malformed-result',
    },
    {
      name: 'malformed-request', request: { ...runtimeRequest('malformed-request', '{"x":1}', []), extra: true },
      options: provider('reply'), scenario: 'reply',
    },
  ];
  for (const item of scenarios) {
    const expected = await executeKernKir(verified, item.request, item.options);
    const native = await nativeOne(result.artifact.bytes, {
      request: item.request,
      reply: 'reply',
      scenario: item.scenario,
    });
    assert.deepEqual(native.result, expected, item.name);
    if (item.name === 'missing-provider') assert.equal(native.metadata.calls.length, 0);
  }
});

test('maxBytes accepts the exact envelope boundary and rejects one byte below', async () => {
  const { verified, result } = await compiled();
  const baseline = runtimeRequest('byte-boundary', '{"ok":true}', ['boundary']);
  const reference = await executeKernKir(verified, baseline, provider('reply'));
  assert.equal(reference.outcome, 'success');
  const resultText = reference.result.value.value;
  const boundary = Buffer.byteLength([
    '{"completion":{"kind":"return"},"diagnostics":[],"events":[',
    '{"input":{"presence":"absent"},"namespace":"fixture","op":"capability","operation":"resolve","result":{"presence":"value","value":"reply"}},',
    `{"op":"stdout","text":${JSON.stringify(resultText)}}`,
    '],"format":"kern.runtime.kir.v1","outcome":"success","requestId":"byte-boundary","result":{"presence":"value","value":',
    JSON.stringify(resultText),
    '}}',
  ].join(''));
  const atBoundary = { ...baseline, limits: { ...baseline.limits, maxBytes: boundary } };
  const below = { ...atBoundary, limits: { ...atBoundary.limits, maxBytes: boundary - 1 } };
  assert.deepEqual((await nativeOne(result.artifact.bytes, { request: atBoundary, reply: 'reply' })).result, reference);
  const rejected = (await nativeOne(result.artifact.bytes, { request: below, reply: 'reply' })).result;
  assert.equal(rejected.outcome, 'failure');
  assert.equal(rejected.diagnostics[0]?.code, 'runtime-limit-exceeded');
});

test('novel linked KIR changes artifact, digest, and native output', async () => {
  const changedSource = [
    'fn name=compose export=true returns=string',
    '  param name=text type=string',
    '  param name=labels type=string[]',
    '  handler lang=kern',
    '    return value="text"',
    '',
  ].join('\n');
  const original = await compiled();
  const changed = await compiled(changedSource);
  assert.notDeepEqual(original.result.artifact.bytes, changed.result.artifact.bytes);
  const originalManifest = JSON.parse(new TextDecoder().decode(original.result.manifest.bytes));
  const changedManifest = JSON.parse(new TextDecoder().decode(changed.result.manifest.bytes));
  assert.notEqual(originalManifest.linkedProgramSha256, changedManifest.linkedProgramSha256);
  const request = runtimeRequest('novel', 'different', ['ignored']);
  const originalOutput = (await nativeOne(original.result.artifact.bytes, { request, reply: 'reply' })).result;
  const changedOutput = (await nativeOne(changed.result.artifact.bytes, { request, reply: 'reply' })).result;
  assert.notDeepEqual(originalOutput, changedOutput);
});
