import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { frozenCompileInput, frozenRuntimeRequest, generateFrozenArtifacts, targetManifestFor } from './frozen-corpus.mjs';
import { canonicalJsonBytes, parseCanonicalJsonBytes, runTargetArtifact, sha256Hex } from './r0-abi-oracle-helpers.mjs';
import { assertClosedSchema } from './schema-validator.mjs';
import { validateR0ContractBundle } from './validate-manifest.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE = 'scripts/kern-5-r0-contracts';
const CORPUS_PATH = `${BUNDLE}/generated/frozen-corpus.json`;
const EXPECTED_PATH = `${BUNDLE}/fixtures/frozen-expected-envelope.json`;
const SCHEMA_PATH = `${BUNDLE}/schema`;

function exactKeys(value, keys, label) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys`);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}

function schema(name) {
  return readJson(`${SCHEMA_PATH}/${name}.json`);
}

function validateCorpus(corpus) {
  exactKeys(corpus, ['case', 'format', 'targets'], 'frozen corpus');
  assert.equal(corpus.format, 'kern.r0.frozen-corpus.1');
  exactKeys(corpus.case, ['entry', 'id', 'kirSha256', 'semanticSha256'], 'frozen corpus case');
  assert.match(corpus.case.kirSha256, /^[0-9a-f]{64}$/u);
  assert.match(corpus.case.semanticSha256, /^[0-9a-f]{64}$/u);
  assert.equal(corpus.targets.length, 2);
  assert.deepEqual(corpus.targets.map((entry) => entry.target), ['javascript-esm', 'python']);
  for (const target of corpus.targets) {
    exactKeys(target, ['artifactPath', 'artifactSha256', 'capabilities', 'compilerRequestSha256', 'manifestPath', 'manifestSha256', 'target'], `corpus ${target.target}`);
    for (const key of ['artifactSha256', 'compilerRequestSha256', 'manifestSha256']) assert.match(target[key], /^[0-9a-f]{64}$/u);
    assert.deepEqual(target.capabilities, [{ namespace: 'r0fixture', operation: 'resolve' }]);
  }
}

function validateTargetManifest(bytes, target, corpusTarget, generated) {
  const manifest = parseCanonicalJsonBytes(bytes, `${target} target manifest`);
  assertClosedSchema(schema('target-artifact'), manifest, `${target} target manifest`);
  exactKeys(manifest, ['artifacts', 'capabilities', 'compilerRequestSha256', 'entry', 'format', 'kirSha256', 'runtimeAbi', 'semanticSha256', 'target'], `${target} target manifest`);
  assert.equal(manifest.format, 'kern.target.artifact.r0');
  assert.equal(manifest.target, target);
  assert.equal(manifest.runtimeAbi, 'kern.runtime.kir.r0');
  assert.equal(manifest.kirSha256, generated.kirSha256);
  assert.equal(manifest.semanticSha256, generated.semanticSha256);
  assert.equal(manifest.compilerRequestSha256, corpusTarget.compilerRequestSha256);
  assert.deepEqual(manifest.capabilities, corpusTarget.capabilities);
  assert.equal(manifest.artifacts.length, 1);
  return manifest;
}

function compilerRequest(generated, target) {
  return {
    entry: frozenCompileInput().cases[0].entry,
    format: 'kern.compiler.request.r0',
    kir: { bytesHex: generated.kirBytesHex, format: 'kern.kir.v1', sha256: generated.kirSha256 },
    runtimeAbi: 'kern.runtime.kir.r0',
    target,
  };
}

function validateCompilerAttestations(generated, target, corpusTarget) {
  const request = compilerRequest(generated, target);
  assertClosedSchema(schema('compiler-request'), request, `${target} compiler request`);
  assert.equal(sha256Hex(canonicalJsonBytes(request)), corpusTarget.compilerRequestSha256, `${target} compiler request digest`);
  const generatedTarget = generated.targets.find((candidate) => candidate.target === target);
  assertClosedSchema(schema('compiler-result'), generatedTarget, `${target} compiler result`);
}

function assertClosure(target, artifactBytes) {
  const source = artifactBytes.toString('utf8');
  const forbidden = target === 'javascript-esm'
    ? ['import(', 'require(', 'eval(', 'Function(', 'fetch(', 'http:', 'https:', 'writeFile', 'SemanticEnv', 'parser']
    : ['__import__(', 'eval(', 'exec(', 'socket', 'urllib', 'requests', 'subprocess', 'write(', 'SemanticEnv', 'parser'];
  for (const token of forbidden) assert.equal(source.includes(token), false, `${target} closure contains ${token}`);
  if (target === 'javascript-esm') {
    assert.deepEqual(source.match(/^import .*$/gmu) ?? [], [
      "import { createHash } from 'node:crypto';",
      "import { readFileSync } from 'node:fs';",
    ], 'JavaScript target static imports');
  } else {
    assert.deepEqual(source.match(/^(?:import |from ).*$/gmu) ?? [], [
      'import asyncio, hashlib, json, re, sys',
    ], 'Python target static imports');
  }
}

export function parseChildPeakRssBytes(platform, stderr) {
  const formats = {
    darwin: { args: ['-l'], multiplier: 1, pattern: /(\d+)\s+maximum resident set size/u },
    linux: { args: ['-v'], multiplier: 1024, pattern: /Maximum resident set size \(kbytes\):\s*(\d+)/u },
  };
  const format = formats[platform];
  assert.ok(format, `R0 child RSS measurement is unsupported on ${platform}`);
  const match = stderr.match(format.pattern);
  assert.ok(match, `R0 child measurement did not report peak RSS on ${platform}`);
  return Number.parseInt(match[1], 10) * format.multiplier;
}

function childPeakRssBytes(target, artifactPath, request) {
  const format = process.platform === 'darwin' ? ['-l'] : process.platform === 'linux' ? ['-v'] : null;
  assert.ok(format, `R0 child RSS measurement is unsupported on ${process.platform}`);
  const command = target === 'javascript-esm' ? (process.env.KERN_NODE22 ?? process.execPath) : 'python3';
  const result = spawnSync('/usr/bin/time', [...format, command, artifactPath], {
    encoding: 'utf8',
    input: canonicalJsonBytes(request),
    maxBuffer: 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${target} child measurement failed: ${result.stderr}`);
  return parseChildPeakRssBytes(process.platform, result.stderr);
}

function measure(target, artifactPath, request, budget) {
  for (let index = 0; index < budget.warmups; index += 1) runTargetArtifact(target, artifactPath, request);
  const samples = [];
  let peakRssBytes = 0;
  for (let index = 0; index < budget.samples; index += 1) {
    const started = performance.now();
    const measuredRss = childPeakRssBytes(target, artifactPath, request);
    samples.push(performance.now() - started);
    peakRssBytes = Math.max(peakRssBytes, measuredRss);
  }
  samples.sort((left, right) => left - right);
  const medianLatencyMs = samples[(samples.length - 1) / 2];
  assert.ok(medianLatencyMs <= budget.maxMedianLatencyMs, `${target} median latency ${medianLatencyMs}ms exceeds ${budget.maxMedianLatencyMs}ms`);
  assert.ok(peakRssBytes <= budget.maxPeakRssBytes, `${target} peak child RSS ${peakRssBytes} exceeds ${budget.maxPeakRssBytes}`);
  return { medianLatencyMs, peakRssBytes, samples };
}

export async function checkR0ContractBundle() {
  const bundle = validateR0ContractBundle({ rootDir: ROOT });
  const corpus = readJson(CORPUS_PATH);
  validateCorpus(corpus);
  const expected = parseCanonicalJsonBytes(readFileSync(resolve(ROOT, EXPECTED_PATH)), 'frozen expected envelope');
  assertClosedSchema(schema('runtime-envelope'), expected, 'frozen expected envelope');
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'kern-r0-contract-bundle-'));
  try {
    const generation = await generateFrozenArtifacts(outputRoot);
    assert.equal(generation.format, 'kern.r0.abi-artifact-generation.1');
    const generated = generation.cases[0];
    assert.equal(generated.id, corpus.case.id);
    assert.equal(generated.kirSha256, corpus.case.kirSha256);
    assert.equal(generated.semanticSha256, corpus.case.semanticSha256);
    const measurements = {};
    for (const corpusTarget of corpus.targets) {
      const target = generated.targets.find((entry) => entry.target === corpusTarget.target);
      assert.ok(target, `missing generated ${corpusTarget.target} target`);
      assert.equal(target.artifact.path, corpusTarget.artifactPath);
      assert.equal(target.artifact.sha256, corpusTarget.artifactSha256);
      assert.equal(target.manifest.path, corpusTarget.manifestPath);
      assert.equal(target.manifest.sha256, corpusTarget.manifestSha256);
      const manifest = targetManifestFor(outputRoot, target);
      assert.equal(sha256Hex(manifest.bytes), corpusTarget.manifestSha256);
      validateTargetManifest(manifest.bytes, target.target, corpusTarget, generated);
      validateCompilerAttestations(generated, target.target, corpusTarget);
      const artifactPath = resolve(outputRoot, target.artifact.path);
      const artifactBytes = readFileSync(artifactPath);
      assert.equal(sha256Hex(artifactBytes), corpusTarget.artifactSha256);
      assertClosure(target.target, artifactBytes);
      const request = { ...frozenRuntimeRequest({ artifactManifestSha256: sha256Hex(manifest.bytes), generated, target }), requestId: 'r0-frozen-baseline' };
      assertClosedSchema(schema('runtime-request'), request, `${target.target} frozen request`);
      const response = parseCanonicalJsonBytes(runTargetArtifact(target.target, artifactPath, request), `${target.target} frozen response`);
      assertClosedSchema(schema('runtime-envelope'), response, `${target.target} frozen response`);
      assert.deepEqual(response, expected, `${target.target} frozen envelope`);
      measurements[target.target] = measure(target.target, artifactPath, request, bundle.manifest.budgets[target.target]);
    }
    return { manifestSha256: bundle.manifestSha256, measurements };
  } finally {
    rmSync(outputRoot, { force: true, recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkR0ContractBundle().then(
    (result) => process.stdout.write(`R0 contract bundle passed ${JSON.stringify(result)}\n`),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
