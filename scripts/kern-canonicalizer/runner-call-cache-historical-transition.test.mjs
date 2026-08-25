import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  digestM4145CompiledCoreJavaScript,
  digestPreM4135CompiledCoreJavaScript,
  reconstructRunnerCallCacheCompiledCoreJavaScriptPaths,
} from './coverage-dependencies.mjs';
import { historicalTransitionStage, reconstructHistoricalTransitionChain } from './historical-transition-chain.mjs';
import {
  POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS,
  POST_RUNNER_CALL_CACHE_SOURCE_RECONSTRUCTIONS,
  RUNNER_CALL_CACHE_HISTORICAL_TRANSITION,
  RUNNER_CALL_CACHE_TYPE_ONLY_COMPILED_IDENTITIES,
  validateRunnerCallCacheHistoricalTransition,
} from './runner-call-cache-historical-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const endpointDigest = (rows) => {
  const hash = createHash('sha256');
  for (const row of rows) {
    hash.update(`${row.path.length}:${row.path}:${row.bytes.length}:`);
    hash.update(row.bytes);
  }
  return hash.digest('hex');
};
const pathDigest = (paths) => {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(`${path.length}:${path}`);
  return hash.digest('hex');
};
function compiledPaths(directory = DIST, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compiledPaths(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(relative(DIST, path).split(sep).join('/'));
  }
  return output.sort();
}
const reconstruct = (row, bytes) => reconstructHistoricalTransitionChain({
  currentSource: bytes,
  expectedTerminalDigest: row.expectedDigest,
  milestone: `runner-call-cache ${row.path}`,
  path: row.path,
  stages: [historicalTransitionStage(row)],
});

test('runner-call-cache binds exact commits, manifests, endpoints, and 318-to-317 inventory', () => {
  assert.equal(validateRunnerCallCacheHistoricalTransition(), true);
  const transition = RUNNER_CALL_CACHE_HISTORICAL_TRANSITION;
  assert.equal(transition.predecessorCommit, '5e3bebd283a43e916b014d1406f025bd5bc14bb6');
  assert.equal(transition.successorCommit, '6f92fe7a316f42bed9b74bdddff1f13bc20f08ae');
  assert.deepEqual({ count: POST_RUNNER_CALL_CACHE_SOURCE_RECONSTRUCTIONS.length, digest: pathDigest(POST_RUNNER_CALL_CACHE_SOURCE_RECONSTRUCTIONS.map(({ path }) => path)) }, transition.sourceManifest);
  assert.deepEqual({ count: POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS.length, digest: pathDigest(POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS.map(({ path }) => path)) }, transition.compiledManifest);
  const paths = compiledPaths();
  const predecessor = reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(paths);
  assert.deepEqual({ count: predecessor.length, digest: pathDigest(predecessor) }, transition.compiledInventory.predecessor);
  assert.ok(!predecessor.includes(transition.addedCompiled.path));
});

test('authenticated transition evidence is recursively frozen', () => {
  const transition = RUNNER_CALL_CACHE_HISTORICAL_TRANSITION;
  for (const evidence of [
    transition,
    transition.sourceManifest,
    transition.compiledManifest,
    transition.sourceEndpoints,
    transition.compiledEndpoints,
    transition.compiledInventory,
    transition.compiledInventory.predecessor,
    transition.compiledInventory.successor,
    transition.addedSource,
    transition.addedCompiled,
  ]) {
    assert.equal(Object.isFrozen(evidence), true);
  }
});

test('source and compiled retained owners reconstruct exact pinned endpoints', () => {
  const transition = RUNNER_CALL_CACHE_HISTORICAL_TRANSITION;
  const sourcePredecessors = [];
  const sourceSuccessors = [];
  for (const row of POST_RUNNER_CALL_CACHE_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync('git', ['show', `${transition.successorCommit}:${row.path}`]);
    const predecessor = execFileSync('git', ['show', `${transition.predecessorCommit}:${row.path}`]);
    assert.equal(sha(successor), row.currentDigest, row.path);
    assert.deepEqual(reconstruct(row, successor), predecessor, row.path);
    sourcePredecessors.push({ path: row.path, bytes: predecessor });
    sourceSuccessors.push({ path: row.path, bytes: successor });
  }
  assert.equal(endpointDigest(sourcePredecessors), transition.sourceEndpoints.predecessor);
  assert.equal(endpointDigest(sourceSuccessors), transition.sourceEndpoints.successor);
  const compiledPredecessors = [];
  const compiledSuccessors = [];
  for (const row of POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS) {
    const successor = readFileSync(resolve(DIST, row.path));
    assert.equal(sha(successor), row.currentDigest, row.path);
    compiledPredecessors.push({ path: row.path, bytes: reconstruct(row, successor) });
    compiledSuccessors.push({ path: row.path, bytes: successor });
  }
  assert.equal(endpointDigest(compiledPredecessors), transition.compiledEndpoints.predecessor);
  assert.equal(endpointDigest(compiledSuccessors), transition.compiledEndpoints.successor);
});

test('added module and type-only emitted owners retain their authenticated identities', () => {
  const transition = RUNNER_CALL_CACHE_HISTORICAL_TRANSITION;
  const addedSource = execFileSync('git', ['show', `${transition.successorCommit}:${transition.addedSource.path}`]);
  assert.equal(sha(addedSource), transition.addedSource.digest);
  assert.equal(sha(readFileSync(resolve(DIST, transition.addedCompiled.path))), transition.addedCompiled.digest);
  for (const identity of RUNNER_CALL_CACHE_TYPE_ONLY_COMPILED_IDENTITIES) {
    assert.equal(sha(readFileSync(resolve(DIST, identity.path))), identity.digest, identity.path);
  }
});

test('inventory projection rejects additions, removals, renames, duplicates, and path escapes', () => {
  const paths = compiledPaths();
  const cases = [
    [...paths, 'unexpected.js'],
    paths.slice(1),
    paths.map((path, index) => index === 0 ? 'renamed.js' : path),
    [...paths, paths[0]],
    [...paths.slice(1), '../escape.js'],
  ];
  for (const candidate of cases) assert.throws(() => reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(candidate), /coverage dependency rejection/u);
});

test('validator and reconstruction reject mutated retained and added identities', () => {
  const row = POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS[0];
  assert.throws(() => reconstruct(row, Buffer.concat([readFileSync(resolve(DIST, row.path)), Buffer.from('\n')])), /broken or misordered successor edge/u);
  assert.throws(() => validateRunnerCallCacheHistoricalTransition({ transition: { ...RUNNER_CALL_CACHE_HISTORICAL_TRANSITION, addedCompiled: { ...RUNNER_CALL_CACHE_HISTORICAL_TRANSITION.addedCompiled, digest: '0'.repeat(64) } } }), /immutable identity changed/u);
  const mutatedRows = POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS.map((candidate, index) => index === 0 ? { ...candidate, replacements: [{ ...candidate.replacements[0], historical: `${candidate.replacements[0].historical}\n` }] } : candidate);
  assert.throws(() => validateRunnerCallCacheHistoricalTransition({ compiledReconstructions: mutatedRows }), /immutable identity changed/u);
});

test('frozen historical digests remain unchanged', () => {
  assert.equal(digestM4145CompiledCoreJavaScript(), '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2');
  assert.equal(digestPreM4135CompiledCoreJavaScript(), '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec');
});

test('runtime transition data performs no live Git, process, or filesystem lookup', () => {
  const definition = readFileSync(resolve(ROOT, 'scripts/kern-canonicalizer/runner-call-cache-historical-transition.mjs'), 'utf8');
  assert.doesNotMatch(definition, /node:fs|node:child_process|execFileSync|readFileSync|process\.cwd|git show/u);
});
