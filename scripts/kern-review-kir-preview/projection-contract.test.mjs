import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { promisify } from 'node:util';

import { decodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { KIR_REVIEW_FIXTURES } from './fixtures/fixtures.mjs';

const PUBLIC_PROJECTION = '@kernlang/core/frontend-projection';
const FEATURE_MODULE_URL = new URL('../../packages/core/dist/frontend-projection.js', import.meta.url);
const PRIVATE_F5_WORKER_URL = new URL('../kern-frontend-f5-projection/worker.mjs', import.meta.url);
const execFileAsync = promisify(execFile);
const FROZEN_MODULES = Object.freeze(KIR_REVIEW_FIXTURES.reordered.base.modules.map((module) =>
  Object.freeze({ ...module })));
const KIR_LIMITS = Object.freeze({
  maxBytes: 16_777_216,
  maxCollectionLength: 262_144,
  maxDecimalChars: 128,
  maxDepth: 256,
  maxFractionDigits: 64,
  maxIntegerDigits: 512,
  maxMapEntries: 262_144,
  maxNodes: 1_048_576,
  maxRecordFields: 262_144,
  maxStringBytes: 16_777_216,
});

function dynamicallyConstructedModules() {
  const moduleId = `${['adversarial', 'public-parity'].join('/')}.kern`;
  const functionName = ['parity', 'Probe'].join('');
  const source = [
    `fn name=${functionName} returns=string export=true`,
    '  param name=id type=string',
    '  handler lang="kern"',
    '    capability namespace=cache operation=write name=review',
    '    return value="id"',
    '',
  ].join('\n');
  const modules = Object.freeze([Object.freeze({ moduleId, source })]);
  for (const fixture of KIR_REVIEW_FIXTURES.cases) {
    for (const side of ['base', 'head']) {
      assert.ok(fixture[side].every((module) => module.moduleId !== moduleId && module.source !== source),
        'adversarial parity input must not be copied from any frozen fixture');
    }
  }
  return modules;
}

function dynamicallyConstructedCyclicModules() {
  const a = ['generated', 'cycle-a'].join('/');
  const b = ['generated', 'cycle-b'].join('/');
  return Object.freeze([
    Object.freeze({
      moduleId: `${a}.kern`,
      source: `use path="./cycle-b"\n  from name=b kind=fn as=b\n\nfn name=a export=true\n`,
    }),
    Object.freeze({
      moduleId: `${b}.kern`,
      source: `use path="./cycle-a"\n  from name=a kind=fn as=a\n\nfn name=b export=true\n`,
    }),
  ]);
}

async function projectionApi() {
  try {
    const api = await import(FEATURE_MODULE_URL.href);
    assert.equal(typeof api.projectKernModules, 'function',
      `${PUBLIC_PROJECTION} must export projectKernModules(request)`);
    assert.equal(typeof api.verifyKernProjection, 'function',
      `${PUBLIC_PROJECTION} must export verifyKernProjection(request, result)`);
    return api;
  } catch (error) {
    throw new Error(
      `KRI-A1/A2/A3/A7 contract missing: ${FEATURE_MODULE_URL.pathname} must implement ${PUBLIC_PROJECTION} (${error.code ?? error.name}: ${error.message})`,
      { cause: error },
    );
  }
}

async function privateF5Projection(modules, profileLimits) {
  const input = JSON.stringify({ modules, profileLimits });
  const childSource = [
    `import { __test, runProjection } from ${JSON.stringify(PRIVATE_F5_WORKER_URL.href)};`,
    `const input = JSON.parse(${JSON.stringify(input)});`,
    'const result = input.profileLimits === undefined',
    '  ? runProjection(input.modules)',
    '  : __test.runProjectionWithProfileLimits(input.modules, input.profileLimits);',
    'process.stdout.write(JSON.stringify({',
    '  receipt: result.receipt,',
    "  bytes: result.bytes === null ? null : Buffer.from(result.bytes).toString('base64'),",
    '}));',
  ].join('\n');
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !key.startsWith('KERN_') && !['NODE_OPTIONS', 'NODE_V8_COVERAGE'].includes(key)));
  const { stdout, stderr } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', childSource], {
    env: environment,
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(stderr, '', 'private F5 child must not leak oracle diagnostics to the public test process');
  const result = JSON.parse(stdout);
  return {
    receipt: result.receipt,
    bytes: result.bytes === null ? null : Uint8Array.from(Buffer.from(result.bytes, 'base64')),
  };
}

function request(modules = FROZEN_MODULES, budgets) {
  return budgets === undefined
    ? { modules: modules.map((module) => ({ ...module })) }
    : { modules: modules.map((module) => ({ ...module })), budgets };
}

function assertProjected(result, label) {
  assert.equal(result.status, 'projected', `${label}: success status`);
  assert.ok(result.bytes instanceof Uint8Array, `${label}: canonical bytes`);
  assert.ok(result.bytes.byteLength > 0, `${label}: non-empty canonical bytes`);
  assert.ok(result.artifact && typeof result.artifact === 'object', `${label}: decoded artifact`);
  assert.ok(result.receipt && typeof result.receipt === 'object', `${label}: receipt`);
  assert.equal(result.receipt.format, 'kern.frontend.packaged-projection.1', `${label}: receipt format`);
  for (const field of [
    'requestDigest', 'artifactDigest', 'f5PolicyDigest', 'f5ReceiptFormat', 'f5Status',
    'compositionDigest', 'assetManifestDigest', 'workSteps', 'terminalSeal',
  ]) {
    assert.notEqual(result.receipt[field], undefined, `${label}: receipt binds ${field}`);
  }
}

function assertAtomicFailure(result, label) {
  assert.ok(['rejected', 'fatal'].includes(result.status), `${label}: typed failure status`);
  assert.equal(result.bytes, null, `${label}: no partial bytes`);
  assert.equal(result.artifact, null, `${label}: no partial decoded artifact`);
  assert.ok(result.receipt && typeof result.receipt === 'object', `${label}: failure receipt`);
}

function assertWrapperFailure(result, expectedCode, label) {
  assertAtomicFailure(result, label);
  assert.deepEqual(result.diagnostics?.map((diagnostic) => diagnostic.code), [expectedCode],
    `${label}: public wrapper exposes the exact typed diagnostic code`);
}

function clonedResult(result) {
  return {
    ...result,
    bytes: result.bytes === null ? null : new Uint8Array(result.bytes),
    artifact: structuredClone(result.artifact),
    receipt: structuredClone(result.receipt),
  };
}

async function assertVerificationRejects(api, sourceRequest, result, label) {
  await assert.rejects(
    () => api.verifyKernProjection(sourceRequest, result),
    undefined,
    `${label}: verifier must reject detached or tampered evidence`,
  );
}

test('KRI-A1 projects the frozen multi-module F5 golden byte-for-byte through the public subpath', async () => {
  const sourceRequest = request();
  const privateResult = await privateF5Projection(sourceRequest.modules);
  const api = await projectionApi();
  const publicResult = await api.projectKernModules(sourceRequest);
  assertProjected(publicResult, 'public projection');

  assert.equal(privateResult.receipt.status, 'projected', 'private F5 oracle projects the frozen fixture');
  assert.deepEqual(
    Buffer.from(publicResult.bytes),
    Buffer.from(privateResult.bytes),
    'supported public projection must preserve private F5 canonical bytes exactly',
  );
  const verified = await api.verifyKernProjection(sourceRequest, publicResult);
  assert.ok(verified && typeof verified === 'object', 'verification returns a verified projection value');
});

test('KRI-A1 public projection preserves private F5 bytes for dynamically constructed non-fixture input', async () => {
  const modules = dynamicallyConstructedModules();
  const sourceRequest = request(modules);
  const privateResult = await privateF5Projection(sourceRequest.modules);
  const api = await projectionApi();
  const publicResult = await api.projectKernModules(sourceRequest);
  assertProjected(publicResult, 'dynamic public projection');
  assert.equal(privateResult.receipt.status, 'projected', 'private F5 projects generated input');
  assert.deepEqual(Buffer.from(publicResult.bytes), Buffer.from(privateResult.bytes),
    'public projection cannot substitute a fixture-specific golden for generated input');
});

test('KRI-A2 closes request, receipt, artifact, and asset detachment before a projection becomes verified', async () => {
  const api = await projectionApi();
  const sourceRequest = request();
  const projected = await api.projectKernModules(sourceRequest);
  assertProjected(projected, 'tamper baseline');

  const changedSource = request();
  changedSource.modules[0].source += '# detached source mutation\n';
  await assertVerificationRejects(api, changedSource, clonedResult(projected), 'source mutation');

  const changedModuleId = request();
  changedModuleId.modules[0].moduleId = 'lib/renamed.kern';
  await assertVerificationRejects(api, changedModuleId, clonedResult(projected), 'module identity mutation');

  const detachedBytes = clonedResult(projected);
  detachedBytes.bytes[0] ^= 1;
  await assertVerificationRejects(api, sourceRequest, detachedBytes, 'artifact-byte mutation');

  const alternate = await privateF5Projection(dynamicallyConstructedModules());
  assert.equal(alternate.receipt.status, 'projected', 'alternate F5 artifact is decodable evidence');
  const detachedArtifact = clonedResult(projected);
  detachedArtifact.artifact = decodeModuleKir(alternate.bytes, KIR_LIMITS);
  await assertVerificationRejects(api, sourceRequest, detachedArtifact,
    'decoded artifact from different canonical bytes');

  for (const field of [
    'requestDigest', 'artifactDigest', 'f5PolicyDigest', 'f5ReceiptFormat', 'f5Status',
    'compositionDigest', 'assetManifestDigest', 'workSteps', 'terminalSeal',
  ]) {
    const detachedReceipt = clonedResult(projected);
    detachedReceipt.receipt[field] = typeof detachedReceipt.receipt[field] === 'number'
      ? detachedReceipt.receipt[field] + 1
      : `${detachedReceipt.receipt[field]}-tampered`;
    await assertVerificationRejects(api, sourceRequest, detachedReceipt, `receipt ${field} mutation`);
  }
});

test('KRI-A3 rejects invalid input atomically instead of returning partial KIR evidence', async () => {
  const duplicateModules = [FROZEN_MODULES[0], FROZEN_MODULES[0]];
  const malformedModules = [{ ...KIR_REVIEW_FIXTURES.projectionFailure.modules[0] }];
  const [privateDuplicate, privateMalformed, privateLimit] = await Promise.all([
    privateF5Projection(duplicateModules),
    privateF5Projection(malformedModules),
    privateF5Projection(FROZEN_MODULES, { maxWorkSteps: 1 }),
  ]);
  assert.equal(privateDuplicate.receipt.status, 'rejected', 'private duplicate module evidence rejects');
  assert.deepEqual(privateDuplicate.receipt.diagnostics, [], 'private duplicate rejection has no fabricated cause');
  assert.equal(privateMalformed.receipt.status, 'rejected', 'private malformed evidence rejects');
  assert.deepEqual(privateMalformed.receipt.diagnostics.map((diagnostic) => diagnostic.code), ['F4_F1_DRIFT'],
    'private malformed evidence is exactly F4_F1_DRIFT');
  assert.equal(privateLimit.receipt.status, 'fatal', 'private constrained evidence is fatal');
  assert.deepEqual(privateLimit.receipt.diagnostics.map((diagnostic) => diagnostic.code), ['F5_LIMIT'],
    'private constrained evidence is exactly F5_LIMIT');

  const api = await projectionApi();
  const duplicate = await api.projectKernModules(request(duplicateModules));
  assertWrapperFailure(duplicate, 'projection-rejected', 'duplicate module identity');

  const malformed = await api.projectKernModules(request(malformedModules));
  assertWrapperFailure(malformed, 'F4_F1_DRIFT', 'malformed source maps its private F4 diagnostic');

  const overBudget = await api.projectKernModules(request(FROZEN_MODULES, { maxWorkSteps: 1 }));
  assertWrapperFailure(overBudget, 'F5_LIMIT', 'explicit budget limit');
});

test('KRI-A3 cyclic module dependencies retain the private rejection status and wrapper atomicity', async () => {
  const modules = dynamicallyConstructedCyclicModules();
  const privateResult = await privateF5Projection(modules);
  assert.equal(privateResult.receipt.status, 'rejected', 'private F5 rejects the generated dependency cycle');
  assert.deepEqual(privateResult.receipt.diagnostics, [], 'private cycle rejection has no invented diagnostic');
  assert.equal(privateResult.bytes, null, 'private cycle rejection has no partial bytes');

  const api = await projectionApi();
  const result = await api.projectKernModules(request(modules));
  assert.equal(result.status, privateResult.receipt.status, 'public wrapper preserves private rejection status');
  assertWrapperFailure(result, 'projection-rejected', 'cyclic module dependency');
});

test('KRI-A7 canonical projection is deterministic for repeated and permuted module requests', async () => {
  const api = await projectionApi();
  const ordered = request();
  const reversed = request([...FROZEN_MODULES].reverse());
  const [first, second, permutation] = await Promise.all([
    api.projectKernModules(ordered),
    api.projectKernModules(ordered),
    api.projectKernModules(reversed),
  ]);
  for (const [label, result] of [['first', first], ['second', second], ['permutation', permutation]]) {
    assertProjected(result, label);
  }
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from(second.bytes), 'repeated request bytes');
  assert.deepEqual(Buffer.from(first.bytes), Buffer.from(permutation.bytes), 'permuted request bytes');
  assert.deepEqual(first.receipt, second.receipt, 'repeated request receipt');
  assert.deepEqual(first.receipt, permutation.receipt, 'permuted request receipt');
  await assert.doesNotReject(() => api.verifyKernProjection(reversed, permutation),
    'the code-point-sorted request identity accepts an equivalent permutation');
});
