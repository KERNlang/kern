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
import {
  compile as compileJavaScript,
  compilerRequest as javascriptCompilerRequest,
  emittedModule as emittedJavaScriptModule,
} from '../kern-5-r2-js-lowering/support.mjs';

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

test('member optionality and list element types retain exact direct-runtime semantics', async () => {
  const memberSource = (optional) => [
    'fn name=compose export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    let name=payload value="Json.parse(text)"',
    `    return value="payload${optional ? '?.' : '.'}missing"`,
    '',
  ].join('\n');
  const memberRequest = {
    ...runtimeRequest('member', '{}', []),
    arguments: { text: { tag: 'text', value: '{}' } },
  };
  for (const optional of [false, true]) {
    const { verified, result } = await compiled(memberSource(optional));
    const expected = await executeKernKir(verified, memberRequest);
    const actual = (await nativeOne(result.artifact.bytes, { request: memberRequest })).result;
    assert.deepEqual(actual, expected);
    assert.equal(
      actual.diagnostics[0]?.code,
      optional ? 'invalid-handler-result' : 'unsupported-runtime-input',
    );
  }

  const { verified, result } = await compiled();
  const mismatched = runtimeRequest('list-element-mismatch', '{"x":1}', [], {
    arguments: {
      text: { tag: 'text', value: '{"x":1}' },
      labels: { tag: 'list', value: [{ tag: 'integer', value: '1' }] },
    },
  });
  const expected = await executeKernKir(verified, mismatched, provider('reply'));
  const actual = (await nativeOne(result.artifact.bytes, { request: mismatched, reply: 'reply' })).result;
  assert.deepEqual(actual, expected);
  assert.equal(actual.diagnostics[0]?.code, 'invalid-handler-arguments');
});

test('JSON Unicode edges and UTF-8 byte limits stay differential', async () => {
  const { verified, result } = await compiled();
  const cases = [
    runtimeRequest('surrogate-pair', '{"x":"\\uD83D\\uDE00"}', []),
    runtimeRequest('case-distinct', '{"a":1,"A":2}', []),
    runtimeRequest('raw-unit-separator', `{"x":"${String.fromCharCode(0x1f)}"}`, []),
    runtimeRequest('utf8-byte-limit', '"😀😀😀"', [], {
      limits: { ...LIMITS, maxStringBytes: 12 },
    }),
  ];
  for (const request of cases) {
    const expected = await executeKernKir(verified, request, provider('reply'));
    const actual = (await nativeOne(result.artifact.bytes, { request, reply: 'reply' })).result;
    assert.deepEqual(actual, expected, request.requestId);
  }
  assert.match(
    (await executeKernKir(verified, cases[0], provider('reply'))).result.value.value,
    /😀/u,
  );
  assert.equal((await executeKernKir(verified, cases[2], provider('reply'))).outcome, 'failure');
  assert.equal((await executeKernKir(verified, cases[3], provider('reply'))).diagnostics[0]?.code, 'runtime-limit-exceeded');
});

test('runtime zero limits reject and maxSteps preserves the exact JS-lowering boundary', async () => {
  const simpleSource = [
    'fn name=compose export=true returns=string',
    '  param name=text type=string',
    '  handler lang=kern',
    '    return value="text"',
    '',
  ].join('\n');
  const { verified, result } = await compiled(simpleSource);
  const base = {
    ...runtimeRequest('step-boundary', 'value', []),
    arguments: { text: { tag: 'text', value: 'value' } },
  };
  for (const key of Object.keys(LIMITS)) {
    const request = { ...base, limits: { ...LIMITS, [key]: 0 } };
    const expected = await executeKernKir(verified, request);
    const actual = (await nativeOne(result.artifact.bytes, { request })).result;
    assert.deepEqual(actual, expected, key);
    assert.equal(actual.diagnostics[0]?.code, 'invalid-handler-arguments', key);
  }

  const javascript = await compileJavaScript(verified, javascriptCompilerRequest());
  assert.equal(javascript.outcome, 'success');
  const javascriptModule = await emittedJavaScriptModule(javascript.artifact.bytes);
  const atBoundary = { ...base, limits: { ...LIMITS, maxSteps: 3 } };
  const belowBoundary = { ...base, limits: { ...LIMITS, maxSteps: 2 } };
  const javascriptAt = await javascriptModule.execute(atBoundary);
  const javascriptBelow = await javascriptModule.execute(belowBoundary);
  assert.equal(javascriptAt.outcome, 'success');
  assert.equal(javascriptBelow.diagnostics[0]?.code, 'runtime-limit-exceeded');
  assert.deepEqual((await nativeOne(result.artifact.bytes, { request: atBoundary })).result, javascriptAt);
  assert.deepEqual((await nativeOne(result.artifact.bytes, { request: belowBoundary })).result, javascriptBelow);
});

test('astral and BMP private-use record keys follow the direct and JS KERN code-point order', async () => {
  const { verified, result } = await compiled();
  const request = runtimeRequest('key-order', '{"😀":1,"\uE000":2}', []);
  const expected = await executeKernKir(verified, request, provider('reply'));
  const python = (await nativeOne(result.artifact.bytes, { request, reply: 'reply' })).result;
  const javascript = await compileJavaScript(verified, javascriptCompilerRequest());
  assert.equal(javascript.outcome, 'success');
  const javascriptModule = await emittedJavaScriptModule(javascript.artifact.bytes);
  const javascriptResult = await javascriptModule.execute(request, provider('reply'));
  assert.deepEqual(python, expected);
  assert.deepEqual(javascriptResult, expected);
  const text = expected.result.value.value;
  assert.ok(text.indexOf('\uE000') < text.indexOf('😀'), text);
});
