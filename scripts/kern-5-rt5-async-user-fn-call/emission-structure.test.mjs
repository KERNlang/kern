import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASYNC_TEXT_HELPER,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  TEXT_INPUT,
  compileJavaScript,
  compilePython,
  entryFn,
  javaScriptHelperRegion,
  linkedProgram,
  moduleSource,
  project,
  pythonHelperRegion,
  specializedJavaScript,
} from './k0-support.mjs';

// Name-sorted helpers: echo is __f0/_f0, fetchIt is __f1/_f1, relay is __f2/_f2.
const MIXED = moduleSource([
  ASYNC_TEXT_HELPER,
  RELAY_HELPER,
  SYNC_TEXT_HELPER,
  entryFn(['let name=x value="relay(t)"', 'print value="echo(x)"', 'return value="fetchIt(x)"'], TEXT_INPUT, 'string'),
]);

async function emitted(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the emission fixture must project');
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  return { javascript: javascript.artifact.bytes, python: python.artifact.bytes };
}

test('the helper naming assumption behind this suite holds', async () => {
  const program = await linkedProgram(MIXED);
  assert.deepEqual(
    program.helpers.map((helper) => [helper.name, helper.async === true]),
    [
      ['echo', false],
      ['fetchIt', true],
      ['relay', true],
    ],
  );
});

test('a synchronous helper is emitted without async and without await on both legs', async () => {
  const bytes = await emitted(MIXED);
  const javascript = javaScriptHelperRegion(specializedJavaScript(bytes.javascript), '__f0');
  assert.ok(!javascript.includes('async'), 'RT5_SYNC_HELPER_MADE_ASYNC: the JavaScript helper must stay synchronous');
  assert.ok(!javascript.includes('await'), 'a synchronous helper must contain no await point');
  const python = pythonHelperRegion(bytes.python, '_f0');
  assert.ok(python.startsWith('    def _f0('), 'RT5_SYNC_HELPER_MADE_ASYNC: the Python helper must stay a plain def');
  assert.ok(!python.includes('await'), 'the Python twin contains no await point');
});

test('an async helper is emitted as async and awaits its provider on both legs', async () => {
  const bytes = await emitted(MIXED);
  const javascript = javaScriptHelperRegion(specializedJavaScript(bytes.javascript), '__f1');
  assert.ok(javascript.startsWith('const __f1=async('), 'the JavaScript helper must be an async function');
  assert.ok(javascript.includes('await __invokeCapability('), 'it must await the provider');
  const python = pythonHelperRegion(bytes.python, '_f1');
  assert.ok(python.startsWith('    async def _f1('), 'the Python helper must be an async def');
  assert.ok(python.includes('await _invoke_capability('), 'the Python twin must await the provider');
});

test('an async call site awaits and a synchronous call site does not, on both legs', async () => {
  const bytes = await emitted(MIXED);
  const javascript = specializedJavaScript(bytes.javascript);
  const body = javascript.slice(javascript.indexOf('try {'));
  assert.ok(body.includes('await __f2('), 'RT5_AWAIT_DROPPED: the relay call site must await');
  assert.ok(body.includes('await __f1('), 'RT5_AWAIT_DROPPED: the fetchIt call site must await');
  assert.ok(/[^t]__f0\(/u.test(body) && !body.includes('await __f0('), 'the synchronous call site must not await');
  const python = Buffer.from(bytes.python).toString('utf8');
  const pythonBody = python.slice(python.indexOf('    try:'));
  assert.ok(pythonBody.includes('await _f2('), 'RT5_PYTHON_MISSING_AWAIT: the relay call site must await');
  assert.ok(pythonBody.includes('await _f1('), 'RT5_PYTHON_MISSING_AWAIT: the fetchIt call site must await');
  assert.ok(!pythonBody.includes('await _f0('), 'the synchronous Python call site must not await');
});

test('Python never calls an async helper bare anywhere in the artifact', async () => {
  const bytes = await emitted(MIXED);
  const python = Buffer.from(bytes.python).toString('utf8');
  for (const local of ['_f1', '_f2']) {
    for (const match of python.matchAll(new RegExp(`(.{6})${local}\\(`, 'gu'))) {
      const prefix = match[1];
      assert.ok(
        prefix.endsWith('await ') || prefix.endsWith('def '),
        `RT5_PYTHON_MISSING_AWAIT: ${local} is invoked without await at ${JSON.stringify(match[0])}`,
      );
    }
  }
});

test('every emitted async call site charges the call node before it dispatches', async () => {
  const bytes = await emitted(MIXED);
  const javascript = specializedJavaScript(bytes.javascript);
  assert.ok(javascript.includes('(__meter.step(),await __f1('), 'the JavaScript call node step precedes the dispatch');
  const python = Buffer.from(bytes.python).toString('utf8');
  assert.ok(
    /_meter\.step\(\)\n\s+_returned = await _f1\(/u.test(python) ||
      /_meter\.step\(\)\n\s+_k\w+ = await _f\d\(/u.test(python),
    'the Python call node step is emitted immediately before the awaited dispatch',
  );
});

test('the async call chain still emits exactly one checkpoint per callee statement', async () => {
  const source = moduleSource([
    {
      body: [
        'capability namespace=fixture operation=resolve name=reply',
        'let name=a value="reply"',
        'return value="a"',
      ],
      name: 'stepped',
      parameters: TEXT_INPUT,
      returns: 'string',
    },
    entryFn(['return value="stepped(t)"'], TEXT_INPUT, 'string'),
  ]);
  const bytes = await emitted(source);
  const javascript = javaScriptHelperRegion(specializedJavaScript(bytes.javascript), '__f0');
  assert.equal(
    (javascript.match(/__checkAbort\(\)/gu) ?? []).length,
    4,
    'RT5_POST_AWAIT_CHECKABORT_DROPPED: the capability checks before and after its await, and the let and return check once each',
  );
  assert.ok(
    /await __invokeCapability\([^;]*\);\s*\}\s*catch\(error\)[\s\S]*?__checkAbort\(\);/u.test(javascript),
    'RT5_POST_AWAIT_CHECKABORT_DROPPED: a checkpoint must follow the provider await',
  );
  // The Python kernel's _invoke_capability already fails closed on an abort or a timeout before it
  // returns, so removing this checkpoint is behaviourally equivalent on every fixture the suite can
  // build. It is pinned structurally instead, so it cannot vanish unnoticed.
  const python = pythonHelperRegion(bytes.python, '_f0');
  assert.ok(
    /await _invoke_capability\([\s\S]*?raise _Fault\("capability-error", "execution"\)\n\s+_check_abort\(\)/u.test(
      python,
    ),
    'RT5_POST_AWAIT_CHECKABORT_DROPPED: a checkpoint must follow the Python provider await',
  );
  assert.equal(
    (python.match(/_check_abort\(\)/gu) ?? []).length,
    5,
    'the Python helper keeps its checkpoints: two around the capability plus its extra pre-commit one, and one each for the let and the return',
  );
});

test('both emitters still refuse a capability inside a helper that is not classified async', async () => {
  const { emitJavaScriptEsm } = await import('../../packages/core/dist/compiler/kir-js-esm/emitter.js');
  const { emitPython } = await import('../../packages/core/dist/compiler/kir-python/emitter.js');
  const clean = await linkedProgram(
    moduleSource([SYNC_TEXT_HELPER, entryFn(['return value="echo(t)"'], TEXT_INPUT, 'string')]),
  );
  const manifestBase = {
    artifactFormat: 'x',
    canonicalization: 'x',
    compilerFormat: 'x',
    compilerRequestSha256: 'x',
    entry: clean.entry,
    hashAlgorithm: 'sha256',
    hostProfile: 'x',
    kernelSha256: 'x',
    linkedProgramSha256: clean.sha256,
    projectionArtifactSha256: clean.projectionArtifactSha256,
    runtimeFormat: 'x',
  };
  const poisoned = {
    ...clean,
    helpers: [
      {
        handler: {
          ...clean.helpers[0].handler,
          statements: [
            { input: undefined, kind: 'capability', name: 'reply', namespace: 'fixture', operation: 'resolve' },
            ...clean.helpers[0].handler.statements,
          ],
        },
        name: clean.helpers[0].name,
      },
    ],
  };
  assert.throws(() => emitJavaScriptEsm(poisoned, manifestBase), /helper must not invoke a capability/u);
  assert.throws(() => emitPython(poisoned, manifestBase), /helper must not invoke a capability/u);
});

test('both emitters refuse an async helper that reaches expression position', async () => {
  const { emitJavaScriptEsm } = await import('../../packages/core/dist/compiler/kir-js-esm/emitter.js');
  const { emitPython } = await import('../../packages/core/dist/compiler/kir-python/emitter.js');
  const clean = await linkedProgram(
    moduleSource([ASYNC_TEXT_HELPER, entryFn(['return value="fetchIt(t)"'], TEXT_INPUT, 'string')]),
  );
  const manifestBase = {
    artifactFormat: 'x',
    canonicalization: 'x',
    compilerFormat: 'x',
    compilerRequestSha256: 'x',
    entry: clean.entry,
    hashAlgorithm: 'sha256',
    hostProfile: 'x',
    kernelSha256: 'x',
    linkedProgramSha256: clean.sha256,
    projectionArtifactSha256: clean.projectionArtifactSha256,
    runtimeFormat: 'x',
  };
  assert.ok(emitJavaScriptEsm(clean, manifestBase).byteLength > 0, 'the clean program still emits');
  const call = clean.program.statements.at(-1).value;
  const poisoned = {
    ...clean,
    program: {
      ...clean.program,
      statements: [
        { kind: 'return', value: { items: [call], kind: 'list' } },
      ],
    },
  };
  assert.throws(
    () => emitJavaScriptEsm(poisoned, manifestBase),
    /only callable as the whole value of a statement/u,
    'the JavaScript emitter must refuse an async call inside an expression',
  );
  assert.throws(
    () => emitPython(poisoned, manifestBase),
    /only callable as the whole value of a statement/u,
    'the Python emitter must refuse an async call inside an expression',
  );
});
