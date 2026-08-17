import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import { reconstructRunnerCallCacheCompiledCoreJavaScriptPaths } from './coverage-dependencies.mjs';
import {
  historicalTransitionStage,
  indexHistoricalTransitionStages,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';
import {
  POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS,
  POST_EXECUTION_CONTEXT_HARDENING_FORMAT_SOURCE_RECONSTRUCTIONS,
} from './execution-context-hardening-format-historical-transition.mjs';
import {
  POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS,
  POST_EXECUTION_CONTEXT_HARDENING_SOURCE_RECONSTRUCTIONS,
} from './execution-context-hardening-historical-transition.mjs';
import {
  POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS,
  POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS,
} from './execution-context-isolation-historical-transition.mjs';
import {
  LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION,
  POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
  POST_LEGACY_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS,
} from './legacy-trace-compaction-historical-transition.mjs';
import {
  POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS,
  POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS,
} from './runtime-text-cache-historical-transition.mjs';
import {
  atRunnerCallCacheCompiledPredecessor,
  atRunnerCallCacheSourcePredecessor,
} from './runner-call-cache-transition-composition.mjs';
import {
  POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS,
  POST_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS,
  TRACE_COMPACTION_HISTORICAL_TRANSITION,
  TRACE_COMPACTION_TYPE_ONLY_COMPILED_IDENTITIES,
  validateTraceCompactionHistoricalTransition,
} from './trace-compaction-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_OWNERSHIP_COMPILED_RECONSTRUCTIONS,
  POST_TRACE_RETENTION_OWNERSHIP_SOURCE_RECONSTRUCTIONS,
  TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION,
} from './trace-retention-ownership-historical-transition.mjs';
import {
  POST_TRACE_RETENTION_ROOT_COMPILED_RECONSTRUCTIONS,
  POST_TRACE_RETENTION_ROOT_SOURCE_RECONSTRUCTIONS,
} from './trace-retention-root-historical-transition.mjs';

const ROOT = resolve(process.cwd());
const DIST = resolve(ROOT, 'packages/core/dist');

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stage(reconstruction, claim = reconstruction.claim) {
  return historicalTransitionStage({
    claim,
    currentDigest: reconstruction.currentDigest,
    expectedDigest: reconstruction.expectedDigest,
    path: reconstruction.path,
    replacements: reconstruction.replacements,
  });
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

function inventoryDigest(paths) {
  const hash = createHash('sha256');
  for (const path of paths) hash.update(`${path.length}:${path}`);
  return hash.digest('hex');
}

test('trace compaction transition binds immutable commits, claim, paths, and neutral inventory', () => {
  assert.equal(validateTraceCompactionHistoricalTransition(), true);
  assert.equal(TRACE_COMPACTION_HISTORICAL_TRANSITION.claim, 'kern.runtime.trace-compaction.r0');
  const paths = reconstructRunnerCallCacheCompiledCoreJavaScriptPaths(compiledPaths());
  assert.deepEqual(
    { count: paths.length, digest: inventoryDigest(paths) },
    TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION.compiledInventory.successor,
  );
  const ownershipPredecessorPaths = [
    ...paths,
    TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION.restoredCompiledPath.path,
  ].sort();
  assert.deepEqual(
    { count: ownershipPredecessorPaths.length, digest: inventoryDigest(ownershipPredecessorPaths) },
    TRACE_RETENTION_OWNERSHIP_HISTORICAL_TRANSITION.compiledInventory.predecessor,
  );
  const legacyAdded = new Set(
    LEGACY_TRACE_COMPACTION_HISTORICAL_TRANSITION.addedCompiledPaths.map((identity) => identity.path),
  );
  const traceSuccessorPaths = ownershipPredecessorPaths.filter((path) => !legacyAdded.has(path));
  assert.deepEqual(
    { count: traceSuccessorPaths.length, digest: inventoryDigest(traceSuccessorPaths) },
    TRACE_COMPACTION_HISTORICAL_TRANSITION.compiledInventory.successor,
  );
  assert.deepEqual(
    TRACE_COMPACTION_HISTORICAL_TRANSITION.compiledInventory.successor,
    TRACE_COMPACTION_HISTORICAL_TRANSITION.compiledInventory.predecessor,
  );
});

test('every source endpoint matches the pinned successor and predecessor Git blobs', () => {
  const { predecessorCommit, successorCommit } = TRACE_COMPACTION_HISTORICAL_TRANSITION;
  for (const reconstruction of POST_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS) {
    let current = atRunnerCallCacheSourcePredecessor(
      reconstruction.path,
      readFileSync(resolve(ROOT, reconstruction.path)),
    );
    const format = POST_EXECUTION_CONTEXT_HARDENING_FORMAT_SOURCE_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (format !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: format.expectedDigest,
        milestone: `execution-context hardening format source endpoint ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(format)],
      });
    }
    const hardening = POST_EXECUTION_CONTEXT_HARDENING_SOURCE_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (hardening !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: hardening.expectedDigest,
        milestone: `execution-context hardening source endpoint ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(hardening)],
      });
    }
    const executionContext = POST_EXECUTION_CONTEXT_ISOLATION_SOURCE_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (executionContext !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: executionContext.expectedDigest,
        milestone: `execution-context source endpoint ${reconstruction.path}`,
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
    const legacy = POST_LEGACY_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    const predecessorStages = [];
    if (root !== undefined) predecessorStages.push(stage(root));
    if (ownership !== undefined) predecessorStages.push(stage(ownership));
    if (legacy !== undefined) predecessorStages.push(stage(legacy));
    const traceSuccessor = predecessorStages.length === 0
      ? current
      : reconstructHistoricalTransitionChain({
          currentSource: current,
          expectedTerminalDigest: legacy?.expectedDigest ?? ownership?.expectedDigest ?? root.expectedDigest,
          milestone: `trace source endpoint ${reconstruction.path}`,
          path: reconstruction.path,
          stages: predecessorStages,
        });
    const successor = execFileSync('git', ['show', `${successorCommit}:${reconstruction.path}`]);
    const predecessor = execFileSync('git', ['show', `${predecessorCommit}:${reconstruction.path}`]);
    assert.equal(digest(traceSuccessor), reconstruction.currentDigest, reconstruction.path);
    assert.equal(digest(successor), reconstruction.currentDigest, reconstruction.path);
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
    assert.deepEqual(
      reconstructHistoricalTransitionChain({
        currentSource: traceSuccessor,
        expectedTerminalDigest: reconstruction.expectedDigest,
        milestone: `source endpoint ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(reconstruction)],
      }),
      predecessor,
      reconstruction.path,
    );
  }
});

test('clean current build and every reconstructed compiled endpoint match exact identities', () => {
  for (const reconstruction of POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS) {
    let current = atRunnerCallCacheCompiledPredecessor(
      reconstruction.path,
      readFileSync(resolve(DIST, reconstruction.path)),
    );
    const format = POST_EXECUTION_CONTEXT_HARDENING_FORMAT_COMPILED_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (format !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: format.expectedDigest,
        milestone: `execution-context hardening format compiled endpoint ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(format)],
      });
    }
    const hardening = POST_EXECUTION_CONTEXT_HARDENING_COMPILED_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (hardening !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: hardening.expectedDigest,
        milestone: `execution-context hardening compiled endpoint ${reconstruction.path}`,
        path: reconstruction.path,
        stages: [stage(hardening)],
      });
    }
    const executionContext = POST_EXECUTION_CONTEXT_ISOLATION_COMPILED_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    if (executionContext !== undefined) {
      current = reconstructHistoricalTransitionChain({
        currentSource: current,
        expectedTerminalDigest: executionContext.expectedDigest,
        milestone: `execution-context compiled endpoint ${reconstruction.path}`,
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
    const legacy = POST_LEGACY_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS.find(
      (candidate) => candidate.path === reconstruction.path,
    );
    const predecessorStages = [];
    if (root !== undefined) predecessorStages.push(stage(root));
    if (ownership !== undefined) predecessorStages.push(stage(ownership));
    if (legacy !== undefined) predecessorStages.push(stage(legacy));
    const traceSuccessor = predecessorStages.length === 0
      ? current
      : reconstructHistoricalTransitionChain({
          currentSource: current,
          expectedTerminalDigest: legacy?.expectedDigest ?? ownership?.expectedDigest ?? root.expectedDigest,
          milestone: `trace compiled endpoint ${reconstruction.path}`,
          path: reconstruction.path,
          stages: predecessorStages,
        });
    assert.equal(digest(traceSuccessor), reconstruction.currentDigest, reconstruction.path);
    const predecessor = reconstructHistoricalTransitionChain({
      currentSource: traceSuccessor,
      expectedTerminalDigest: reconstruction.expectedDigest,
      milestone: `compiled endpoint ${reconstruction.path}`,
      path: reconstruction.path,
      stages: [stage(reconstruction)],
    });
    assert.equal(digest(predecessor), reconstruction.expectedDigest, reconstruction.path);
  }
  for (const identity of TRACE_COMPACTION_TYPE_ONLY_COMPILED_IDENTITIES) {
    assert.equal(digest(readFileSync(resolve(DIST, identity.path))), identity.digest, identity.path);
  }
});

test('overlapping source and compiled effect-machine chains reach unchanged archived endpoints', () => {
  const sourceTrace = POST_TRACE_COMPACTION_SOURCE_RECONSTRUCTIONS.find(
    (candidate) => candidate.path.endsWith('/internal-effect-machine.ts'),
  );
  const sourceCache = POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS.find(
    (candidate) => candidate.sourceKey === 'effectMachineSha256',
  );
  assert.ok(sourceTrace);
  assert.ok(sourceCache);
  const sourcePath = sourceTrace.path;
  const source = reconstructHistoricalTransitionChain({
    currentSource: readFileSync(resolve(ROOT, sourcePath)),
    expectedTerminalDigest: sourceCache.expectedDigest,
    milestone: 'source overlap',
    path: sourcePath,
    stages: [stage(sourceTrace), stage({ ...sourceCache, path: sourcePath }, 'kern.runtime.text-cache.r0')],
  });
  assert.equal(digest(source), '3de758e08833d0881159f4716710701a605b45a0f56313bb191fabe02666e2eb');

  const compiledTrace = POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === 'ir/semantics/internal-effect-machine.js',
  );
  const compiledCache = POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === compiledTrace?.path,
  );
  assert.ok(compiledTrace);
  assert.ok(compiledCache);
  const compiled = reconstructHistoricalTransitionChain({
    currentSource: readFileSync(resolve(DIST, compiledTrace.path)),
    expectedTerminalDigest: compiledCache.expectedDigest,
    milestone: 'compiled overlap',
    path: compiledTrace.path,
    stages: [stage(compiledTrace), stage(compiledCache, 'kern.runtime.text-cache.r0')],
  });
  assert.equal(digest(compiled), 'b8ea55b9d196b1631712e17e3e09c52c5a91ca5bba6329b7467f6ff11ffbf27f');
});

test('chain rejects wrong order, skipped and duplicate stages, broken anchors, paths, and identity', () => {
  const trace = POST_TRACE_COMPACTION_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === 'ir/semantics/internal-effect-machine.js',
  );
  const cache = POST_RUNTIME_TEXT_CACHE_COMPILED_RECONSTRUCTIONS.find(
    (candidate) => candidate.path === trace?.path,
  );
  assert.ok(trace);
  assert.ok(cache);
  const live = readFileSync(resolve(DIST, trace.path));
  const traceStage = stage(trace);
  const cacheStage = stage(cache, 'kern.runtime.text-cache.r0');
  const attempt = (stages, terminal = cache.expectedDigest) =>
    reconstructHistoricalTransitionChain({
      currentSource: live,
      expectedTerminalDigest: terminal,
      milestone: 'mutation',
      path: trace.path,
      stages,
    });
  assert.throws(() => attempt([cacheStage, traceStage]), /misordered successor edge/u);
  assert.throws(() => attempt([cacheStage]), /misordered successor edge/u);
  assert.throws(() => attempt([traceStage], cache.expectedDigest), /terminal digest/u);
  assert.throws(() => attempt([traceStage, traceStage], trace.expectedDigest), /duplicate claim/u);
  assert.throws(
    () => attempt([{ ...traceStage, path: 'ir/semantics/other.js' }], trace.expectedDigest),
    /path must remain/u,
  );
  assert.throws(
    () => attempt([Object.assign(Object.create({ claim: traceStage.claim }), {
      extraA: 1,
      extraB: 2,
      extraC: 3,
      extraD: 4,
      extraE: 5,
    })], trace.expectedDigest),
    /exact plain transition data/u,
  );
  const [first, ...rest] = traceStage.replacements;
  assert.throws(
    () => attempt([{ ...traceStage, replacements: [{ ...first, historical: `${first.historical}\n` }, ...rest] }], trace.expectedDigest),
    /reconstructed bytes must match/u,
  );
  assert.throws(
    () => indexHistoricalTransitionStages([[traceStage], [traceStage]], 'duplicate producer'),
    /duplicate producer/u,
  );
  assert.throws(
    () => validateTraceCompactionHistoricalTransition({
      transition: { ...TRACE_COMPACTION_HISTORICAL_TRANSITION, successorCommit: '0'.repeat(40) },
    }),
    /immutable identity changed/u,
  );
});
