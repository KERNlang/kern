import assert from 'node:assert/strict';
import test from 'node:test';

import {
  boolArgs,
  callProgram,
  compileJavaScript,
  compilePython,
  entryFn,
  executeJavaScriptChild,
  executeKernKir,
  moduleSource,
  project,
  provider,
  queueAbort,
  runtimeRequest,
} from './k0-support.mjs';

const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);

const CHAIN = moduleSource([
  { body: ['return value="flag"'], name: 'inner', parameters: BOOLEAN_FLAG, returns: 'boolean' },
  { body: ['return value="inner(flag)"'], name: 'middle', parameters: BOOLEAN_FLAG, returns: 'boolean' },
  { body: ['return value="middle(flag)"'], name: 'outer', parameters: BOOLEAN_FLAG, returns: 'boolean' },
  entryFn(['let name=a value="outer(flag)"', 'return value="outer(a)"']),
]);

async function emitted(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the tick fixture must project');
  const javascript = compileJavaScript(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  return { bytes: javascript.artifact.bytes, verified };
}

function helperRegion(body) {
  const start = body.indexOf('const __f0=');
  assert.ok(start >= 0, 'the emitted handler must define at least one helper');
  const end = body.indexOf('try {', start);
  assert.ok(end > start, 'helper definitions must precede the handler body');
  return body.slice(start, end);
}

function specializedBody(source) {
  const text = Buffer.from(source).toString('utf8');
  const start = text.indexOf('const __runSpecialized=');
  assert.ok(start >= 0, 'the emitted module must contain the specialized handler');
  const end = text.indexOf('const execute=async(input,executionOptions)', start);
  assert.ok(end > start, 'the specialized handler must be followed by the execute entry point');
  return text.slice(start, end);
}

test('a capability-free call chain emits no await anywhere in the specialized handler', async () => {
  const { bytes } = await emitted(CHAIN);
  const body = specializedBody(bytes);
  assert.ok(body.includes('__f0('), 'the emitted handler must dispatch through a named helper');
  assert.ok(!body.includes('await'), 'a capability-free call chain must contain no await point');
  assert.ok(!helperRegion(body).includes('async'), 'no emitted helper may be async');
});

test('a queued-microtask abort is observed at the same boundary by RT-1 and the emitted JavaScript', async () => {
  const { bytes, verified } = await emitted(CHAIN);
  const args = boolArgs({ flag: true });
  for (const depth of [0, 1, 2, 3, 4]) {
    const request = runtimeRequest(`rt4-tick-${depth}`, args);
    const direct = await executeKernKir(verified, request, {
      ...provider([]),
      signal: queueAbort(depth),
    });
    const javascript = await executeJavaScriptChild(bytes, request, { abortAfterMicrotasks: depth });
    assert.equal(
      direct.outcome,
      javascript.envelope.outcome,
      `depth ${depth}: RT-1 and the emitted JavaScript disagreed on the abort outcome`,
    );
    assert.equal(direct.outcome, 'success', `depth ${depth}: a queued abort must not interrupt a synchronous call chain`);
    assert.deepEqual(direct.result.value, javascript.envelope.result.value, `depth ${depth}`);
  }
});

test('an already-aborted signal is refused before any call runs, on both legs', async () => {
  const { bytes, verified } = await emitted(CHAIN);
  const request = runtimeRequest('rt4-pre-abort', boolArgs({ flag: true }));
  const controller = new AbortController();
  controller.abort();
  const direct = await executeKernKir(verified, request, { ...provider([]), signal: controller.signal });
  assert.equal(direct.outcome, 'failure');
  assert.equal(direct.diagnostics[0].code, 'execution-cancelled');
  const preCancelled = { ...request, control: { preCancelled: true, timeoutMs: null } };
  const javascript = await executeJavaScriptChild(bytes, preCancelled);
  assert.equal(javascript.envelope.outcome, 'failure');
  assert.equal(javascript.envelope.diagnostics[0].code, 'execution-cancelled');
  const directPreCancelled = await executeKernKir(verified, preCancelled, provider([]));
  assert.equal(directPreCancelled.diagnostics[0].code, 'execution-cancelled');
});

test('every callee statement carries a cancellation checkpoint on both emitted legs', async () => {
  const source = moduleSource([
    {
      body: ['let name=x value="flag"', 'let name=y value="x"', 'return value="y"'],
      name: 'chainy',
      parameters: BOOLEAN_FLAG,
      returns: 'boolean',
    },
    entryFn(['return value="chainy(flag)"']),
  ]);
  const { bytes } = await emitted(source);
  assert.equal(
    (helperRegion(specializedBody(bytes)).match(/__checkAbort\(\)/gu) ?? []).length,
    3,
    'each of the two lets and the return checks cancellation exactly once',
  );
  const verified = await project(source);
  const python = compilePython(verified);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  const emittedPython = Buffer.from(python.artifact.bytes).toString('utf8');
  const definitionStart = emittedPython.indexOf('    def _f0(');
  assert.ok(definitionStart >= 0, 'the emitted Python must define the helper');
  const definition = emittedPython.slice(definitionStart, emittedPython.indexOf('    try:', definitionStart));
  assert.equal(
    (definition.match(/_check_abort\(\)/gu) ?? []).length,
    3,
    'the Python helper matches the JavaScript helper statement for statement',
  );
  assert.ok(!definition.includes('await'), 'the Python helper contains no await point');
  assert.ok(!definition.includes('async def'), 'the Python helper is a synchronous def');
});

test('the emitted helper meters its dispatch before it guards its arguments', async () => {
  const { bytes } = await emitted(callProgram(['return value="helper(flag)"']));
  const body = specializedBody(bytes);
  const helper = body.slice(body.indexOf('const __f0='));
  const dispatch = helper.indexOf('__meter.step()');
  const guard = helper.indexOf('__matches(__f0p0');
  assert.ok(dispatch >= 0 && guard > dispatch, 'the dispatch step precedes the argument tag guard');
});
