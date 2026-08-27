import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KERN_KIR_JS_ESM_COMPILER_FORMAT,
  compileKernKirToJavaScriptEsm,
} from '../../packages/core/dist/compiler-kir-js-esm.js';
import {
  KERN_KIR_PYTHON_COMPILER_FORMAT,
  compileKernKirToPython,
} from '../../packages/core/dist/compiler-kir-python.js';
import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import { KERN_KIR_RUNTIME_FORMAT, executeKernKir } from '../../packages/core/dist/runtime-kir.js';
import { nativeExecute } from '../kern-5-c-py-1-contract/support.mjs';

const LIMITS = Object.freeze({
  maxBytes: 100_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxSteps: 10_000,
  maxStringBytes: 10_000,
});

const ENTRY = Object.freeze({ handlerName: 'route', moduleId: 'route.kern' });

const SOURCE = [
  'fn name=route export=true returns=string',
  '  param name=flag type=boolean',
  '  handler lang=kern',
  '    if cond="flag"',
  '      capability namespace=fixture operation=resolve name=reply',
  '      return value="reply"',
  '    print value="\"false-path\""',
  '    return value="\"false-return\""',
  '',
].join('\n');

async function projected() {
  const request = { modules: [{ moduleId: ENTRY.moduleId, source: SOURCE }] };
  const result = await projectKernModules(request);
  assert.equal(result.status, 'projected');
  return verifyKernProjection(request, result);
}

function hasStructuralIf(node) {
  if (node.kind === 'if') return true;
  return Array.isArray(node.children) && node.children.some(hasStructuralIf);
}

function request(id, flag, control = { preCancelled: false, timeoutMs: null }) {
  return {
    arguments: { flag: { tag: 'boolean', value: flag } },
    control,
    entry: ENTRY,
    format: KERN_KIR_RUNTIME_FORMAT,
    limits: LIMITS,
    requestId: id,
  };
}

function compilerRequest(format) {
  return { entry: ENTRY, format, limits: LIMITS };
}

function provider(calls) {
  return {
    invoke: async (call) => {
      calls.push(call);
      return { presence: 'value', value: { tag: 'text', value: 'true-return' } };
    },
  };
}

const ENVELOPE_KEYS = ['completion', 'diagnostics', 'events', 'format', 'outcome', 'requestId', 'result'];
const CHILD_MAX_BYTES = 200_000;

function normalizeEnvelope(envelope) {
  assert.ok(envelope && typeof envelope === 'object' && !Array.isArray(envelope));
  assert.deepEqual(Object.keys(envelope).sort(), ENVELOPE_KEYS.slice().sort());
  return Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, envelope[key]]));
}

const JAVASCRIPT_DRIVER = [
  "import { readFile, writeFile } from 'node:fs/promises';",
  'const [entryPath, inputPath, outputPath] = process.argv.slice(2);',
  'const module = await import(entryPath);',
  'const request = JSON.parse(await readFile(inputPath, "utf8"));',
  'const calls = [];',
  'const result = await module.execute(request, {',
  '  invoke: async (call) => {',
  '    calls.push({ namespace: call.namespace, operation: call.operation });',
  '    return { presence: "value", value: { tag: "text", value: "true-return" } };',
  '  },',
  '});',
  'await writeFile(outputPath, JSON.stringify({ calls, envelope: result, format: module.format, manifest: module.manifest }));',
].join('\n');

async function executeJavaScriptChild(bytes, request) {
  const directory = await mkdtemp(join(tmpdir(), 'kern-rt2-js-'));
  try {
    const entry = join(directory, 'entry.mjs');
    const driver = join(directory, 'driver.mjs');
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.json');
    await Promise.all([
      writeFile(entry, bytes),
      writeFile(driver, JAVASCRIPT_DRIVER),
      writeFile(input, JSON.stringify(request)),
    ]);
    const node22 = process.env.KERN_NODE22 ?? process.execPath;
    const version = spawnSync(node22, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /^v22\./u, `KERN_NODE22 must select Node 22, received ${version.stdout.trim()}`);
    const run = spawnSync(
      node22,
      ['--experimental-permission', `--allow-fs-read=${directory}`, `--allow-fs-write=${directory}`, driver, entry, input, output],
      { cwd: directory, encoding: 'utf8', timeout: 5_000, maxBuffer: CHILD_MAX_BYTES },
    );
    assert.equal(run.signal, null, `JavaScript child timed out: ${run.stderr}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '', 'the JavaScript child must use the output file as its protocol');
    assert.equal(run.stderr, '', 'clean JavaScript execution must not emit stderr');
    const encoded = await readFile(output, 'utf8');
    assert.ok(Buffer.byteLength(encoded) <= CHILD_MAX_BYTES, 'JavaScript child response exceeded its bound');
    const response = JSON.parse(encoded);
    assert.deepEqual(Object.keys(response).sort(), ['calls', 'envelope', 'format', 'manifest']);
    assert.equal(response.format, KERN_KIR_RUNTIME_FORMAT);
    return { calls: response.calls, envelope: normalizeEnvelope(response.envelope) };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function executePythonChild(bytes, request) {
  const output = await nativeExecute(bytes, { runs: [{ request, reply: 'true-return' }] });
  assert.equal(output.results.length, 1);
  assert.equal(output.metadata.length, 1);
  return {
    calls: output.metadata[0].calls.map(({ namespace, operation }) => ({ namespace, operation })),
    envelope: normalizeEnvelope(output.results[0]),
  };
}

async function probe() {
  const verified = await projected();
  assert.ok(verified.artifact.modules.some((module) => module.roots.some(hasStructuralIf)));
  const rt1 = await executeKernKir(verified, request('rt2-red', true), provider([]));
  const javascriptEsm = compileKernKirToJavaScriptEsm(
    verified,
    compilerRequest(KERN_KIR_JS_ESM_COMPILER_FORMAT),
  );
  const python = compileKernKirToPython(verified, compilerRequest(KERN_KIR_PYTHON_COMPILER_FORMAT));
  return { javascriptEsm, python, rt1, verified };
}

function admissionCodes({ javascriptEsm, python, rt1 }) {
  return {
    javascriptEsm: javascriptEsm.outcome === 'failure' ? javascriptEsm.code : undefined,
    python: python.outcome === 'failure' ? python.code : undefined,
    rt1: rt1.outcome === 'failure' ? rt1.diagnostics[0]?.code : undefined,
  };
}

function assertAdmitted(probeResult) {
  assert.deepEqual(
    admissionCodes(probeResult),
    { javascriptEsm: undefined, python: undefined, rt1: undefined },
    'RT2_BOOLEAN_IF_OWNER_MISSING: a real F5 structural if must be admitted by RT-1, JavaScript, and Python',
  );
  assert.equal(probeResult.rt1.outcome, 'success');
  assert.equal(probeResult.javascriptEsm.outcome, 'success');
  assert.equal(probeResult.python.outcome, 'success');
}

async function differential(probeResult, input) {
  const directCalls = [];
  const direct = normalizeEnvelope(await executeKernKir(probeResult.verified, input, provider(directCalls)));
  const javascript = await executeJavaScriptChild(probeResult.javascriptEsm.artifact.bytes, input);
  const python = await executePythonChild(probeResult.python.artifact.bytes, input);
  assert.deepEqual(javascript.envelope, direct);
  assert.deepEqual(python.envelope, direct);
  assert.deepEqual(python.envelope, javascript.envelope);
  return { directCalls, javascript, python };
}

test('RT-2 boolean if has one shared F5-backed semantic owner', async () => {
  const result = await probe();
  assertAdmitted(result);
});

test('RT-2 establishes true and false branch, early return, unselected effect, and pre-cancel criteria', async () => {
  const result = await probe();
  assertAdmitted(result);

  const trueRun = await differential(result, request('rt2-true', true));
  assert.equal(trueRun.directCalls.length, 1);
  assert.deepEqual(trueRun.javascript.calls, [{ namespace: 'fixture', operation: 'resolve' }]);
  assert.deepEqual(trueRun.python.calls, [{ namespace: 'fixture', operation: 'resolve' }]);
  assert.equal(trueRun.directCalls[0].namespace, 'fixture');
  assert.equal(trueRun.directCalls[0].operation, 'resolve');
  assert.equal(trueRun.directCalls[0].input.presence, 'absent');
  assert.equal(trueRun.directCalls[0].signal instanceof AbortSignal, true);
  assert.equal(trueRun.directCalls.length, trueRun.javascript.calls.length);
  assert.equal(trueRun.directCalls.length, trueRun.python.calls.length);
  assert.equal(trueRun.directCalls.length, 1);
  assert.equal(trueRun.javascript.envelope.result.value.value, 'true-return');
  assert.equal(trueRun.javascript.envelope.events.length, 1);
  assert.equal(trueRun.javascript.envelope.events[0].op, 'capability');

  const falseRun = await differential(result, request('rt2-false', false));
  assert.equal(falseRun.directCalls.length, 0);
  assert.deepEqual(falseRun.javascript.calls, []);
  assert.deepEqual(falseRun.python.calls, []);
  assert.equal(falseRun.javascript.envelope.outcome, 'success');
  assert.equal(falseRun.javascript.envelope.result.value.value, 'false-return');
  assert.deepEqual(falseRun.javascript.envelope.events, [{ op: 'stdout', text: 'false-path' }]);

  const cancelledRun = await differential(
    result,
    request('rt2-pre-cancel', true, { preCancelled: true, timeoutMs: null }),
  );
  assert.equal(cancelledRun.directCalls.length, 0);
  assert.deepEqual(cancelledRun.javascript.calls, []);
  assert.deepEqual(cancelledRun.python.calls, []);
  assert.equal(cancelledRun.javascript.envelope.outcome, 'failure');
  assert.equal(cancelledRun.javascript.envelope.diagnostics[0]?.code, 'execution-cancelled');
  assert.deepEqual(cancelledRun.javascript.envelope.events, []);
});
