import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RuntimeMeter } from '../../packages/core/dist/kir-runtime/inspect.js';
import {
  LINKED_KIR_DEFAULT_CALL_POLICY,
  createLinkedKirClosureWalk,
  linkVerifiedKernKirProgram,
  linkVerifiedKernKirProgramOrThrow,
  linkedProgramHelpers,
  linkedStatementsInvokeCapability,
} from '../../packages/core/dist/kir-runtime/linked-kir-program/index.js';
import { KERN_KIR_RUNTIME_FORMAT, executeKernKir } from '../../packages/core/dist/runtime-kir.js';
import {
  ENTRY,
  LIMITS,
  canonicalJson,
  compileJavaScript,
  compilePython,
  envelopeBytes,
  executeJavaScriptChild,
  executePythonChild,
  normalizeEnvelope,
  project,
  provider,
  queueAbort,
  runtimeRequest,
  threeLegs,
} from '../kern-5-rt2-boolean-if/k0-support.mjs';
import {
  admission,
  assertLinkRejected,
  boolArgs,
  entryFn,
  fnSource,
  linkedProgram,
  moduleSource,
  projectModules,
  stepRequest,
  threeLegBytes,
} from '../kern-5-rt4-user-fn-call/k0-support.mjs';

export {
  ENTRY,
  LIMITS,
  LINKED_KIR_DEFAULT_CALL_POLICY,
  admission,
  assertLinkRejected,
  boolArgs,
  canonicalJson,
  compileJavaScript,
  compilePython,
  createLinkedKirClosureWalk,
  entryFn,
  envelopeBytes,
  executeJavaScriptChild,
  executeKernKir,
  executePythonChild,
  fnSource,
  linkVerifiedKernKirProgram,
  linkVerifiedKernKirProgramOrThrow,
  linkedProgram,
  linkedProgramHelpers,
  linkedStatementsInvokeCapability,
  moduleSource,
  normalizeEnvelope,
  project,
  projectModules,
  provider,
  queueAbort,
  runtimeRequest,
  stepRequest,
  threeLegBytes,
  threeLegs,
};

export const BOOLEAN_FLAG = Object.freeze([Object.freeze({ name: 'flag', type: 'boolean' })]);
export const TEXT_INPUT = Object.freeze([Object.freeze({ name: 't', type: 'string' })]);

export const CAPABILITY_LINE = 'capability namespace=fixture operation=resolve name=reply';

export const ASYNC_TEXT_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY_LINE, 'return value="reply"']),
  name: 'fetchIt',
  parameters: TEXT_INPUT,
  returns: 'string',
});

export const ASYNC_BOOLEAN_HELPER = Object.freeze({
  body: Object.freeze([CAPABILITY_LINE, 'return value="flag"']),
  name: 'fetchFlag',
  parameters: BOOLEAN_FLAG,
  returns: 'boolean',
});

export const SYNC_TEXT_HELPER = Object.freeze({
  body: Object.freeze(['return value="t"']),
  name: 'echo',
  parameters: TEXT_INPUT,
  returns: 'string',
});

export const RELAY_HELPER = Object.freeze({
  body: Object.freeze(['return value="fetchIt(t)"']),
  name: 'relay',
  parameters: TEXT_INPUT,
  returns: 'string',
});

export function textArgs(value) {
  return { t: { tag: 'text', value } };
}

export async function linkFailureMessage(source) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'the fixture must project so the negative is a link decision');
  try {
    linkVerifiedKernKirProgramOrThrow(verified, ENTRY, new RuntimeMeter(LIMITS));
  } catch (error) {
    return error.message;
  }
  return undefined;
}

export function abortingProvider(controller, invocation, calls = []) {
  let seen = 0;
  return {
    invoke: async (call) => {
      seen += 1;
      calls.push({ namespace: call.namespace, operation: call.operation });
      if (seen === invocation) controller.abort();
      return { presence: 'value', value: { tag: 'text', value: 'reply-value' } };
    },
    signal: controller.signal,
  };
}

const CHILD_MAX_BYTES = 200_000;

function javascriptDriver(abortAtInvocation) {
  return [
    "import { readFile, writeFile } from 'node:fs/promises';",
    'const [entryPath, inputPath, outputPath] = process.argv.slice(2);',
    'const module = await import(entryPath);',
    'const request = JSON.parse(await readFile(inputPath, "utf8"));',
    'const calls = [];',
    'const controller = new AbortController();',
    `const abortAt = ${abortAtInvocation === undefined ? 'undefined' : String(abortAtInvocation)};`,
    'let seen = 0;',
    'const options = {',
    '  invoke: async (call) => {',
    '    seen += 1;',
    '    calls.push({ namespace: call.namespace, operation: call.operation });',
    '    if (seen === abortAt) controller.abort();',
    '    return { presence: "value", value: { tag: "text", value: "reply-value" } };',
    '  },',
    '};',
    'if (abortAt !== undefined) options.signal = controller.signal;',
    'const result = await module.execute(request, options);',
    'await writeFile(outputPath, JSON.stringify({ calls, envelope: result }));',
  ].join('\n');
}

export async function runJavaScriptChild(bytes, request, { abortAtInvocation } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'kern-rt5-js-')));
  try {
    const entry = join(directory, 'entry.mjs');
    const driver = join(directory, 'driver.mjs');
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.json');
    await Promise.all([
      writeFile(entry, bytes),
      writeFile(driver, javascriptDriver(abortAtInvocation)),
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
      { cwd: directory, encoding: 'utf8', maxBuffer: CHILD_MAX_BYTES, timeout: 10_000 },
    );
    assert.equal(run.signal, null, `JavaScript child timed out: ${run.stderr}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '', 'clean JavaScript execution must not emit stderr');
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function python312() {
  const executable = process.env.KERN_PYTHON312 ?? 'python3.12';
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.match(`${version.stdout}${version.stderr}`, /^Python 3\.12\./u, 'KERN_PYTHON312 must select CPython 3.12');
  return executable;
}

export async function runPythonChild(bytes, request, { abortAtInvocation } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'kern-rt5-py-')));
  try {
    const entry = join(directory, 'entry.py');
    const driver = join(directory, 'driver.py');
    const input = join(directory, 'input.json');
    const output = join(directory, 'output.json');
    await Promise.all([
      writeFile(entry, bytes),
      writeFile(driver, await readFile(new URL('./native-driver.py', import.meta.url))),
      writeFile(input, JSON.stringify({ abortAtInvocation: abortAtInvocation ?? null, request })),
    ]);
    const run = spawnSync(python312(), ['-I', driver, entry, input, output], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, PYTHONNOUSERSITE: '1', PYTHONPATH: '' },
    });
    assert.equal(run.signal, null, `CPython child timed out: ${run.stderr}`);
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stderr, '', 'clean native execution must not emit stderr');
    return JSON.parse(await readFile(output, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function threeLegAbort(source, request, options = {}) {
  const verified = await project(source);
  assert.ok(verified !== undefined, 'F5 must project the cancellation fixture');
  const javascript = compileJavaScript(verified);
  const python = compilePython(verified);
  assert.equal(javascript.outcome, 'success', `javascript compile failed: ${javascript.code}`);
  assert.equal(python.outcome, 'success', `python compile failed: ${python.code}`);
  const calls = [];
  const controller = new AbortController();
  if (options.preAbort === true) controller.abort();
  const directOptions =
    options.abortAtInvocation === undefined && options.preAbort !== true
      ? provider(calls)
      : abortingProvider(controller, options.abortAtInvocation ?? 0, calls);
  const direct = await executeKernKir(verified, request, directOptions);
  const child = options.preAbort === true ? { abortAtInvocation: 0 } : options;
  return {
    direct: { calls, envelope: direct },
    javascript: await runJavaScriptChild(javascript.artifact.bytes, request, child),
    python: await runPythonChild(python.artifact.bytes, request, child),
  };
}

export function assertLegParity(legs, label) {
  const direct = envelopeBytes(legs.direct.envelope);
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.javascript.envelope)),
    Buffer.from(direct),
    `${label}: emitted JavaScript diverged from RT-1`,
  );
  assert.deepEqual(
    Buffer.from(envelopeBytes(legs.python.envelope)),
    Buffer.from(direct),
    `${label}: emitted CPython diverged from RT-1`,
  );
  return legs.direct.envelope;
}

export function specializedJavaScript(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  const start = text.indexOf('const __runSpecialized=');
  assert.ok(start >= 0, 'the emitted module must contain the specialized handler');
  const end = text.indexOf('const execute=async(input,executionOptions)', start);
  assert.ok(end > start, 'the specialized handler must be followed by the execute entry point');
  return text.slice(start, end);
}

export function javaScriptHelperRegion(body, local) {
  const start = body.indexOf(`const ${local}=`);
  assert.ok(start >= 0, `the emitted handler must define ${local}`);
  const next = body.indexOf('const __f', start + 1);
  const end = next >= 0 ? next : body.indexOf('try {', start);
  assert.ok(end > start, 'helper definitions must precede the handler body');
  return body.slice(start, end);
}

export function pythonHelperRegion(bytes, local) {
  const text = Buffer.from(bytes).toString('utf8');
  const start = text.indexOf(`    def ${local}(`);
  const asyncStart = text.indexOf(`    async def ${local}(`);
  const from = start >= 0 ? start : asyncStart;
  assert.ok(from >= 0, `the emitted Python must define ${local}`);
  const candidates = [text.indexOf('    def _f', from + 1), text.indexOf('    async def _f', from + 1)].filter(
    (index) => index > from,
  );
  const end = candidates.length === 0 ? text.indexOf('    try:', from) : Math.min(...candidates);
  assert.ok(end > from, 'helper definitions must precede the handler body');
  return text.slice(from, end);
}

export function asyncEntryProgram(body, { helpers, parameters = TEXT_INPUT, returns = 'string' } = {}) {
  return moduleSource([...helpers, entryFn(body, parameters, returns)]);
}

export { KERN_KIR_RUNTIME_FORMAT };
