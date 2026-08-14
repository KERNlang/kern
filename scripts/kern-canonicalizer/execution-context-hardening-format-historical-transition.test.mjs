import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  EXECUTION_CONTEXT_HARDENING_FORMAT_HISTORICAL_TRANSITION,
  POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS,
  POST_EXECUTION_CONTEXT_HARDENING_FORMAT_SOURCE_RECONSTRUCTIONS,
  validateExecutionContextHardeningFormatHistoricalTransition,
} from './execution-context-hardening-format-historical-transition.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const DEFINITION_PATH =
  'scripts/kern-canonicalizer/execution-context-hardening-format-historical-transition.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pathDigest(paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(`${path.length}:${path}`);
  return hash.digest('hex');
}

function endpointDigest(rows) {
  const hash = createHash('sha256');
  for (const [path, bytes] of [...rows].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${path.length}:${path}:${bytes.length}:`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function compiledPaths(directory = DIST, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) compiledPaths(path, output);
    else if (entry.isFile() && entry.name.endsWith('.js')) {
      output.push(relative(DIST, path).split(sep).join('/'));
    }
  }
  return output.sort();
}

function stage(reconstruction) {
  return historicalTransitionStage({
    claim: reconstruction.claim,
    currentDigest: reconstruction.currentDigest,
    expectedDigest: reconstruction.expectedDigest,
    path: reconstruction.path,
    replacements: reconstruction.replacements,
  });
}

test('format transition binds exact commits, manifests, and unchanged compiled inventory', () => {
  assert.equal(validateExecutionContextHardeningFormatHistoricalTransition(), true);
  const transition = EXECUTION_CONTEXT_HARDENING_FORMAT_HISTORICAL_TRANSITION;
  assert.deepEqual(
    {
      count: POST_EXECUTION_CONTEXT_HARDENING_FORMAT_SOURCE_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_EXECUTION_CONTEXT_HARDENING_FORMAT_SOURCE_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.sourceManifest,
  );
  assert.deepEqual(
    {
      count: POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.compiledManifest,
  );
  const identity = { count: compiledPaths().length, digest: pathDigest(compiledPaths()) };
  assert.deepEqual(identity, transition.compiledInventory.successor);
  assert.deepEqual(identity, transition.compiledInventory.predecessor);
});

test('format source endpoints reconstruct exact pinned Git blobs', () => {
  const transition = EXECUTION_CONTEXT_HARDENING_FORMAT_HISTORICAL_TRANSITION;
  const predecessors = [];
  const successors = [];
  for (const reconstruction of POST_EXECUTION_CONTEXT_HARDENING_FORMAT_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync('git', ['show', `${transition.successorCommit}:${reconstruction.path}`]);
    const predecessor = execFileSync('git', ['show', `${transition.predecessorCommit}:${reconstruction.path}`]);
    assert.deepEqual(readFileSync(resolve(ROOT, reconstruction.path)), successor, reconstruction.path);
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    assert.deepEqual(
      reconstructHistoricalTransitionChain({
        currentSource: successor,
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `execution-context hardening format source ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(reconstruction)],
      }),
      predecessor,
      reconstruction.path,
    );
    predecessors.push([reconstruction.path, predecessor]);
    successors.push([reconstruction.path, successor]);
  }
  assert.equal(endpointDigest(predecessors), transition.sourceEndpoints.predecessor);
  assert.equal(endpointDigest(successors), transition.sourceEndpoints.successor);
});

test('format compiled endpoints reconstruct the authenticated predecessor build', () => {
  const transition = EXECUTION_CONTEXT_HARDENING_FORMAT_HISTORICAL_TRANSITION;
  const predecessors = [];
  const successors = [];
  for (const reconstruction of POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS) {
    const successor = readFileSync(resolve(DIST, reconstruction.path));
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: successor,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `execution-context hardening format compiled ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    predecessors.push([reconstruction.path, predecessor]);
    successors.push([reconstruction.path, successor]);
  }
  assert.equal(endpointDigest(predecessors), transition.compiledEndpoints.predecessor);
  assert.equal(endpointDigest(successors), transition.compiledEndpoints.successor);
});

test('format transition rejects identity drift and is defined outside both endpoints', () => {
  const transition = EXECUTION_CONTEXT_HARDENING_FORMAT_HISTORICAL_TRANSITION;
  assert.throws(
    () => validateExecutionContextHardeningFormatHistoricalTransition({
      transition: { ...transition, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
  const reconstruction = POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS[0];
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: Buffer.concat([readFileSync(resolve(DIST, reconstruction.path)), Buffer.from('\n')]),
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: 'execution-context hardening format drift',
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    }),
    /broken or misordered successor edge/u,
  );
  const containingCommit = execFileSync(
    'git',
    ['log', '--diff-filter=A', '--format=%H', '-1', '--', DEFINITION_PATH],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  assert.match(containingCommit, /^[0-9a-f]{40}$/u);
  assert.notEqual(containingCommit, transition.successorCommit);
  assert.notEqual(containingCommit, transition.predecessorCommit);
  assert.throws(
    () => execFileSync('git', ['cat-file', '-e', `${transition.successorCommit}:${DEFINITION_PATH}`], {
      cwd: ROOT,
      stdio: 'ignore',
    }),
  );
  const definition = readFileSync(resolve(ROOT, DEFINITION_PATH), 'utf8');
  assert.doesNotMatch(definition, /process\.cwd|git show HEAD|execFileSync|readFileSync/u);
});
