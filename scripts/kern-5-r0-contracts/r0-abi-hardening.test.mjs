import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { generateR0AbiArtifacts } from './oracle.mjs';
import { canonicalJsonBytes, parseCanonicalJsonBytes, readCanonicalJsonFile, runTargetArtifact, sha256Hex } from './r0-abi-oracle-helpers.mjs';
import { buildCompileCase } from './r0-abi-test-kir.mjs';
import { compileExprJS, compileJsSource } from './r0-abi-template-esm.mjs';
import { compileExprPy, compilePySource } from './r0-abi-template-python.mjs';

const root = process.cwd();
const fixtures = JSON.parse(readFileSync(resolve(root, 'scripts/kern-5-r0-contracts/fixtures/topology-mutations.json'), 'utf8'));
const limits = { maxBytes: 65536, maxCollectionLength: 128, maxDepth: 16, maxDiagnostics: 8, maxEvents: 16, maxIterations: 128, maxStringBytes: 8192 };

function inputFor(caseFixture) {
  const operations = caseFixture.capabilitySteps === 2 ? ['resolve', 'resolveNext'] : caseFixture.capabilitySteps ? ['resolve'] : [];
  const entry = { moduleId: caseFixture.capabilitySteps === 2 ? 'r0/two-capabilities.kern' : 'r0/compose.kern', handlerName: caseFixture.capabilitySteps === 2 ? 'composeTwoCapabilities' : 'compose' };
  return { format: 'kern.r0.abi-probe-input.1', cases: [buildCompileCase({ id: caseFixture.id, entry, operations })] };
}

async function targetHarness(caseFixture = fixtures.cases[1]) {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'kern-r0-hardening-'));
  const generation = await generateR0AbiArtifacts(inputFor(caseFixture), { outputRoot });
  const generated = generation.cases[0];
  const byTarget = Object.fromEntries(generated.targets.map((target) => [target.target, target]));
  const manifests = Object.fromEntries(
    Object.entries(byTarget).map(([target, value]) => [target, readCanonicalJsonFile(resolve(outputRoot, value.manifest.path), `${target} manifest`)]),
  );
  function request(target, overrides = {}) {
    const manifest = manifests[target];
    return {
      format: 'kern.runtime.kir.r0', requestId: `hardening-${target}`, artifactManifestSha256: sha256Hex(manifest.bytes),
      kirSha256: generated.kirSha256, entry: manifest.value.entry, arguments: caseFixture.arguments,
      capabilityTranscript: caseFixture.capabilityTranscript, control: caseFixture.control, limits, ...overrides,
    };
  }
  function run(target, overrides) {
    return parseCanonicalJsonBytes(runTargetArtifact(target, resolve(outputRoot, byTarget[target].artifact.path), request(target, overrides)), target);
  }
  return { byTarget, dispose: () => rmSync(outputRoot, { recursive: true, force: true }), generated, manifests, outputRoot, request, run };
}

function exactDiagnostic(envelope, code, requestId) {
  assert.equal(envelope.requestId, requestId);
  assert.deepEqual(Object.keys(envelope.diagnostics[0]).sort(), ['category', 'code', 'phase']);
  assert.equal(envelope.diagnostics[0].code, code);
  assert.deepEqual(envelope.events, []);
  assert.deepEqual(envelope.result, { presence: 'absent' });
}

function asyncRun(target, artifactPath, request) {
  const command = target === 'javascript-esm' ? (process.env.KERN_NODE22 ?? process.execPath) : 'python3';
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [artifactPath]);
    const output = [];
    const errors = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code !== 0) rejectRun(new Error(Buffer.concat(errors).toString('utf8')));
      else resolveRun(parseCanonicalJsonBytes(Buffer.concat(output), `${target} concurrent response`));
    });
    child.stdin.end(canonicalJsonBytes(request));
  });
}

test('responses preserve request identity, exact diagnostics, and full capability event slots', async () => {
  const harness = await targetHarness();
  try {
    for (const target of Object.keys(harness.byTarget)) {
      const success = harness.run(target);
      assert.equal(success.requestId, `hardening-${target}`);
      const capability = success.events.find((event) => event.op === 'capability');
      assert.deepEqual(capability.input, { presence: 'absent' });
      assert.deepEqual(capability.result, fixtures.cases[1].capabilityTranscript[0].result);
      const failed = harness.run(target, { requestId: `failure-${target}`, capabilityTranscript: fixtures.cases[3].capabilityTranscript });
      exactDiagnostic(failed, 'capability-error', `failure-${target}`);
    }
  } finally { harness.dispose(); }
});

test('each target binds the request to its exact sibling manifest and canonical compiler request', async () => {
  const harness = await targetHarness();
  try {
    for (const target of Object.keys(harness.byTarget)) {
      const manifest = harness.manifests[target].value;
      assert.match(manifest.compilerRequestSha256, /^[0-9a-f]{64}$/u);
      assert.match(harness.byTarget[target].artifact.path, new RegExp(`^${harness.byTarget[target].compilerRequestSha256}/`));
      const other = target === 'python' ? 'javascript-esm' : 'python';
      exactDiagnostic(harness.run(target, { artifactManifestSha256: sha256Hex(harness.manifests[other].bytes) }), 'handler-link-error', `hardening-${target}`);
    }
  } finally { harness.dispose(); }
});

test('runtime request fields, typed arguments, controls, transcript identity, and unused steps fail closed', async () => {
  const harness = await targetHarness();
  try {
    const invalid = [
      { extra: true }, { arguments: { text: 3, textList: ['x'] } }, { arguments: { text: '{}', textList: ['x', 2] } },
      { requestId: '' },
      { control: { preCancelled: false, cancelAtTick: 0, timeoutTicks: 0 } },
      { capabilityTranscript: [{ ...fixtures.cases[1].capabilityTranscript[0], namespace: '' }] },
      { capabilityTranscript: [{ ...fixtures.cases[1].capabilityTranscript[0], operation: '' }] },
      { capabilityTranscript: [{ ...fixtures.cases[3].capabilityTranscript[0], error: { code: '' } }] },
      { capabilityTranscript: [{ ...fixtures.cases[1].capabilityTranscript[0], input: { presence: 'value', value: { tag: 'text', value: 'x' } } }] },
      { capabilityTranscript: [{ ...fixtures.cases[1].capabilityTranscript[0], result: fixtures.cases[1].capabilityTranscript[0].result, error: { code: 'capability-error' }}] },
      { capabilityTranscript: [...fixtures.cases[1].capabilityTranscript, fixtures.cases[1].capabilityTranscript[0]] },
    ];
    for (const target of Object.keys(harness.byTarget)) for (const overrides of invalid) {
      const code = overrides.requestId === '' ? 'handler-link-error' : 'invalid-handler-arguments';
      exactDiagnostic(harness.run(target, overrides), code, overrides.requestId ?? `hardening-${target}`);
    }
  } finally { harness.dispose(); }
});

test('every configured runtime limit is enforced proportionately', async () => {
  const harness = await targetHarness();
  try {
    const oversized = fixtures.cases[1];
    const requests = [
      { limits: { ...limits, maxBytes: 1 } }, { limits: { ...limits, maxCollectionLength: 1 } },
      { limits: { ...limits, maxDepth: 1 } }, { limits: { ...limits, maxDiagnostics: 0 } },
      { limits: { ...limits, maxEvents: 1 } }, { limits: { ...limits, maxStringBytes: 1 } },
    ];
    for (const target of Object.keys(harness.byTarget)) for (const overrides of requests) {
      const code = overrides.limits.maxDiagnostics === 0 ? 'invalid-handler-arguments' : 'runtime-limit-exceeded';
      exactDiagnostic(harness.run(target, overrides), code, `hardening-${target}`);
    }
    assert.equal(oversized.capabilitySteps, 1);
  } finally { harness.dispose(); }
});

test('cancel-at-settle wins its tie and concurrently spawned requests stay isolated per target', async () => {
  const harness = await targetHarness();
  try {
    for (const target of Object.keys(harness.byTarget)) {
      exactDiagnostic(harness.run(target, { control: { preCancelled: false, cancelAtTick: 1, timeoutTicks: null } }), 'execution-cancelled', `hardening-${target}`);
      const first = harness.request(target, { requestId: `${target}-one`, arguments: { text: '{"x":1}', textList: ['one'] } });
      const second = harness.request(target, { requestId: `${target}-two`, arguments: { text: '{"x":2}', textList: ['two'] } });
      const artifactPath = resolve(harness.outputRoot, harness.byTarget[target].artifact.path);
      const [one, two] = await Promise.all([asyncRun(target, artifactPath, first), asyncRun(target, artifactPath, second)]);
      assert.equal(one.requestId, `${target}-one`);
      assert.equal(two.requestId, `${target}-two`);
      assert.notEqual(one.result.value.value, two.result.value.value);
    }
  } finally { harness.dispose(); }
});

test('Unicode canonical bytes and strict Python numeric/tick validation agree with JavaScript', async () => {
  const harness = await targetHarness();
  try {
    const text = '{"😀":{"é":"���"},"𝌆":["é","😀"]}';
    for (const target of Object.keys(harness.byTarget)) {
      const response = harness.run(target, { arguments: { text, textList: ['é', '😀', '���'] }, capabilityTranscript: [{ ...fixtures.cases[1].capabilityTranscript[0], result: { presence: 'value', value: { tag: 'text', value: '���é😀' } }}] });
      assert.equal(response.result.value.value.includes('���é😀'), true);
      for (const bad of ['01', '9007199254740992']) exactDiagnostic(harness.run(target, { capabilityTranscript: [{ ...fixtures.cases[1].capabilityTranscript[0], result: { presence: 'value', value: { tag: 'integer', value: bad } }}] }), 'invalid-handler-arguments', `hardening-${target}`);
      exactDiagnostic(harness.run(target, { capabilityTranscript: [{ ...fixtures.cases[1].capabilityTranscript[0], delayTicks: true }] }), 'invalid-handler-arguments', `hardening-${target}`);
      const safeRequest = harness.request(target, { control: { preCancelled: false, cancelAtTick: 1, timeoutTicks: null } });
      const raw = canonicalJsonBytes(safeRequest).toString('utf8').replace('"cancelAtTick":1', '"cancelAtTick":9007199254740992');
      assert.notEqual(raw, canonicalJsonBytes(safeRequest).toString('utf8'));
      const command = target === 'javascript-esm' ? (process.env.KERN_NODE22 ?? process.execPath) : 'python3';
      const result = spawnSync(command, [resolve(harness.outputRoot, harness.byTarget[target].artifact.path)], { encoding: null, input: raw });
      exactDiagnostic(parseCanonicalJsonBytes(result.stdout, `${target} unsafe tick`), 'invalid-handler-arguments', `hardening-${target}`);
    }
  } finally { harness.dispose(); }
});

test('generation rejects unsafe identifiers and targets reject tampered capability seals', async () => {
  assert.throws(() => compileJsSource({ entry: { handlerName: 'bad-name' }, paramNames: [], handlerChildren: [] }), /safe R0 identifier/u);
  assert.throws(() => compilePySource({ entry: { handlerName: 'return' }, paramNames: [], handlerChildren: [] }), /safe R0 identifier/u);
  const harness = await targetHarness();
  try {
    for (const target of Object.keys(harness.byTarget)) {
      const path = resolve(harness.outputRoot, harness.byTarget[target].manifest.path);
      const altered = { ...harness.manifests[target].value, capabilities: [{ namespace: 'forged', operation: 'escape' }] };
      const bytes = canonicalJsonBytes(altered);
      writeFileSync(path, bytes);
      exactDiagnostic(harness.run(target, { artifactManifestSha256: sha256Hex(bytes) }), 'handler-link-error', `hardening-${target}`);
    }
  } finally { harness.dispose(); }
});

test('identifier expressions and the complete cross-target keyword union fail generation', () => {
  const identifier = (name) => ({ tag: 'record', value: [{ key: 'kind', value: { tag: 'text', value: 'identifier' } }, { key: 'fields', value: { tag: 'record', value: [{ key: 'name', value: { tag: 'text', value: name } }] } }] });
  for (const name of ['arguments', 'async', 'await', 'class', 'def', 'eval', 'False', 'function', 'lambda', 'return', 'yield']) {
    assert.throws(() => compileExprJS(identifier(name)), /safe R0 identifier/u);
    assert.throws(() => compileExprPy(identifier(name)), /safe R0 identifier/u);
  }
});

test('generator authority rejects empty declared capability seals', () => {
  assert.throws(() => buildCompileCase({ id: 'empty-capability-seal', entry: { moduleId: 'r0/empty.kern', handlerName: 'compose' }, operations: [''] }), /operation.*identifier/u);
});

test('hostile sibling manifests always return a canonical link envelope, not a target crash', async () => {
  for (const replacement of [Buffer.from('{not json\n'), canonicalJsonBytes({})]) {
    const harness = await targetHarness();
    try {
      for (const target of Object.keys(harness.byTarget)) {
        writeFileSync(resolve(harness.outputRoot, harness.byTarget[target].manifest.path), replacement);
        assert.doesNotThrow(() => exactDiagnostic(harness.run(target, { artifactManifestSha256: sha256Hex(replacement) }), 'handler-link-error', `hardening-${target}`));
      }
    } finally { harness.dispose(); }
  }
});

test('duplicate JSON keys and integers outside the portable safe range fail identically across targets', async () => {
  const harness = await targetHarness();
  try {
    for (const text of ['{"a":1,"a":2}', '{"huge":9007199254740992}']) {
      const envelopes = Object.keys(harness.byTarget).map((target) => harness.run(target, { requestId: 'strict-parity', arguments: { text, textList: ['strict'] } }));
      assert.deepEqual(envelopes[0], envelopes[1]);
      exactDiagnostic(envelopes[0], 'internal-runner-error', envelopes[0].requestId);
    }
  } finally { harness.dispose(); }
});

test('strict JSON parser rejects trailing commas and non-JSON whitespace identically', async () => {
  const harness = await targetHarness();
  try {
    for (const text of ['{"a":1,}', '[1,]', '\u00a0{"a":1}']) {
      const envelopes = Object.keys(harness.byTarget).map((target) => harness.run(target, { requestId: 'json-parity', arguments: { text, textList: ['strict'] } }));
      assert.deepEqual(envelopes[0], envelopes[1]);
      exactDiagnostic(envelopes[0], 'internal-runner-error', 'json-parity');
    }
  } finally { harness.dispose(); }
});

test('generated Python uses only static imports', async () => {
  const harness = await targetHarness();
  try {
    const source = readFileSync(resolve(harness.outputRoot, harness.byTarget.python.artifact.path), 'utf8');
    assert.match(source, /^import asyncio, hashlib, json, os, re, sys$/mu);
    assert.equal(source.includes('__import__('), false);
  } finally { harness.dispose(); }
});
