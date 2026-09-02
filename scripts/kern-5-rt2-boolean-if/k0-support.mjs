import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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

export const LIMITS = Object.freeze({
  maxBytes: 100_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxIterations: 100,
  maxSteps: 10_000,
  maxStringBytes: 10_000,
});

export const ENTRY = Object.freeze({ handlerName: 'route', moduleId: 'route.kern' });

const ENVELOPE_KEYS = ['completion', 'diagnostics', 'events', 'format', 'outcome', 'requestId', 'result'];
const CHILD_MAX_BYTES = 200_000;
const encoder = new TextEncoder();

export function handlerSource(returns, parameters, body) {
  return [
    `fn name=${ENTRY.handlerName} export=true returns=${returns}`,
    ...parameters.map((parameter) => `  param name=${parameter.name} type=${parameter.type}`),
    '  handler lang=kern',
    ...body.map((line) => `    ${line}`),
    '',
  ].join('\n');
}

export async function project(source) {
  const request = { modules: [{ moduleId: ENTRY.moduleId, source }] };
  const result = await projectKernModules(request);
  if (result.status !== 'projected') return undefined;
  return verifyKernProjection(request, result);
}

export function runtimeRequest(requestId, args, control = { preCancelled: false, timeoutMs: null }) {
  return {
    arguments: args,
    control,
    entry: ENTRY,
    format: KERN_KIR_RUNTIME_FORMAT,
    limits: LIMITS,
    requestId,
  };
}

export function compileJavaScript(verified) {
  return compileKernKirToJavaScriptEsm(verified, {
    entry: ENTRY,
    format: KERN_KIR_JS_ESM_COMPILER_FORMAT,
    limits: LIMITS,
  });
}

export function compilePython(verified) {
  return compileKernKirToPython(verified, {
    entry: ENTRY,
    format: KERN_KIR_PYTHON_COMPILER_FORMAT,
    limits: LIMITS,
  });
}

export function provider(calls) {
  return {
    invoke: async (call) => {
      calls.push(call);
      return { presence: 'value', value: { tag: 'text', value: 'reply-value' } };
    },
  };
}

export function normalizeEnvelope(envelope) {
  assert.ok(envelope && typeof envelope === 'object' && !Array.isArray(envelope));
  assert.deepEqual(Object.keys(envelope).sort(), ENVELOPE_KEYS.slice().sort());
  return Object.fromEntries(ENVELOPE_KEYS.map((key) => [key, envelope[key]]));
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value), 'canonical envelope numbers are safe integers');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  assert.ok(value && typeof value === 'object');
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

export function envelopeBytes(envelope) {
  return encoder.encode(canonicalJson(normalizeEnvelope(envelope)));
}

function javascriptDriver(abortAfterMicrotasks) {
  return [
    "import { readFile, writeFile } from 'node:fs/promises';",
    'const [entryPath, inputPath, outputPath] = process.argv.slice(2);',
    'const module = await import(entryPath);',
    'const request = JSON.parse(await readFile(inputPath, "utf8"));',
    'const calls = [];',
    'const options = {',
    '  invoke: async (call) => {',
    '    calls.push({ namespace: call.namespace, operation: call.operation });',
    '    return { presence: "value", value: { tag: "text", value: "reply-value" } };',
    '  },',
    '};',
    ...(abortAfterMicrotasks === undefined
      ? []
      : [
          'const controller = new AbortController();',
          `let remaining = ${abortAfterMicrotasks};`,
          'const step = () => {',
          '  if (remaining === 0) { controller.abort(); return; }',
          '  remaining -= 1;',
          '  Promise.resolve().then(step);',
          '};',
          'Promise.resolve().then(step);',
          'options.signal = controller.signal;',
        ]),
    'const result = await module.execute(request, options);',
    'await writeFile(outputPath, JSON.stringify({ calls, envelope: result, format: module.format, manifest: module.manifest }));',
  ].join('\n');
}

export function queueAbort(abortAfterMicrotasks) {
  const controller = new AbortController();
  let remaining = abortAfterMicrotasks;
  const step = () => {
    if (remaining === 0) {
      controller.abort();
      return;
    }
    remaining -= 1;
    Promise.resolve().then(step);
  };
  Promise.resolve().then(step);
  return controller.signal;
}

export async function executeJavaScriptChild(bytes, request, options = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'kern-k0-js-')));
  try {
    const entry = join(directory, 'entry.mjs');
    const driver = join(directory, 'driver.mjs');
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.json');
    await Promise.all([
      writeFile(entry, bytes),
      writeFile(driver, javascriptDriver(options.abortAfterMicrotasks)),
      writeFile(input, JSON.stringify(request)),
    ]);
    const node22 = process.env.KERN_NODE22 ?? process.execPath;
    const version = spawnSync(node22, ['--version'], { encoding: 'utf8' });
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout, /^v22\./u, `KERN_NODE22 must select Node 22, received ${version.stdout.trim()}`);
    const run = spawnSync(
      node22,
      [
        '--experimental-permission',
        `--allow-fs-read=${directory}`,
        `--allow-fs-write=${directory}`,
        driver,
        entry,
        input,
        output,
      ],
      { cwd: directory, encoding: 'utf8', maxBuffer: CHILD_MAX_BYTES, timeout: 5_000 },
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
    assert.ok(response.manifest && typeof response.manifest === 'object');
    return { calls: response.calls, envelope: response.envelope };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function executePythonChild(bytes, request) {
  const output = await nativeExecute(bytes, { runs: [{ request, reply: 'reply-value' }] });
  assert.equal(output.results.length, 1);
  assert.equal(output.metadata.length, 1);
  return {
    calls: output.metadata[0].calls.map(({ namespace, operation }) => ({ namespace, operation })),
    envelope: output.results[0],
  };
}

export async function threeLegs(source, request) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the fixture source');
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  const directCalls = [];
  const direct = await executeKernKir(verified, request, provider(directCalls));
  const javascriptRun = await executeJavaScriptChild(javascript.artifact.bytes, request);
  const pythonRun = await executePythonChild(python.artifact.bytes, request);
  return {
    direct: { calls: directCalls, envelope: direct },
    javascript: javascriptRun,
    python: pythonRun,
  };
}

export { executeKernKir };
