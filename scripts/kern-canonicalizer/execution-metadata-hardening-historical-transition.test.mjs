import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  EXECUTION_METADATA_HARDENING_HISTORICAL_TRANSITION,
  POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS,
  POST_EXECUTION_METADATA_HARDENING_SOURCE_RECONSTRUCTIONS,
  validateExecutionMetadataHardeningHistoricalTransition,
} from './execution-metadata-hardening-historical-transition.mjs';
import {
  POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS,
  POST_DECIMAL_ADMISSION_ISOLATION_SOURCE_RECONSTRUCTIONS,
} from './decimal-admission-isolation-historical-transition.mjs';
import { historicalTransitionStage, reconstructHistoricalTransitionChain } from './historical-transition-chain.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const DEFINITION_PATH = 'scripts/kern-canonicalizer/execution-metadata-hardening-historical-transition.mjs';

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
    else if (entry.isFile() && entry.name.endsWith('.js')) output.push(relative(DIST, path).split(sep).join('/'));
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

function atMetadataSuccessor(path, currentSource, reconstructions) {
  const decimalAdmission = reconstructions.find((candidate) => candidate.path === path);
  if (decimalAdmission === undefined) return currentSource;
  return reconstructHistoricalTransitionChain({
    currentSource,
    expectedTerminalDigest: decimalAdmission.expectedDigest,
    milestone: `decimal-admission isolation predecessor ${path}`,
    path,
    stages: [stage(decimalAdmission)],
  });
}

test('execution-metadata hardening binds exact commits, manifests, and unchanged inventory', () => {
  assert.equal(validateExecutionMetadataHardeningHistoricalTransition(), true);
  const transition = EXECUTION_METADATA_HARDENING_HISTORICAL_TRANSITION;
  assert.deepEqual(
    {
      count: POST_EXECUTION_METADATA_HARDENING_SOURCE_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_EXECUTION_METADATA_HARDENING_SOURCE_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.sourceManifest,
  );
  assert.deepEqual(
    {
      count: POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.compiledManifest,
  );
  const identity = { count: compiledPaths().length, digest: pathDigest(compiledPaths()) };
  assert.deepEqual(identity, transition.compiledInventory.successor);
  assert.deepEqual(identity, transition.compiledInventory.predecessor);
});

test('execution-metadata source endpoints reconstruct exact pinned Git blobs', () => {
  const transition = EXECUTION_METADATA_HARDENING_HISTORICAL_TRANSITION;
  const predecessors = [];
  const successors = [];
  for (const reconstruction of POST_EXECUTION_METADATA_HARDENING_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync('git', ['show', `${transition.successorCommit}:${reconstruction.path}`]);
    const predecessor = execFileSync('git', ['show', `${transition.predecessorCommit}:${reconstruction.path}`]);
    assert.deepEqual(
      atMetadataSuccessor(
        reconstruction.path,
        readFileSync(resolve(ROOT, reconstruction.path)),
        POST_DECIMAL_ADMISSION_ISOLATION_SOURCE_RECONSTRUCTIONS,
      ),
      successor,
      reconstruction.path,
    );
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    assert.deepEqual(
      reconstructHistoricalTransitionChain({
        currentSource: successor,
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `execution-metadata hardening source ${reconstruction.path}`,
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

test('execution-metadata compiled endpoints reconstruct the authenticated predecessor build', () => {
  const transition = EXECUTION_METADATA_HARDENING_HISTORICAL_TRANSITION;
  const predecessors = [];
  const successors = [];
  for (const reconstruction of POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS) {
    const successor = atMetadataSuccessor(
      reconstruction.path,
      readFileSync(resolve(DIST, reconstruction.path)),
      POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS,
    );
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: successor,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `execution-metadata hardening compiled ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    predecessors.push([reconstruction.path, predecessor]);
    successors.push([reconstruction.path, successor]);
  }
  assert.equal(endpointDigest(predecessors), transition.compiledEndpoints.predecessor);
  assert.equal(endpointDigest(successors), transition.compiledEndpoints.successor);
});

test('execution-metadata transition rejects identity drift and is defined outside both endpoints', () => {
  const transition = EXECUTION_METADATA_HARDENING_HISTORICAL_TRANSITION;
  assert.throws(
    () => validateExecutionMetadataHardeningHistoricalTransition({
      transition: { ...transition, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
  const reconstruction = POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS[0];
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: Buffer.concat([readFileSync(resolve(DIST, reconstruction.path)), Buffer.from('\n')]),
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: 'execution-metadata hardening drift',
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    }),
    /broken or misordered successor edge/u,
  );
  const containingCommit = execFileSync('git', ['log', '--diff-filter=A', '--format=%H', '-1', '--', DEFINITION_PATH], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  assert.match(containingCommit, /^[0-9a-f]{40}$/u);
  assert.notEqual(containingCommit, transition.successorCommit);
  assert.notEqual(containingCommit, transition.predecessorCommit);
  assert.throws(() => execFileSync('git', ['cat-file', '-e', `${transition.successorCommit}:${DEFINITION_PATH}`], {
    cwd: ROOT,
    stdio: 'ignore',
  }));
  assert.doesNotMatch(readFileSync(resolve(ROOT, DEFINITION_PATH), 'utf8'), /process\.cwd|git show HEAD|execFileSync|readFileSync/u);
});
