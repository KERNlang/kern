import { createHash } from 'node:crypto';

import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';
import {
  POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS,
} from './runtime-text-cache-historical-transition.mjs';
import { traceCompactionSourceReconstruction } from './trace-compaction-historical-transition.mjs';
import { traceRetentionRootSourceReconstruction } from './trace-retention-root-historical-transition.mjs';

const RUNTIME_TEXT_CACHE_CLAIM = 'kern.runtime.text-cache.r0';
const SOURCE_PATHS = Object.freeze({
  classFrameSha256: 'packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
  effectMachineSha256: 'packages/core/src/ir/semantics/internal-effect-machine.ts',
  effectMachineTypesSha256: 'packages/core/src/ir/semantics/internal-effect-machine-types.ts',
  helperRuntimeSha256: 'packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
  sequenceSha256: 'packages/core/src/ir/semantics/internal-effect-machine-sequence.ts',
});

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stage(reconstruction, claim, path) {
  return historicalTransitionStage({
    claim,
    currentDigest: reconstruction.currentDigest,
    expectedDigest: reconstruction.expectedDigest,
    path,
    replacements: reconstruction.replacements,
  });
}

export function reconstructCanonicalizerHistoricalRuntimeSource({
  currentSource,
  expectedDigest,
  milestone,
  sourceKey,
}) {
  const path = SOURCE_PATHS[sourceKey];
  const traceRoot = path === undefined ? undefined : traceRetentionRootSourceReconstruction(path);
  const trace = traceCompactionSourceReconstruction(sourceKey);
  const cache = POST_RUNTIME_TEXT_CACHE_SOURCE_RECONSTRUCTIONS.find(
    (candidate) => candidate.sourceKey === sourceKey,
  );
  const stages = [];
  if (traceRoot !== undefined) stages.push(stage(traceRoot, traceRoot.claim, traceRoot.path));
  if (trace !== undefined) stages.push(stage(trace, trace.claim, trace.path));
  if (cache !== undefined) stages.push(stage(cache, RUNTIME_TEXT_CACHE_CLAIM, path));
  if (stages.length === 0) {
    if (digest(currentSource) !== expectedDigest) {
      throw new TypeError(`${milestone} historical runtime source identity changed`);
    }
    return Buffer.from(currentSource);
  }
  return reconstructHistoricalTransitionChain({
    currentSource,
    expectedTerminalDigest: expectedDigest,
    milestone,
    path,
    stages,
  });
}
