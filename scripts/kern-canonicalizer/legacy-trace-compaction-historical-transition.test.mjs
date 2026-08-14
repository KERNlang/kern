import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION,
  POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
  POST_LEGACY_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS,
  validateLegacyTraceCompactionHistoricalTransition,
} from './legacy-trace-compaction-historical-transition.mjs';
import {
  POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS,
  POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS,
} from './execution-context-isolation-historical-transition.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';
import {
  POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS,
  POST_TRACE_RETENTION_OWNERSHIP_SOURCE_RECONSTRUCTIONS,
  RESTORED_TRACE_RETENTION_COMPILED,
  RESTORED_TRACE_RETENTION_SOURCE,
} from './trace-retention-ownership-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS,
  POST_TRACE_RETENTION_ROOT_SOURCE_RECONSTRUCTIONS,
} from './trace-retention-root-historical-transition.mjs';

const ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const DIST = resolve(ROOT, 'packages/core/dist');

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
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

test('legacy trace-compaction transition has immutable commit and inventory identity', () => {
  assert.equal(validateLegacyTraceCompactionHistoricalTransition(), true);
  assert.throws(
    () => validateLegacyTraceCompactionHistoricalTransition({
      transition: { ...LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
});

test('every changed source reconstructs the exact 45dd predecessor', () => {
  for (const reconstruction of POST_LEGACY_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS) {
    let current = readFileSync(resolve(ROOT, reconstruction.path));
    const executionContext = POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (executionContext !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: executionContext.expectedDigest,
        milestone: `execution-context source ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(executionContext)],
      });
    }
    const ownership = POST_TRACE_RETENTION_OWNERSHIP_SOURCE_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    const root = POST_TRACE_RETENTION_ROOT_SOURCE_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    const predecessorStages = [];
    if (root !== undefined) predecessorStages.push(stage(root));
    if (ownership !== undefined) predecessorStages.push(stage(ownership));
    const legacySuccessor = predecessorStages.length === 0
      ? current
      : reconstructHistoricalTransitionChain({
          currentSource: current,
          expectedTerminalDigest: ownership?.expectedDigest ?? root.expectedDigest,
          milestone: `trace ownership source ${reconstruction.path}`,
          path: reconstruction.path,
          stages: predecessorStages,
        });
    assert.equal(digest(legacySuccessor), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: legacySuccessor,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `legacy trace source ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
  }
  for (const identity of LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION.addedSourcePaths) {
    assert.equal(digest(RESTORED_TRACE_RETENTION_SOURCE), identity.digest, identity.path);
  }
});

test('every changed compiled endpoint reconstructs the exact 45dd predecessor', () => {
  for (const reconstruction of POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS) {
    let current = readFileSync(resolve(DIST, reconstruction.path));
    const executionContext = POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (executionContext !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: executionContext.expectedDigest,
        milestone: `execution-context compiled ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(executionContext)],
      });
    }
    const ownership = POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    const root = POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    const predecessorStages = [];
    if (root !== undefined) predecessorStages.push(stage(root));
    if (ownership !== undefined) predecessorStages.push(stage(ownership));
    const legacySuccessor = predecessorStages.length === 0
      ? current
      : reconstructHistoricalTransitionChain({
          currentSource: current,
          expectedTerminalDigest: ownership?.expectedDigest ?? root.expectedDigest,
          milestone: `trace ownership compiled ${reconstruction.path}`,
          path: reconstruction.path,
          stages: predecessorStages,
        });
    assert.equal(digest(legacySuccessor), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: legacySuccessor,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `legacy trace compiled ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
  }
  for (const identity of LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION.addedCompiledPaths) {
    assert.equal(digest(RESTORED_TRACE_RETENTION_COMPILED), identity.digest, identity.path);
  }
});
