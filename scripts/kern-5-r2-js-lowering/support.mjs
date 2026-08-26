import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { projectKernModules, verifyKernProjection } from '../../packages/core/dist/frontend-projection.js';
import { KERN_KIR_RUNTIME_FORMAT, executeKernKir } from '../../packages/core/dist/runtime-kir.js';

import { COMPILER_FORMAT, assertExactlyOneJavaScriptEsmOwner, discoverJavaScriptEsmOwners } from './owner.mjs';

export const ROOT = resolve(new URL('../..', import.meta.url).pathname);
export const LIMITS = Object.freeze({
  maxBytes: 100_000,
  maxCollectionLength: 100,
  maxDepth: 20,
  maxDiagnostics: 10,
  maxEvents: 10,
  maxSteps: 10_000,
  maxStringBytes: 10_000,
});

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
  return assertExactlyOneJavaScriptEsmOwner(await discoverJavaScriptEsmOwners(ROOT));
}

export async function projection(source = SOURCE) {
  const request = { modules: [{ moduleId: 'main.kern', source }] };
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
    assert.ok(Number.isSafeInteger(value) && value >= 0, 'canonical request numbers are positive safe integers');
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
  assert.equal(result.target, 'javascript-esm');
  for (const name of ['artifact', 'manifest']) {
    assert.deepEqual(Object.keys(result[name]).sort(), ['bytes', 'path', 'sha256']);
    assert.ok(result[name].bytes instanceof Uint8Array);
    assert.equal(result[name].sha256, sha256(result[name].bytes));
  }
  assert.equal(result.artifact.path, 'entry.mjs');
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
  return owner.namespace.compileKernKirToJavaScriptEsm(verified, request);
}

export async function emittedModule(bytes) {
  const directory = await mkdtemp(join(tmpdir(), 'kern-r2-esm-'));
  const path = join(directory, 'entry.mjs');
  await writeFile(path, bytes);
  return import(`${pathToFileURL(path).href}?test=${Date.now()}-${Math.random()}`);
}

export async function isolatedExecute(bytes, request, reply) {
  const directory = await mkdtemp(join(tmpdir(), 'kern-r2-isolated-'));
  const entry = join(directory, 'entry.mjs');
  const driver = join(directory, 'driver.mjs');
  await writeFile(entry, bytes);
  await writeFile(driver, [
    'const [entry, requestText, replyText] = process.argv.slice(2);',
    'const module = await import(new URL(entry, import.meta.url));',
    'const result = await module.execute(JSON.parse(requestText), {',
    '  invoke: async () => ({ presence: "value", value: { tag: "text", value: JSON.parse(replyText) } }),',
    '});',
    'process.stdout.write(JSON.stringify({ format: module.format, manifest: module.manifest, result }));',
  ].join('\n'));
  const node22 = process.env.KERN_NODE22 ?? process.execPath;
  const version = spawnSync(node22, ['--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, /^v22\./u, `KERN_NODE22 must select Node 22, received ${version.stdout.trim()}`);
  const run = spawnSync(node22, [driver, './entry.mjs', JSON.stringify(request), JSON.stringify(reply)], {
    encoding: 'utf8', timeout: 5_000,
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

export { executeKernKir };
