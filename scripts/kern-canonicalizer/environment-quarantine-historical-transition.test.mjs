import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  ENVIRONMENT_QUARANTINE_HISTORICAL_TRANSITION,
  POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS,
  POST_ENVIRONMENT_QUARANTINE_SOURCE_RECONSTRUCTIONS,
  validateEnvironmentQuarantineHistoricalTransition,
} from './environment-quarantine-historical-transition.mjs';
import { historicalTransitionStage, reconstructHistoricalTransitionChain } from './historical-transition-chain.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const DEFINITION_PATH = 'scripts/kern-canonicalizer/environment-quarantine-historical-transition.mjs';

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
  for (const row of rows) {
    hash.update(`${row.path.length}:${row.path}:${row.bytes.length}:`);
    hash.update(row.bytes);
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

function stage(row) {
  return historicalTransitionStage(row);
}

test('environment quarantine binds exact commits, manifests, and unchanged inventory', () => {
  assert.equal(validateEnvironmentQuarantineHistoricalTransition(), true);
  const transition = ENVIRONMENT_QUARANTINE_HISTORICAL_TRANSITION;
  assert.deepEqual(
    {
      count: POST_ENVIRONMENT_QUARANTINE_SOURCE_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_ENVIRONMENT_QUARANTINE_SOURCE_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.sourceManifest,
  );
  assert.deepEqual(
    {
      count: POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.compiledManifest,
  );
  const identity = { count: compiledPaths().length, digest: pathDigest(compiledPaths()) };
  assert.deepEqual(identity, transition.compiledInventory.successor);
  assert.deepEqual(identity, transition.compiledInventory.predecessor);
});

test('environment quarantine source endpoints reconstruct exact pinned Git blobs', () => {
  const transition = ENVIRONMENT_QUARANTINE_HISTORICAL_TRANSITION;
  const predecessorRows = [];
  const successorRows = [];
  for (const row of POST_ENVIRONMENT_QUARANTINE_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync('git', ['show', `${transition.successorCommit}:${row.path}`]);
    const predecessor = execFileSync('git', ['show', `${transition.predecessorCommit}:${row.path}`]);
    assert.deepEqual(readFileSync(resolve(ROOT, row.path)), successor, row.path);
    assert.equal(digest(successor), row.currentDigest, row.path);
    const reconstructed = reconstructHistoricalTransitionChain({
      currentSource: successor,
      expectedTerminalDigest: row.expectedDigest,
      milestone: `environment quarantine source ${row.path}`,
      path: row.path,
      stages: [stage(row)],
    });
    assert.deepEqual(reconstructed, predecessor, row.path);
    predecessorRows.push({ bytes: predecessor, path: row.path });
    successorRows.push({ bytes: successor, path: row.path });
  }
  assert.equal(endpointDigest(predecessorRows), transition.sourceEndpoints.predecessor);
  assert.equal(endpointDigest(successorRows), transition.sourceEndpoints.successor);
});

test('environment quarantine compiled endpoints reconstruct the authenticated predecessor build', () => {
  const transition = ENVIRONMENT_QUARANTINE_HISTORICAL_TRANSITION;
  const predecessorRows = [];
  const successorRows = [];
  for (const row of POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS) {
    const successor = readFileSync(resolve(DIST, row.path));
    assert.equal(digest(successor), row.currentDigest, row.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: successor,
      expectedTerminalDigest: row.expectedDigest,
      milestone: `environment quarantine compiled ${row.path}`,
      path: row.path,
      stages: [stage(row)],
    });
    predecessorRows.push({ bytes: predecessor, path: row.path });
    successorRows.push({ bytes: successor, path: row.path });
  }
  assert.equal(endpointDigest(predecessorRows), transition.compiledEndpoints.predecessor);
  assert.equal(endpointDigest(successorRows), transition.compiledEndpoints.successor);
});

test('environment quarantine rejects drift and is defined outside both endpoints', () => {
  const transition = ENVIRONMENT_QUARANTINE_HISTORICAL_TRANSITION;
  assert.throws(
    () => validateEnvironmentQuarantineHistoricalTransition({
      transition: { ...transition, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
  const row = POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS[0];
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: Buffer.concat([readFileSync(resolve(DIST, row.path)), Buffer.from('\n')]),
      expectedTerminalDigest: row.expectedDigest,
      milestone: 'environment quarantine drift',
      path: row.path,
      stages: [stage(row)],
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
  assert.doesNotMatch(readFileSync(resolve(ROOT, DEFINITION_PATH), 'utf8'), /process\.cwd|git show HEAD|execFileSync|readFileSync/u);
});
