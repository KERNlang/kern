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
  POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS,
} from './execution-context-hardening-historical-transition.mjs';
import {
  POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS,
} from './execution-context-isolation-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS,
  POST_TRACE_RETENTION_OWNERSHIP_SOURCE_RECONSTRUCTIONS,
  RESTORED_TRACE_RETENTION_COMPILED,
  RESTORED_TRACE_RETENTION_SOURCE,
  TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION,
  validateTraceRetentionOwnershipHistoricalTransition,
} from './trace-retention-ownership-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS,
} from './trace-retention-root-historical-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');

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

test('trace-retention ownership transition binds exact commits, restored path, and reverse inventory', () => {
  assert.equal(validateTraceRetentionOwnershipHistoricalTransition(), true);
  const transition = TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION;
  const current = compiledPaths();
  assert.deepEqual(
    { count: current.length, digest: inventoryDigest(current) },
    transition.compiledInventory.successor,
  );
  assert.ok(!current.includes(transition.restoredCompiledPath.path));
  const predecessor = [...current, transition.restoredCompiledPath.path].sort();
  assert.deepEqual(
    { count: predecessor.length, digest: inventoryDigest(predecessor) },
    transition.compiledInventory.predecessor,
  );
  assert.equal(digest(RESTORED_TRACE_RETENTION_SOURCE), transition.restoredSourcePath.digest);
  assert.equal(digest(RESTORED_TRACE_RETENTION_COMPILED), transition.restoredCompiledPath.digest);
});

test('every source endpoint reconstructs exact 36d0 bytes and deleted helper content', () => {
  const { predecessorCommit, successorCommit } = TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION;
  for (const reconstruction of POST_TRACE_RETENTION_OWNERSHIP_SOURCE_RECONSTRUCTIONS) {
    const successor = execFileSync('git', ['show', `${successorCommit}:${reconstruction.path}`]);
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    assert.equal(
      digest(execFileSync('git', ['show', `${successorCommit}:${reconstruction.path}`])),
      reconstruction.currentDigest,
      reconstruction.path,
    );
    const predecessor = execFileSync('git', ['show', `${predecessorCommit}:${reconstruction.path}`]);
    assert.deepEqual(
      reconstructHistoricalTransitionChain({
        currentSource: successor,
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `trace ownership source ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(reconstruction)],
      }),
      predecessor,
      reconstruction.path,
    );
  }
  assert.deepEqual(
    RESTORED_TRACE_RETENTION_SOURCE,
    execFileSync('git', [
      'show',
      `${predecessorCommit}:${TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION.restoredSourcePath.path}`,
    ]),
  );
});

test('every compiled endpoint reconstructs the authenticated 36d0 digest', () => {
  const executionHardeningByPath = new Map(
    POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS.map((row) => [row.path, row]),
  );
  const executionContextByPath = new Map(
    POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS.map((row) => [row.path, row]),
  );
  const rootByPath = new Map(
    POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS.map((row) => [row.path, row]),
  );
  for (const reconstruction of POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS) {
    let current = readFileSync(resolve(DIST, reconstruction.path));
    const hardening = executionHardeningByPath.get(reconstruction.path);
    if (hardening !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: hardening.expectedDigest,
        milestone: `execution-context hardening ownership composition ${hardening.path}`,
        path: hardening.path,
        stages: [stage(hardening)],
      });
    }
    const executionContext = executionContextByPath.get(reconstruction.path);
    if (executionContext !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: executionContext.expectedDigest,
        milestone: `execution-context ownership composition ${executionContext.path}`,
        path: executionContext.path,
        stages: [stage(executionContext)],
      });
    }
    const root = rootByPath.get(reconstruction.path);
    if (root !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: root.expectedDigest,
        milestone: `trace root ownership composition ${root.path}`,
        path: root.path,
        stages: [stage(root)],
      });
    }
    assert.equal(digest(current), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: current,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `trace ownership compiled ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
  }
});

test('trace-retention ownership transition rejects immutable identity and endpoint drift', () => {
  const transition = TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION;
  assert.throws(
    () => validateTraceRetentionOwnershipHistoricalTransition({
      transition: { ...transition, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
  const reconstruction = POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS[0];
  const live = readFileSync(resolve(DIST, reconstruction.path));
  assert.throws(
    () => reconstructHistoricalTransitionChain({
      currentSource: Buffer.concat([live, Buffer.from('\n')]),
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: 'trace ownership drift',
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    }),
    /broken or misordered successor edge/u,
  );
});
