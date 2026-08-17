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
  reconstructRunnerCallCacheCompiledCoreJavaScriptPaths,
  reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths,
} from './coverage-dependencies.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION,
} from './runtime-text-cache-historical-transition.mjs';
import {
  POST_TEXT_SPLICE_COMPILED_RUNTIME_RECONSTRUCTIONS,
  TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION,
} from './text-splice-historical-transition.mjs';

const TEXT_SPLICE_SUCCESSOR_PATHS = [
  'ir/semantics/internal-effect-machine-deferred-binding.js',
  'ir/semantics/internal-effect-machine-text-splice.js',
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

function textSpliceSuccessorPaths() {
  const runtimeTextCachePaths = new Set(
    RUNTIME_TEXT_CACHE_COMPILED_SUCCESSOR_TRANSITION.addedPaths,
  );
  const traceCompactionPaths =
    reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths(
      reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths(
        reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(compiledCorePaths()),
      ),
    );
  return traceCompactionPaths.filter((path) => !runtimeTextCachePaths.has(path));
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

test('text splice successor transition binds an exact bidirectional inventory delta', () => {
  assert.equal(TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION.commit, '2c030fef');
  assert.deepEqual(TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION.addedPaths, TEXT_SPLICE_SUCCESSOR_PATHS);
  const currentPaths = textSpliceSuccessorPaths();
  const current = TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION.currentInventory;
  assert.equal(currentPaths.length, current.count);
  assert.equal(pathInventoryDigest(currentPaths), current.digest);
  const predecessorPaths = currentPaths.filter((path) => !TEXT_SPLICE_SUCCESSOR_PATHS.includes(path));
  const predecessor = TEXT_SPLICE_COMPILED_SUCCESSOR_TRANSITION.predecessorInventory;
  assert.equal(predecessorPaths.length, predecessor.count);
  assert.equal(pathInventoryDigest(predecessorPaths), predecessor.digest);
});

test('text splice retained runtime modules reconstruct exact clean predecessor bytes', () => {
  const root = resolve(process.cwd(), 'packages/core/dist');
  assert.deepEqual(
    POST_TEXT_SPLICE_COMPILED_RUNTIME_RECONSTRUCTIONS.map(({ path }) => path),
    [
      'ir/semantics/internal-effect-machine-do.js',
      'ir/semantics/internal-effect-machine-leaf.js',
    ],
  );
  for (const reconstruction of POST_TEXT_SPLICE_COMPILED_RUNTIME_RECONSTRUCTIONS) {
    const currentSource = readFileSync(resolve(root, reconstruction.path));
    assert.equal(digest(currentSource), reconstruction.currentDigest, reconstruction.path);
    const historicalSource = reconstructHistoricalSource({
      currentSource,
      expectedDigest: reconstruction.expectedDigest,
      milestone: `test pre-text-splice ${reconstruction.path}`,
      replacements: reconstruction.replacements,
    });
    assert.equal(digest(historicalSource), reconstruction.expectedDigest, reconstruction.path);
    assert.throws(
      () => reconstructHistoricalSource({
        currentSource: Buffer.concat([currentSource, Buffer.from('\n')]),
        expectedDigest: reconstruction.expectedDigest,
        milestone: `test drifted pre-text-splice ${reconstruction.path}`,
        replacements: reconstruction.replacements,
      }),
      /reconstructed bytes must match the archived digest/u,
    );
  }
});

test('text splice successor inventory rejects additions, removals, renames, duplicates, and escapes', () => {
  const currentPaths = compiledCorePaths();
  for (const paths of [
    [...currentPaths, 'ir/semantics/future-owner.js'],
    currentPaths.filter((path) => path !== TEXT_SPLICE_SUCCESSOR_PATHS[0]),
    currentPaths.map((path) => path === TEXT_SPLICE_SUCCESSOR_PATHS[1]
      ? 'ir/semantics/renamed-text-splice.js'
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

test('current compiled identity is sensitive to both text splice successor modules', () => {
  const root = resolve(process.cwd(), 'packages/core/dist');
  const currentDigest = compiledCoreDigest();
  for (const path of TEXT_SPLICE_SUCCESSOR_PATHS) {
    const bytes = readFileSync(resolve(root, path));
    assert.notEqual(
      compiledCoreDigest(new Map([[path, Buffer.concat([bytes, Buffer.from('\n')])]])),
      currentDigest,
      path,
    );
  }
});

test('text splice transition preserves exact M4.145 and pre-M4.135 compiled identities', () => {
  const currentPaths = reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(compiledCorePaths());
  const traceRetentionOwnershipPaths =
    reconstructTraceRetentionOwnershipCompiledCoreJavaScriptPaths(currentPaths);
  const traceCompactionPaths =
    reconstructLegacyTraceCompactionCompiledCoreJavaScriptPaths(traceRetentionOwnershipPaths);
  assert.equal(traceCompactionPaths.length, 317);
  assert.equal(textSpliceSuccessorPaths().length, 316);
  const historicalPaths = reconstructM4145CompiledCoreJavaScriptPaths(traceCompactionPaths);
  const omitted = traceCompactionPaths.filter((path) => !historicalPaths.includes(path));
  for (const path of TEXT_SPLICE_SUCCESSOR_PATHS) assert.ok(omitted.includes(path), path);
  assert.equal(
    digestM4145CompiledCoreJavaScript(),
    '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
  );
  assert.equal(
    digestPreM4135CompiledCoreJavaScript(),
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  );
});
