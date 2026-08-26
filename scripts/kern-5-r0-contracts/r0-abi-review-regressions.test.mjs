import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { encodeKirEvidence } from '../../packages/core/dist/kir-evidence/canonical.js';
import { encodeModuleKir } from '../../packages/core/dist/kir-structural/module-canonical.js';
import { encodeKirV1 } from '../../packages/core/dist/kir-v1/canonical.js';
import { parseDocumentStrict } from '../../packages/core/dist/parser.js';
import { generateR0AbiArtifacts } from './oracle.mjs';
import { canonicalJsonBytes, parseCanonicalJsonBytes, readCanonicalJsonFile, runTargetArtifact, sha256Hex } from './r0-abi-oracle-helpers.mjs';
import { r0KirLimits } from './r0-abi-kir-limits.mjs';
import { buildCompileCase } from './r0-abi-test-kir.mjs';
import { compileExprJS } from './r0-abi-template-esm.mjs';
import { compileExprPy } from './r0-abi-template-python.mjs';

const root = process.cwd();
const fixture = JSON.parse(readFileSync(resolve(root, 'scripts/kern-5-r0-contracts/fixtures/topology-mutations.json'), 'utf8')).cases[1];
const limits = { maxBytes: 65536, maxCollectionLength: 128, maxDepth: 16, maxDiagnostics: 8, maxEvents: 16, maxStringBytes: 8192 };
const entry = { moduleId: 'r0/compose.kern', handlerName: 'compose' };

function defaultInput() {
  return { format: 'kern.r0.abi-probe-input.1', cases: [buildCompileCase({ id: 'review-regression', entry, operations: ['resolve'] })] };
}

async function harness(input = defaultInput(), outputPrefix = 'kern-r0-review-') {
  const outputRoot = mkdtempSync(resolve(tmpdir(), outputPrefix));
  const generation = await generateR0AbiArtifacts(input, { outputRoot });
  const generated = generation.cases[0];
  const targets = Object.fromEntries(generated.targets.map((target) => [target.target, target]));
  function manifest(target) {
    return readCanonicalJsonFile(resolve(outputRoot, targets[target].manifest.path), `${target} manifest`);
  }
  function request(target, overrides = {}) {
    const sibling = manifest(target);
    return {
      format: 'kern.runtime.kir.r0', requestId: `review-${target}`,
      artifactManifestSha256: sha256Hex(sibling.bytes), kirSha256: generated.kirSha256,
      entry: sibling.value.entry, arguments: fixture.arguments,
      capabilityTranscript: fixture.capabilityTranscript, control: fixture.control, limits, ...overrides,
    };
  }
  function run(target, overrides = {}) {
    return parseCanonicalJsonBytes(runTargetArtifact(target, resolve(outputRoot, targets[target].artifact.path), request(target, overrides)), `${target} response`);
  }
  function runRaw(target, raw, { env = process.env } = {}) {
    const command = target === 'javascript-esm' ? (process.env.KERN_NODE22 ?? process.execPath) : 'python3';
    const result = spawnSync(command, [resolve(outputRoot, targets[target].artifact.path)], { encoding: null, env, input: raw });
    assert.equal(result.status, 0, `${target} raw target exited cleanly: ${result.stderr.toString('utf8')}`);
    return parseCanonicalJsonBytes(result.stdout, `${target} raw response`);
  }
  return { dispose: () => rmSync(outputRoot, { force: true, recursive: true }), generated, manifest, outputRoot, request, run, runRaw, targets };
}

function exactFailure(response, code, requestId, phase = 'execution') {
  assert.deepEqual(response.completion, { kind: 'error' });
  assert.equal(response.diagnostics.length, 1);
  assert.deepEqual(response.diagnostics[0], { category: 'runtime', code, phase });
  assert.equal(response.outcome, 'failure');
  assert.equal(response.requestId, requestId);
  assert.deepEqual(response.events, []);
  assert.deepEqual(response.result, { presence: 'absent' });
}

function expression(kind, fields) {
  return { tag: 'record', value: [
    { key: 'kind', value: { tag: 'text', value: kind } },
    { key: 'fields', value: { tag: 'record', value: fields } },
  ] };
}

function sameKirDistinctEntries() {
  const moduleId = 'r0/two-entries.kern';
  const source = [
    'fn name=composeFirst export=true returns=string', '  param name=text type=string', '  param name=textList type=string[]', '  handler lang=kern',
    '    let name=payload value="Json.parse(text)"', '    let name=result value="Json.stringify({ labels: textList, payload: payload })"', '    print value="result"', '    return value="result"',
    'fn name=composeSecond export=true returns=string', '  param name=text type=string', '  param name=textList type=string[]', '  handler lang=kern',
    '    let name=payload value="Json.parse(text)"', '    let name=result value="Json.stringify({ labels: textList, payload: payload })"', '    print value="result"', '    return value="result"', '',
  ].join('\n');
  const sourceEvidenceCatalog = [{ moduleId, source }];
  const semanticBytes = encodeModuleKir([{ id: moduleId, roots: parseDocumentStrict(source).children ?? [] }], r0KirLimits);
  const content = 'Json.parse(text)';
  const startByte = Buffer.byteLength(source.slice(0, source.indexOf(content)), 'utf8');
  const evidenceBytes = encodeKirEvidence({
    diagnostics: [{ category: 'validator', code: 'two-entry-witness', id: 'two-entry-witness', message: 'Two entry KIR witness.', moduleId, severity: 'info', spanId: 'two-entry-parse' }],
    semanticBytes, sources: sourceEvidenceCatalog,
    spans: [{ content, endByte: startByte + Buffer.byteLength(content, 'utf8'), id: 'two-entry-parse', moduleId, nodePath: [0, 2, 0], propertyKey: 'value', startByte }],
  }, { limits: r0KirLimits });
  const kirBytesHex = Buffer.from(encodeKirV1({ semanticBytes, evidenceBytes }, sourceEvidenceCatalog, { limits: r0KirLimits })).toString('hex');
  return ['composeFirst', 'composeSecond'].map((handlerName, index) => ({
    entry: { moduleId, handlerName }, id: `two-entry-${index + 1}`, kirBytesHex, sourceEvidenceCatalog,
  }));
}

test('strict inner JSON exponent safe integers agree while nonintegral and unsafe values fail', async () => {
  const probe = await harness();
  try {
    const successes = ['javascript-esm', 'python'].map((target) => probe.run(target, { arguments: { text: '{"n":1e3}', textList: ['safe'] }, requestId: 'review-parity' }));
    assert.deepEqual(successes[0], successes[1]);
    assert.equal(JSON.parse(successes[0].result.value.value).payload.n, 1000);
    for (const text of ['{"n":1.5}', '{"n":9007199254740992}']) {
      const failures = ['javascript-esm', 'python'].map((target) => probe.run(target, { arguments: { text, textList: ['bad'] }, requestId: 'review-parity' }));
      assert.deepEqual(failures[0], failures[1]);
      exactFailure(failures[0], 'internal-runner-error', 'review-parity');
    }
  } finally { probe.dispose(); }
});

test('parsed and compiled __proto__ records remain own data without prototype pollution', async () => {
  const probe = await harness();
  try {
    for (const target of ['javascript-esm', 'python']) {
      const response = probe.run(target, { arguments: { text: '{"__proto__":{"polluted":true},"safe":1}', textList: ['proto'] } });
      const payload = JSON.parse(response.result.value.value).payload;
      assert.equal(Object.hasOwn(payload, '__proto__'), true);
      assert.deepEqual(payload.__proto__, { polluted: true });
    }
    const protoRecord = expression('record', [{ key: 'entries', value: { tag: 'record', value: [{ key: '__proto__', value: expression('identifier', [{ key: 'name', value: { tag: 'text', value: 'text' } }]) }] } }]);
    const compiled = compileExprJS(protoRecord);
    const value = Function('text', `return ${compiled};`)('own-data');
    assert.equal(Object.hasOwn(value, '__proto__'), true);
    assert.equal(value.__proto__, 'own-data');
    assert.match(compileExprPy(protoRecord), /"__proto__": text/u);
    assert.equal({}.polluted, undefined);
  } finally { probe.dispose(); }
});

test('tampered compiler and semantic sidecar digests fail as canonical handler links', async () => {
  const probe = await harness();
  try {
    for (const target of ['javascript-esm', 'python']) for (const key of ['compilerRequestSha256', 'semanticSha256']) {
      const pristine = probe.manifest(target);
      const original = pristine.value;
      const tampered = { ...original, [key]: original[key] === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64) };
      const bytes = canonicalJsonBytes(tampered);
      writeFileSync(resolve(probe.outputRoot, probe.targets[target].manifest.path), bytes);
      exactFailure(probe.run(target, { artifactManifestSha256: sha256Hex(bytes) }), 'handler-link-error', `review-${target}`, 'link');
      writeFileSync(resolve(probe.outputRoot, probe.targets[target].manifest.path), pristine.bytes);
    }
  } finally { probe.dispose(); }
});

test('distinct selected entries from one authenticated KIR receive distinct output paths', async () => {
  const entries = sameKirDistinctEntries();
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'kern-r0-two-entry-'));
  try {
    const generation = await generateR0AbiArtifacts({ format: 'kern.r0.abi-probe-input.1', cases: entries }, { outputRoot });
    assert.equal(generation.cases[0].kirSha256, generation.cases[1].kirSha256);
    for (const target of ['javascript-esm', 'python']) {
      const left = generation.cases[0].targets.find((item) => item.target === target);
      const right = generation.cases[1].targets.find((item) => item.target === target);
      assert.notEqual(left.compilerRequestSha256, right.compilerRequestSha256);
      assert.notEqual(left.artifact.path, right.artifact.path);
      assert.notEqual(left.manifest.path, right.manifest.path);
      assert.notDeepEqual(readFileSync(resolve(outputRoot, left.artifact.path)), readFileSync(resolve(outputRoot, right.artifact.path)));
    }
  } finally { rmSync(outputRoot, { force: true, recursive: true }); }
});

test('a success envelope that exceeds maxBytes fails atomically', async () => {
  const probe = await harness();
  try {
    for (const target of ['javascript-esm', 'python']) {
      const argumentsValue = { text: JSON.stringify({ large: 'x'.repeat(4096) }), textList: ['large'] };
      const success = runTargetArtifact(target, resolve(probe.outputRoot, probe.targets[target].artifact.path), probe.request(target, { arguments: argumentsValue }));
      const maxBytes = success.length - 1;
      const limited = probe.request(target, { arguments: argumentsValue, limits: { ...limits, maxBytes } });
      assert.ok(canonicalJsonBytes(limited).length < maxBytes, 'request itself must fit the selected maxBytes');
      exactFailure(probe.run(target, { arguments: argumentsValue, limits: { ...limits, maxBytes } }), 'runtime-limit-exceeded', `review-${target}`);
    }
  } finally { probe.dispose(); }
});

test('escaped lone surrogates have parity and are invalid handler arguments at the boundary', async () => {
  const probe = await harness();
  try {
    const outer = ['javascript-esm', 'python'].map((target) => probe.run(target, { arguments: { text: '\ud800', textList: ['outer'] }, requestId: 'review-parity' }));
    assert.deepEqual(outer[0], outer[1]);
    exactFailure(outer[0], 'invalid-handler-arguments', 'review-parity');
    const inner = ['javascript-esm', 'python'].map((target) => probe.run(target, { arguments: { text: '"\\ud800"', textList: ['inner'] }, requestId: 'review-parity' }));
    assert.deepEqual(inner[0], inner[1]);
    exactFailure(inner[0], 'internal-runner-error', 'review-parity');
  } finally { probe.dispose(); }
});

test('escaped lone surrogate request IDs return a canonical failure on both targets', async () => {
  const probe = await harness();
  try {
    const responses = ['javascript-esm', 'python'].map((target) =>
      probe.runRaw(target, canonicalJsonBytes(probe.request(target, { requestId: '\ud800' }))),
    );
    assert.deepEqual(responses[0], responses[1]);
    exactFailure(responses[0], 'invalid-handler-arguments', null);
  } finally { probe.dispose(); }
});

test('Python emits canonical UTF-8 bytes independently of the stdout locale', async () => {
  const probe = await harness();
  try {
    const requestId = 'réview-python';
    const response = probe.runRaw('python', canonicalJsonBytes(probe.request('python', { requestId })), {
      env: { ...process.env, PYTHONIOENCODING: 'ascii' },
    });
    assert.equal(response.outcome, 'success');
    assert.equal(response.requestId, requestId);
  } finally { probe.dispose(); }
});

test('a non-object capability transcript item is invalid-handler-arguments on both targets', async () => {
  const probe = await harness();
  try {
    const responses = ['javascript-esm', 'python'].map((target) => probe.run(target, { capabilityTranscript: [null], requestId: 'review-parity' }));
    assert.deepEqual(responses[0], responses[1]);
    exactFailure(responses[0], 'invalid-handler-arguments', 'review-parity');
  } finally { probe.dispose(); }
});

test('Python resolves its sibling manifest under an ancestor named main.py', async () => {
  const probe = await harness(defaultInput(), 'main.py-ancestor-');
  try {
    const response = probe.run('python');
    assert.equal(response.outcome, 'success');
  } finally { probe.dispose(); }
});

test('noncanonical but parseable runtime request bytes are invalid handler arguments', async () => {
  const probe = await harness();
  try {
    const responses = ['javascript-esm', 'python'].map((target) => {
      const raw = Buffer.from(canonicalJsonBytes(probe.request(target)).toString('utf8').replace('{', '{ '), 'utf8');
      return probe.runRaw(target, raw);
    });
    exactFailure(responses[0], 'invalid-handler-arguments', 'review-javascript-esm');
    exactFailure(responses[1], 'invalid-handler-arguments', 'review-python');
    assert.deepEqual(responses[0].diagnostics, responses[1].diagnostics);
  } finally { probe.dispose(); }
});

test('compiler input rejects top-level source, AST, and legacy IR additions', async () => {
  for (const field of ['source', 'ast', 'legacyIr']) {
    await assert.rejects(
      generateR0AbiArtifacts({ ...defaultInput(), [field]: { rejected: true } }, { outputRoot: tmpdir() }),
      /compiler input has unexpected fields/u,
    );
  }
});

test('the shared target runner terminates a hung artifact at its timeout', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'kern-r0-hung-runner-'));
  const artifact = resolve(directory, 'hang.mjs');
  try {
    writeFileSync(artifact, 'setInterval(() => {}, 1000);\n');
    assert.throws(() => runTargetArtifact('javascript-esm', artifact, {}), /timed out/u);
  } finally { rmSync(directory, { force: true, recursive: true }); }
});
