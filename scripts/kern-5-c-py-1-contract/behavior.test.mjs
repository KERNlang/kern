import assert from 'node:assert/strict';
import test from 'node:test';

import { ARTIFACT_FORMAT, COMPILER_FORMAT, HOST_PROFILE, OWNER_MARKER } from './owner.mjs';
import {
  LIMIT_KEYS,
  assertCompileSuccess,
  canonicalJson,
  compile,
  compilerOwner,
  compilerRequest,
  failureCode,
  nativeExecute,
  projection,
  runtimeRequest,
  sha256,
} from './support.mjs';

const MANIFEST_KEYS = [
  'artifact', 'artifactFormat', 'canonicalization', 'compilerFormat', 'compilerRequestSha256', 'entry',
  'hashAlgorithm', 'hostProfile', 'kernelSha256', 'linkedProgramSha256', 'projectionArtifactSha256', 'runtimeFormat',
].sort();

test('discovered owner has the exact package-owned Python compiler surface', async () => {
  const { namespace } = await compilerOwner();
  assert.equal(namespace.KERN_KIR_PYTHON_COMPILER_OWNER, OWNER_MARKER);
  assert.equal(namespace.KERN_KIR_PYTHON_COMPILER_FORMAT, COMPILER_FORMAT);
  assert.equal(namespace.KERN_KIR_PYTHON_ARTIFACT_FORMAT, ARTIFACT_FORMAT);
  assert.equal(namespace.KERN_KIR_PYTHON_HOST_PROFILE, HOST_PROFILE);
  assert.equal(typeof namespace.compileKernKirToPython, 'function');
});

test('compile request admits exactly format, entry, and all seven positive safe integer limits', async () => {
  const verified = await projection();
  assert.deepEqual(LIMIT_KEYS, [
    'maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxSteps', 'maxStringBytes',
  ]);
  assertCompileSuccess(await compile(verified));
  for (const key of LIMIT_KEYS) {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const malformed = compilerRequest({ limits: { ...compilerRequest().limits, [key]: value } });
      assert.equal(failureCode(await compile(verified, malformed)), 'invalid-compiler-request', `${key}=${value}`);
    }
  }
  for (const malformed of [
    compilerRequest({ format: 'kern.compiler.kir-js-esm.v1' }),
    { ...compilerRequest(), extra: true },
    { ...compilerRequest(), entry: { ...compilerRequest().entry, extra: true } },
    { ...compilerRequest(), limits: { ...compilerRequest().limits, extra: true } },
    { ...compilerRequest(), limits: Object.fromEntries(Object.entries(compilerRequest().limits).slice(1)) },
  ]) assert.equal(failureCode(await compile(verified, malformed)), 'invalid-compiler-request');
  const accessor = compilerRequest();
  Object.defineProperty(accessor, 'entry', { enumerable: true, get: () => compilerRequest().entry });
  assert.equal(failureCode(await compile(verified, accessor)), 'invalid-compiler-request');
  const symbolField = compilerRequest();
  symbolField[Symbol('not-data')] = true;
  assert.equal(failureCode(await compile(verified, symbolField)), 'invalid-compiler-request');
});

test('request inspection precedes projection authentication and authentication precedes projection reads', async () => {
  const verified = await projection();
  let traps = 0;
  const hostileProjection = new Proxy({ ...verified }, {
    get() { traps += 1; throw new Error('projection read'); },
    getOwnPropertyDescriptor() { traps += 1; throw new Error('projection descriptor'); },
    getPrototypeOf() { traps += 1; throw new Error('projection prototype'); },
    ownKeys() { traps += 1; throw new Error('projection enumeration'); },
  });
  assert.equal(
    failureCode(await compile(hostileProjection, { ...compilerRequest(), extra: true })),
    'invalid-compiler-request',
  );
  assert.equal(traps, 0);
  assert.equal(failureCode(await compile(hostileProjection)), 'projection-authentication-error');
  assert.equal(traps, 0);
  assert.equal(failureCode(await compile({ ...verified })), 'projection-authentication-error');
  assert.equal(failureCode(await compile(structuredClone(verified))), 'projection-authentication-error');
  const tampered = await projection();
  tampered.bytes[0] ^= 1;
  assert.equal(failureCode(await compile(tampered)), 'projection-authentication-error');
});

test('twin compilations and all manifest bindings are deterministic and independently recomputable', async () => {
  const verified = await projection();
  const request = compilerRequest();
  const first = assertCompileSuccess(await compile(verified, request));
  const second = assertCompileSuccess(await compile(verified, request));
  assert.deepEqual(first.artifact.bytes, second.artifact.bytes);
  assert.deepEqual(first.manifest.bytes, second.manifest.bytes);
  const manifest = JSON.parse(new TextDecoder().decode(first.manifest.bytes));
  assert.deepEqual(Object.keys(manifest).sort(), MANIFEST_KEYS);
  assert.equal(new TextDecoder().decode(first.manifest.bytes), canonicalJson(manifest));
  assert.equal(manifest.compilerFormat, COMPILER_FORMAT);
  assert.equal(manifest.artifactFormat, ARTIFACT_FORMAT);
  assert.equal(manifest.canonicalization, 'kern.canonical-json.v1');
  assert.equal(manifest.hostProfile, HOST_PROFILE);
  assert.equal(manifest.hashAlgorithm, 'sha256');
  assert.equal(manifest.runtimeFormat, 'kern.runtime.kir.v1');
  assert.equal(manifest.compilerRequestSha256, sha256(canonicalJson(request)));
  assert.deepEqual(manifest.artifact, { path: 'entry.py', sha256: first.artifact.sha256 });
  assert.equal(manifest.projectionArtifactSha256, sha256(verified.bytes));
  for (const key of ['kernelSha256', 'linkedProgramSha256', 'projectionArtifactSha256']) {
    assert.match(manifest[key], /^[a-f0-9]{64}$/u, key);
  }
  const loaded = await nativeExecute(first.artifact.bytes, {
    runs: [{ request: runtimeRequest('manifest', '{"ok":true}', []), reply: 'reply' }],
  });
  assert.equal(loaded.format, 'kern.runtime.kir.v1');
  assert.deepEqual(loaded.manifest, manifest);
});

test('unsupported linked KIR fails closed without emitting a generic fallback artifact', async () => {
  const unsupported = await projection([
    'fn name=compose export=true returns=string',
    '  handler lang=kern',
    '    capability namespace=fixture operation=resolve name=reply',
    '    let name=bad value="Json.stringify"',
    '    return value="bad"',
    '',
  ].join('\n'));
  assert.equal(failureCode(await compile(unsupported)), 'handler-entry-unsupported');
});
