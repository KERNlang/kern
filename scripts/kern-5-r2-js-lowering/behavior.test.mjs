import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARTIFACT_FORMAT,
  COMPILER_FORMAT,
  HOST_PROFILE,
  OWNER_MARKER,
} from './owner.mjs';
import {
  assertCompileSuccess,
  canonicalJson,
  compile,
  compilerOwner,
  compilerRequest,
  emittedModule,
  executeKernKir,
  failureCode,
  projection,
  sha256,
} from './support.mjs';

const MANIFEST_KEYS = [
  'artifact', 'artifactFormat', 'canonicalization', 'compilerFormat', 'compilerRequestSha256', 'entry',
  'hashAlgorithm', 'hostProfile', 'kernelSha256', 'linkedProgramSha256', 'projectionArtifactSha256', 'runtimeFormat',
].sort();

test('discovered owner has the closed R2 public surface and exact constants', async () => {
  const { namespace } = await compilerOwner();
  assert.equal(namespace.KERN_KIR_JS_ESM_COMPILER_OWNER, OWNER_MARKER);
  assert.equal(namespace.KERN_KIR_JS_ESM_COMPILER_FORMAT, COMPILER_FORMAT);
  assert.equal(namespace.KERN_KIR_JS_ESM_ARTIFACT_FORMAT, ARTIFACT_FORMAT);
  assert.equal(namespace.KERN_KIR_JS_ESM_HOST_PROFILE, HOST_PROFILE);
  assert.equal(typeof namespace.compileKernKirToJavaScriptEsm, 'function');
});

test('compile request consumes exactly format, entry, and all seven positive limits', async () => {
  const verified = await projection();
  assertCompileSuccess(await compile(verified));
  for (const key of Object.keys(compilerRequest().limits)) {
    assert.equal(failureCode(await compile(verified, compilerRequest({ limits: { ...compilerRequest().limits, [key]: 0 } }))), 'invalid-compiler-request');
  }
  for (const malformed of [
    compilerRequest({ format: 'kern.compiler.result.r0' }),
    { ...compilerRequest(), extra: true },
    { ...compilerRequest(), limits: { ...compilerRequest().limits, extra: true } },
  ]) assert.equal(failureCode(await compile(verified, malformed)), 'invalid-compiler-request');
  const accessor = compilerRequest();
  Object.defineProperty(accessor, 'entry', { enumerable: true, get: () => ({ moduleId: 'main.kern', handlerName: 'compose' }) });
  assert.equal(failureCode(await compile(verified, accessor)), 'invalid-compiler-request');
  const symbolField = compilerRequest();
  symbolField[Symbol('not-data')] = true;
  assert.equal(failureCode(await compile(verified, symbolField)), 'invalid-compiler-request');
});

test('twin compilation and every manifest binding are deterministic and independently recomputable', async () => {
  const verified = await projection();
  const request = compilerRequest();
  const first = assertCompileSuccess(await compile(verified, request));
  const second = assertCompileSuccess(await compile(verified, request));
  assert.deepEqual(first.artifact.bytes, second.artifact.bytes);
  assert.deepEqual(first.manifest.bytes, second.manifest.bytes);
  const manifest = JSON.parse(new TextDecoder().decode(first.manifest.bytes));
  const module = await emittedModule(first.artifact.bytes);
  assert.deepEqual(Object.keys(manifest).sort(), MANIFEST_KEYS);
  assert.equal(new TextDecoder().decode(first.manifest.bytes), canonicalJson(manifest));
  assert.equal(manifest.compilerFormat, COMPILER_FORMAT);
  assert.equal(manifest.artifactFormat, ARTIFACT_FORMAT);
  assert.equal(manifest.canonicalization, 'kern.canonical-json.v1');
  assert.equal(manifest.hostProfile, HOST_PROFILE);
  assert.equal(manifest.hashAlgorithm, 'sha256');
  assert.equal(manifest.runtimeFormat, 'kern.runtime.kir.v1');
  assert.equal(manifest.compilerRequestSha256, sha256(canonicalJson(request)));
  assert.equal(manifest.artifact.path, first.artifact.path);
  assert.equal(manifest.artifact.sha256, first.artifact.sha256);
  assert.equal(manifest.projectionArtifactSha256, sha256(verified.bytes));
  assert.match(manifest.kernelSha256, /^[a-f0-9]{64}$/u);
  assert.match(manifest.linkedProgramSha256, /^[a-f0-9]{64}$/u);
  assert.match(manifest.projectionArtifactSha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(module.manifest, manifest);
  assert.equal(module.manifest.artifact.sha256, first.artifact.sha256);
  assert.equal(module.manifest.kernelSha256, manifest.kernelSha256);
  assert.equal(module.manifest.linkedProgramSha256, manifest.linkedProgramSha256);
  assert.equal(module.manifest.projectionArtifactSha256, manifest.projectionArtifactSha256);
});

test('projection authentication and unsupported KIR fail closed without target bytes or provider effects', async () => {
  const verified = await projection();
  assert.equal(failureCode(await compile({ ...verified })), 'projection-authentication-error');
  assert.equal(failureCode(await compile(structuredClone(verified))), 'projection-authentication-error');
  const authBeforeRead = new Proxy(verified, {
    get() { throw new Error('projection must authenticate before property access'); },
    ownKeys() { throw new Error('projection must authenticate before enumeration'); },
  });
  assert.equal(failureCode(await compile(authBeforeRead)), 'projection-authentication-error');
  const tampered = await projection();
  tampered.bytes[0] ^= 1;
  assert.equal(failureCode(await compile(tampered)), 'projection-authentication-error');
  const unsupported = await projection([
    'fn name=compose export=true returns=string', '  handler lang=kern',
    '    capability namespace=fixture operation=resolve name=reply', '    let name=bad value="Json.stringify"',
    '    return value="bad"', '',
  ].join('\n'));
  assert.equal(failureCode(await compile(unsupported)), 'handler-entry-unsupported');
});

test('RT-1 authenticates a projection before it can inspect hostile request or execution-option proxies', async () => {
  const forged = { ...(await projection()) };
  let traps = 0;
  const hostile = (target) => new Proxy(target, {
    get(targetValue, key, receiver) { traps += 1; return Reflect.get(targetValue, key, receiver); },
    getOwnPropertyDescriptor(targetValue, key) { traps += 1; return Reflect.getOwnPropertyDescriptor(targetValue, key); },
    getPrototypeOf(targetValue) { traps += 1; return Reflect.getPrototypeOf(targetValue); },
    ownKeys(targetValue) { traps += 1; return Reflect.ownKeys(targetValue); },
  });
  const envelope = await executeKernKir(forged, hostile(Object.create(null)), hostile(Object.create(null)));
  assert.equal(envelope.outcome, 'failure');
  assert.equal(envelope.diagnostics[0]?.code, 'projection-authentication-error');
  assert.equal(traps, 0, 'forged projections must reject before request/options proxy effects');
});
