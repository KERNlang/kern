import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  digestM4145CompiledCoreJavaScript,
  digestPreM4135CompiledCoreJavaScript,
  reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths,
  reconstructM4145CompiledCoreJavaScriptPaths,
  reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths,
} from './coverage-dependencies.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS,
  POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS,
  RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION,
  RUNTIME_TEXT_CACHE_TYPE_ONLY_COMPILED_IDENTITIES,
} from './runtime-text-cache-historical-transition.mjs';
import { reconstructCanonicalizerHistoricalRuntimeSource } from './runtime-source-historical-chain.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';
import {
  POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
} from './legacy-trace-compaction-historical-transition.mjs';
import { POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS } from './trace-compaction-historical-transition.mjs';

const CACHE_SUCCESSOR_PATH = 'ir/semantics/internal-text-code-point-cache.js';
const RETAINED_CHANGED_PATHS = [
  'ir/semantics/internal-effect-machine.js',
  'ir/semantics/portable-string.js',
  'runtime-envelope/execute-compat.js',
  'runtime-envelope/execute.js',
  'runtime-envelope/internal-engine.js',
];

function compiledCorePaths() {
  const root = resolve(process.cwd(), 'packages/core/dist');
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.js')) files.push(path);
    }
  }
  visit(root);
  return files.map((path) => relative(root, path).split(sep).join('/')).sort();
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function pathInventoryDigest(paths) {
  const hash = createHash('sha256');
  for (const name of [...paths].sort()) hash.update(`${name.length}:${name}`);
  return hash.digest('hex');
}

function compiledCoreDigest(overrides = new Map()) {
  const root = resolve(process.cwd(), 'packages/core/dist');
  const hash = createHash('sha256');
  for (const name of compiledCorePaths()) {
    const bytes = overrides.get(name) ?? readFileSync(resolve(root, name));
    hash.update(`${name.length}:${name}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function reconstructPreTraceCompiled(path, currentSource) {
  const stages = [];
  const legacyReconstruction = POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  if (legacyReconstruction !== undefined) {
    stages.push(historicalTransitionStage({
      claim: legacyReconstruction.claim,
      currentDigest: legacyReconstruction.currentDigest,
      expectedDigest: legacyReconstruction.expectedDigest,
      path,
      replacements: legacyReconstruction.replacements,
    }));
  }
  const reconstruction = POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  if (reconstruction === undefined) {
    if (stages.length === 0) return currentSource;
    return reconstructHistoricalTransitionChain({
      currentSource,
      expectedTerminalDigest: legacyReconstruction.expectedDigest,
      milestone: `test pre-trace ${path}`,
      path,
      stages,
    });
  }
  stages.push(historicalTransitionStage({
    claim: reconstruction.claim,
    currentDigest: reconstruction.currentDigest,
    expectedDigest: reconstruction.expectedDigest,
    path,
    replacements: reconstruction.replacements,
  }));
  return reconstructHistoricalTransitionChain({
    currentSource,
    expectedTerminalDigest: reconstruction.expectedDigest,
    milestone: `test pre-trace ${path}`,
    path,
    stages,
  });
}

test('runtime text cache transition binds the exact 316-to-317 inventory delta', () => {
  assert.equal(RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.commit, 'd33b9f50');
  assert.deepEqual(
    RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.addedPaths,
    [CACHE_SUCCESSOR_PATH],
  );
  const currentPaths = compiledCorePaths();
  const traceRetentionOwnershipPaths =
    reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths(currentPaths);
  const traceCompactionPaths =
    reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths(traceRetentionOwnershipPaths);
  const current = RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.currentInventory;
  assert.equal(traceCompactionPaths.length, current.count);
  assert.equal(pathInventoryDigest(traceCompactionPaths), current.digest);
  const predecessorPaths = traceCompactionPaths.filter((path) => path !== CACHE_SUCCESSOR_PATH);
  const predecessor = RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.predecessorInventory;
  assert.equal(predecessorPaths.length, predecessor.count);
  assert.equal(pathInventoryDigest(predecessorPaths), predecessor.digest);
});

test('runtime text cache retained owners reconstruct exact clean baseline bytes', () => {
  const root = resolve(process.cwd(), 'packages/core/dist');
  assert.deepEqual(
    POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS.map(({ path }) => path),
    RETAINED_CHANGED_PATHS,
  );
  for (const reconstruction of POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS) {
    const liveSource = readFileSync(resolve(root, reconstruction.path));
    const currentSource = reconstructPreTraceCompiled(reconstruction.path, liveSource);
    assert.equal(digest(currentSource), reconstruction.currentDigest, reconstruction.path);
    const historicalSource = reconstructHistoricalSource({
      currentSource,
      expectedDigest: reconstruction.expectedDigest,
      milestone: `test pre-runtime-text-cache ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    });
    assert.equal(digest(historicalSource), reconstruction.expectedDigest, reconstruction.path);
    assert.throws(
      () => reconstructHistoricalSource({
        currentSource: Buffer.concat([currentSource, Buffer.from('\n')]),
        expectedDigest: reconstruction.expectedDigest,
        milestone: `test drifted pre-runtime-text-cache ${reconstruction.path}`,
        replacements: reconstruction.replacements,
      }),
      /reconstructed bytes must match the archived digest/u,
    );
    const [first, ...rest] = reconstruction.replacements;
    assert.throws(
      () => reconstructHistoricalSource({
        currentSource,
        expectedDigest: reconstruction.expectedDigest,
        milestone: `test replacement drift pre-runtime-text-cache ${reconstruction.path}`,
        replacements: [
          { current: first.current, historical: `${first.historical}\n` },
          ...rest,
        ],
      }),
      /reconstructed bytes must match the archived digest/u,
    );
  }
});

test('runtime text cache type-only owner remains byte-identical after emission', () => {
  const root = resolve(process.cwd(), 'packages/core/dist');
  assert.deepEqual(RUNTIME_TEXT_CACHE_TYPE_ONLY_COMPILED_IDENTITIES, [
    {
      path: 'ir/semantics/internal-effect-machine-types.js',
      digest: '08fd6f79b559c59e699c32b7926d2e21635327afbc625e07f0e11b470e926583',
    },
  ]);
  for (const identity of RUNTIME_TEXT_CACHE_TYPE_ONLY_COMPILED_IDENTITIES) {
    assert.equal(digest(readFileSync(resolve(root, identity.path))), identity.digest, identity.path);
  }
});

test('runtime text cache source owners reconstruct exact M4.97 identities', () => {
  const root = resolve(process.cwd());
  const sourcePaths = new Map([
    [
      'effectMachineSha256',
      'packages/core/src/ir/semantics/internal-effect-machine.ts',
    ],
    [
      'effectMachineTypesSha256',
      'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
    ],
  ]);
  assert.deepEqual(
    POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS.map(({ sourceKey }) => sourceKey),
    [...sourcePaths.keys()],
  );
  for (const reconstruction of POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS) {
    const currentSource = readFileSync(resolve(root, sourcePaths.get(reconstruction.sourceKey)));
    const historicalSource = reconstructCanonicalizerHistoricalRuntimeSource({
      currentSource,
      expectedDigest: reconstruction.expectedDigest,
      milestone: `test historical runtime source ${reconstruction.sourceKey}`,
      sourceKey: reconstruction.sourceKey,
    });
    assert.equal(digest(historicalSource), reconstruction.expectedDigest, reconstruction.sourceKey);
  }
});

test('runtime text cache successor inventory rejects all unclassified path drift', () => {
  const currentPaths = compiledCorePaths();
  for (const paths of [
    [...currentPaths, 'ir/semantics/future-owner.js'],
    currentPaths.filter((path) => path !== CACHE_SUCCESSOR_PATH),
    currentPaths.map((path) => path === CACHE_SUCCESSOR_PATH
      ? 'ir/semantics/renamed-text-cache.js'
      : path),
    [...currentPaths.slice(0, -1), currentPaths[0]],
    [...currentPaths.slice(0, -1), '../escaped.js'],
  ]) {
    assert.throws(
      () => reconstructM4145CompiledCoreJavaScriptPaths(paths),
      /coverage dependency rejection/u,
    );
  }
});

test('current compiled identity is sensitive to the runtime text cache owner', () => {
  const root = resolve(process.cwd(), 'packages/core/dist');
  const bytes = readFileSync(resolve(root, CACHE_SUCCESSOR_PATH));
  assert.notEqual(
    compiledCoreDigest(new Map([[CACHE_SUCCESSOR_PATH, Buffer.concat([bytes, Buffer.from('\n')])]])),
    compiledCoreDigest(),
  );
});

test('runtime text cache transition preserves exact frozen historical identities', () => {
  const currentPaths = compiledCorePaths();
  const traceRetentionOwnershipPaths =
    reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths(currentPaths);
  const traceCompactionPaths =
    reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths(traceRetentionOwnershipPaths);
  assert.equal(traceCompactionPaths.length, 317);
  const historicalPaths = reconstructM4145CompiledCoreJavaScriptPaths(traceCompactionPaths);
  assert.ok(!historicalPaths.includes(CACHE_SUCCESSOR_PATH));
  assert.equal(
    digestM4145CompiledCoreJavaScript(),
    '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
  );
  assert.equal(
    digestPreM4135CompiledCoreJavaScript(),
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  );
});
