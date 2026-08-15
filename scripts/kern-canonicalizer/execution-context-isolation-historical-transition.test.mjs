import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS,
} from './execution-context-hardening-format-historical-transition.mjs';
import {
  POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS,
} from './execution-context-hardening-historical-transition.mjs';
import {
  EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION,
  POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS,
  POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS,
  validateExecutionContextIsolationHistoricalTransition,
} from './execution-context-isolation-historical-transition.mjs';
import {
  POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS,
} from './execution-metadata-hardening-historical-transition.mjs';
import {
  atEnvironmentQuarantineCompiledPredecessor,
} from './environment-quarantine-transition-composition.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const DEFINITION_PATH =
  'scripts/kern-canonicalizer/execution-context-isolation-historical-transition.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inventoryDigest(paths) {
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

function atExecutionContextIsolationSuccessor(path, currentSource) {
  const environmentPredecessor = atEnvironmentQuarantineCompiledPredecessor(path, currentSource);
  const metadata = POST_EXECUTION_METADATA_HARDENING_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  const metadataPredecessor = metadata === undefined
    ? environmentPredecessor
    : reconstructHistoricalTransitionChain({
        currentSource: environmentPredecessor,
        expectedTerminalDigest: metadata.expectedDigest,
        milestone: `execution-metadata hardening predecessor compiled ${path}`,
        path,
        stages: [stage(metadata)],
      });
  const format = POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  const hardeningSuccessor = format === undefined
    ? metadataPredecessor
    : reconstructHistoricalTransitionChain({
        currentSource: metadataPredecessor,
        expectedTerminalDigest: format.expectedDigest,
        milestone: `execution-context hardening format predecessor compiled ${path}`,
        path,
        stages: [stage(format)],
      });
  const hardening = POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  if (hardening === undefined) return hardeningSuccessor;
  return reconstructHistoricalTransitionChain({
    currentSource: hardeningSuccessor,
    expectedTerminalDigest: hardening.expectedDigest,
    milestone: `execution-context hardening predecessor compiled ${path}`,
    path,
    stages: [stage(hardening)],
  });
}

test('execution-context isolation transition binds exact commits, manifests, and inventory', () => {
  assert.equal(validateExecutionContextIsolationHistoricalTransition(), true);
  const transition = EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION;
  assert.deepEqual(
    {
      count: POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS.length,
      digest: inventoryDigest(
        POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS.map((row) => row.path),
      ),
    },
    transition.sourceManifest,
  );
  assert.deepEqual(
    {
      count: POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS.length,
      digest: inventoryDigest(
        POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS.map((row) => row.path),
      ),
    },
    transition.compiledManifest,
  );
  const paths = compiledPaths();
  const identity = { count: paths.length, digest: inventoryDigest(paths) };
  assert.deepEqual(identity, transition.compiledInventory.successor);
  assert.deepEqual(identity, transition.compiledInventory.predecessor);
});

test('every source endpoint is pinned to exact predecessor and successor Git blobs', () => {
  const transition = EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION;
  const predecessorRows = [];
  const successorRows = [];
  for (const reconstruction of POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync(
      'git',
      ['show', `${transition.successorCommit}:${reconstruction.path}`],
      { cwd: ROOT },
    );
    const predecessor = execFileSync(
      'git',
      ['show', `${transition.predecessorCommit}:${reconstruction.path}`],
      { cwd: ROOT },
    );
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
    assert.deepEqual(
      reconstructHistoricalTransitionChain({
        currentSource: successor,
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `execution-context source ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(reconstruction)],
      }),
      predecessor,
      reconstruction.path,
    );
    predecessorRows.push([reconstruction.path, predecessor]);
    successorRows.push([reconstruction.path, successor]);
  }
  assert.equal(endpointDigest(predecessorRows), transition.sourceEndpoints.predecessor);
  assert.equal(endpointDigest(successorRows), transition.sourceEndpoints.successor);
});

test('every compiled endpoint reconstructs the authenticated predecessor build', () => {
  const transition = EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION;
  const predecessorRows = [];
  const successorRows = [];
  for (const reconstruction of POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS) {
    const successor = atExecutionContextIsolationSuccessor(
      reconstruction.path,
      readFileSync(resolve(DIST, reconstruction.path)),
    );
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: successor,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `execution-context compiled ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
    predecessorRows.push([reconstruction.path, predecessor]);
    successorRows.push([reconstruction.path, successor]);
  }
  assert.equal(endpointDigest(predecessorRows), transition.compiledEndpoints.predecessor);
  assert.equal(endpointDigest(successorRows), transition.compiledEndpoints.successor);
});

test('transition rejects immutable identity and endpoint drift', () => {
  const transition = EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION;
  assert.throws(
    () => validateExecutionContextIsolationHistoricalTransition({
      transition: { ...transition, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
  const reconstruction = POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS[0];
  const live = atExecutionContextIsolationSuccessor(
    reconstruction.path,
    readFileSync(resolve(DIST, reconstruction.path)),
  );
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: Buffer.concat([live, Buffer.from('\n')]),
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: 'execution-context drift',
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    }),
    /broken or misordered successor edge/u,
  );
});

test('transition definition is committed outside both authenticated endpoints', () => {
  const transition = EXECUTION_CONTEXT_ISOLATION_HISTORICAL_TRANSITION;
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
});

test('transition definition is static data without worktree or HEAD evaluation', () => {
  const source = readFileSync(resolve(ROOT, DEFINITION_PATH), 'utf8');
  assert.doesNotMatch(source, /process\.cwd|git show HEAD|execFileSync|readFileSync/u);
});
