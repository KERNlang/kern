import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';
import {
  POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS,
} from './execution-context-hardening-format-historical-transition.mjs';
import {
  POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS,
} from './execution-context-hardening-historical-transition.mjs';
import {
  POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS,
} from './execution-context-isolation-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS,
  POST_TRACE_RETENTION_ROOT_SOURCE_RECONSTRUCTIONS,
  TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION,
  validateTraceRetentionRootHistoricalTransition,
} from './trace-retention-root-historical-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');
const DEFINITION_PATH =
  'scripts/kern-canonicalizer/trace-retention-root-historical-transition.mjs';

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function inventoryDigest(paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) hash.update(`${path.length}:${path}`);
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

function atTraceRetentionRootSuccessor(path, currentSource) {
  const format = POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  const hardeningSuccessor = format === undefined
    ? currentSource
    : reconstructHistoricalTransitionChain({
        currentSource,
        expectedTerminalDigest: format.expectedDigest,
        milestone: `execution-context hardening format predecessor compiled ${path}`,
        path,
        stages: [stage(format)],
      });
  const hardening = POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  const isolationSuccessor = hardening === undefined
    ? hardeningSuccessor
    : reconstructHistoricalTransitionChain({
        currentSource: hardeningSuccessor,
        expectedTerminalDigest: hardening.expectedDigest,
        milestone: `execution-context hardening predecessor compiled ${path}`,
        path,
        stages: [stage(hardening)],
      });
  const executionContext = POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === path,
  );
  if (executionContext === undefined) return isolationSuccessor;
  return reconstructHistoricalTransitionChain({
    currentSource: isolationSuccessor,
    expectedTerminalDigest: executionContext.expectedDigest,
    milestone: `execution-context predecessor compiled ${path}`,
    path,
    stages: [stage(executionContext)],
  });
}

test('trace-retention root transition binds exact commits and unchanged compiled inventory', () => {
  assert.equal(validateTraceRetentionRootHistoricalTransition(), true);
  const transition = TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION;
  const paths = compiledPaths();
  const identity = { count: paths.length, digest: inventoryDigest(paths) };
  assert.deepEqual(identity, transition.compiledInventory.successor);
  assert.deepEqual(identity, transition.compiledInventory.predecessor);
});

test('every source endpoint reconstructs exact 0df8834f bytes from b3d3f5fc', () => {
  const { predecessorCommit, successorCommit } = TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION;
  for (const reconstruction of POST_TRACE_RETENTION_ROOT_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync('git', ['show', `${successorCommit}:${reconstruction.path}`]);
    const predecessor = execFileSync('git', ['show', `${predecessorCommit}:${reconstruction.path}`]);
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    assert.deepEqual(
      reconstructHistoricalTransitionChain({
        currentSource: successor,
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `trace root source ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(reconstruction)],
      }),
      predecessor,
      reconstruction.path,
    );
  }
});

test('every compiled endpoint reconstructs the authenticated 0df8834f build digest', () => {
  for (const reconstruction of POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS) {
    const current = atTraceRetentionRootSuccessor(
      reconstruction.path,
      readFileSync(resolve(DIST, reconstruction.path)),
    );
    assert.equal(digest(current), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: current,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `trace root compiled ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
  }
});

test('transition data rejects immutable identity and endpoint drift', () => {
  const transition = TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION;
  assert.throws(
    () => validateTraceRetentionRootHistoricalTransition({
      transition: { ...transition, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
  const reconstruction = POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS[0];
  const current = atTraceRetentionRootSuccessor(
    reconstruction.path,
    readFileSync(resolve(DIST, reconstruction.path)),
  );
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: Buffer.concat([current, Buffer.from('\n')]),
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: 'trace root drift',
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    }),
    /broken or misordered successor edge/u,
  );
});

test('transition definition is committed outside both authenticated endpoints', () => {
  const containingCommit = execFileSync(
    'git',
    ['log', '--diff-filter=A', '--format=%H', '-1', '--', DEFINITION_PATH],
    { cwd: ROOT, encoding: 'utf8' },
  ).trim();
  assert.match(containingCommit, /^[0-9a-f]{40}$/u);
  assert.notEqual(containingCommit, TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION.successorCommit);
  assert.notEqual(containingCommit, TRACE_RETENTION_ROOT_HISTORICAL_TRANSITION.predecessorCommit);
});
