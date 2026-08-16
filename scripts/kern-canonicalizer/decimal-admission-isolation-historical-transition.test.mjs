import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  DECIMAL_ADMISSION_ISOLATION_HISTORICAL_TRANSITION,
  POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS,
  POST_DECIMAL_ADMISSION_ISOLATION_SOURCE_RECONSTRUCTIONS,
  validateDecimalAdmissionIsolationHistoricalTransition,
} from './decimal-admission-isolation-historical-transition.mjs';
import { historicalTransitionStage, reconstructHistoricalTransitionChain } from './historical-transition-chain.mjs';
import { atScalarHelperHistoryCompiledPredecessor } from './scalar-helper-history-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const DEFINITION_PATH = 'scripts/kern-canonicalizer/decimal-admission-isolation-historical-transition.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function pathDigest(paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(`${path.length}:${path}`);
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

test('decimal-admission isolation binds exact commits, manifests, and unchanged inventory', () => {
  assert.equal(validateDecimalAdmissionIsolationHistoricalTransition(), true);
  const transition = DECIMAL_ADMISSION_ISOLATION_HISTORICAL_TRANSITION;
  assert.deepEqual(
    {
      count: POST_DECIMAL_ADMISSION_ISOLATION_SOURCE_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_DECIMAL_ADMISSION_ISOLATION_SOURCE_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.sourceManifest,
  );
  assert.deepEqual(
    {
      count: POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS.length,
      digest: pathDigest(POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS.map((row) => row.path)),
    },
    transition.compiledManifest,
  );
  const identity = { count: compiledPaths().length, digest: pathDigest(compiledPaths()) };
  assert.deepEqual(identity, transition.compiledInventory.successor);
  assert.deepEqual(identity, transition.compiledInventory.predecessor);
});

test('decimal-admission pinned source endpoints reconstruct exact Git blobs', () => {
  const transition = DECIMAL_ADMISSION_ISOLATION_HISTORICAL_TRANSITION;
  for (const row of POST_DECIMAL_ADMISSION_ISOLATION_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync('git', ['show', `${transition.successorCommit}:${row.path}`]);
    const predecessor = execFileSync('git', ['show', `${transition.predecessorCommit}:${row.path}`]);
    assert.equal(digest(successor), row.currentDigest, row.path);
    assert.deepEqual(
      reconstructHistoricalTransitionChain({
        currentSource: successor,
        expectedTerminalDigest: row.expectedDigest,
        milestone: `decimal-admission source ${row.path}`,
        path: row.path,
        stages: [stage(row)],
      }),
      predecessor,
      row.path,
    );
  }
});

test('decimal-admission compiled endpoints reconstruct the authenticated predecessor build', () => {
  for (const row of POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS) {
    const successor = atScalarHelperHistoryCompiledPredecessor(
      row.path,
      readFileSync(resolve(DIST, row.path)),
    );
    assert.equal(digest(successor), row.currentDigest, row.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: successor,
      expectedTerminalDigest: row.expectedDigest,
      milestone: `decimal-admission compiled ${row.path}`,
      path: row.path,
      stages: [stage(row)],
    });
    assert.equal(digest(predecessor), row.expectedDigest, row.path);
  }
});

test('decimal-admission transition rejects drift and is defined outside both endpoints', () => {
  const transition = DECIMAL_ADMISSION_ISOLATION_HISTORICAL_TRANSITION;
  assert.throws(
    () => validateDecimalAdmissionIsolationHistoricalTransition({
      transition: { ...transition, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
  const row = POST_DECIMAL_ADMISSION_ISOLATION_COMPILED_RECONSTRUCTIONS[0];
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: Buffer.concat([readFileSync(resolve(DIST, row.path)), Buffer.from('\n')]),
      expectedTerminalDigest: row.expectedDigest,
      milestone: 'decimal-admission drift',
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
