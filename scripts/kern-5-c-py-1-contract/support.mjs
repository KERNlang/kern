import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import { KERN_KIR_RUNTIME_FORMAT, executeKernKir } from '../../packages/core/dist/runtime-kir.js';

import { COMPILER_FORMAT, assertExactlyOnePythonOwner, discoverPythonOwners } from './owner.mjs';

export const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const LIMITS = Object.freeze({
  maxBytes: 100_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxSteps: 10_000,
  maxStringBytes: 10_000,
});

export const LIMIT_KEYS = Object.freeze(Object.keys(LIMITS).sort());
export const SOURCE = [
  'fn name=compose export=true returns=string',
  '  param name=text type=string',
  '  param name=labels type=string[]',
  '  handler lang=kern',
  '    let name=payload value="Json.parse(text)"',
  '    capability namespace=fixture operation=resolve name=reply',
  '    let name=result value="Json.stringify({ labels: labels, payload: payload, reply: reply })"',
  '    print value="result"',
  '    return value="result"',
  '',
].join('\n');

export async function compilerOwner() {
  return assertExactlyOnePythonOwner(await discoverPythonOwners(ROOT));
}

export async function projection(source = SOURCE, moduleId = 'main.kern') {
  const request = { modules: [{ moduleId, source }] };
  const projected = await projectKernModules(request);
  assert.equal(projected.status, 'projected');
  return verifyKernProjection(request, projected);
}

export function compilerRequest(overrides = {}) {
  return {
    format: COMPILER_FORMAT,
    entry: { moduleId: 'main.kern', handlerName: 'compose' },
    limits: LIMITS,
    ...overrides,
  };
}

export function runtimeRequest(id, text, labels, overrides = {}) {
  return {
    format: KERN_KIR_RUNTIME_FORMAT,
    requestId: id,
    entry: { moduleId: 'main.kern', handlerName: 'compose' },
    arguments: {
      text: { tag: 'text', value: text },
      labels: { tag: 'list', value: labels.map((value) => ({ tag: 'text', value })) },
    },
    control: { preCancelled: false, timeoutMs: null },
    limits: LIMITS,
    ...overrides,
  };
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value) && value >= 0);
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  assert.ok(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function assertCompileSuccess(result) {
  assert.deepEqual(Object.keys(result).sort(), ['artifact', 'format', 'manifest', 'outcome', 'target']);
  assert.equal(result.format, COMPILER_FORMAT);
  assert.equal(result.outcome, 'success');
  assert.equal(result.target, 'python');
  for (const name of ['artifact', 'manifest']) {
    assert.deepEqual(Object.keys(result[name]).sort(), ['bytes', 'path', 'sha256']);
    assert.ok(result[name].bytes instanceof Uint8Array);
    assert.equal(result[name].sha256, sha256(result[name].bytes));
  }
  assert.equal(result.artifact.path, 'entry.py');
  assert.equal(result.manifest.path, 'manifest.json');
  return result;
}

export function failureCode(result) {
  assert.equal(result.format, COMPILER_FORMAT);
  assert.equal(result.outcome, 'failure');
  assert.deepEqual(Object.keys(result).sort(), ['code', 'format', 'outcome']);
  return result.code;
}

export async function compile(verified, request = compilerRequest()) {
  const owner = await compilerOwner();
  return owner.namespace.compileKernKirToPython(verified, request);
}

function python312() {
  const executable = process.env.KERN_PYTHON312 ?? 'python3.12';
  const version = spawnSync(executable, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.match(`${version.stdout}${version.stderr}`, /^Python 3\.12\./u, 'KERN_PYTHON312 must select CPython 3.12');
  return executable;
}

export async function nativeExecute(bytes, payload) {
  const directory = await mkdtemp(join(tmpdir(), 'kern-c-py-1-native-'));
  const entry = join(directory, 'entry.py');
  const driver = join(directory, 'driver.py');
  const input = join(directory, 'input.json');
  const output = join(directory, 'output.json');
  await Promise.all([
    writeFile(entry, bytes),
    writeFile(driver, await readFile(new URL('./native-driver.py', import.meta.url))),
    writeFile(input, JSON.stringify(payload)),
  ]);
  const run = spawnSync(python312(), ['-I', driver, entry, input, output], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 5_000,
    env: { ...process.env, PYTHONPATH: '', PYTHONNOUSERSITE: '1' },
  });
  assert.equal(run.signal, null, `CPython driver timed out: ${run.stderr}`);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, '', 'entry.py and its trusted driver must not use stdout as a protocol');
  assert.equal(run.stderr, '', 'clean native execution must not emit stderr');
  return JSON.parse(await readFile(output, 'utf8'));
}

export function provider(reply, calls = []) {
  return {
    invoke: async (call) => {
      calls.push(call);
      return { presence: 'value', value: { tag: 'text', value: reply } };
    },
  };
}

export { executeKernKir };
