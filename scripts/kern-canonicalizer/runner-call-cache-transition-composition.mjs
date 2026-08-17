import {
  POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS,
  POST_RUNNER_CALL_CACHE_SOURCE_RECONSTRUCTIONS,
} from './runner-call-cache-historical-transition.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';

function reconstructRunnerCallCachePredecessor({
  currentSource,
  path,
  reconstructions,
  surface,
}) {
  const reconstruction = reconstructions.find((candidate) => candidate.path === path);
  if (reconstruction === undefined) return currentSource;
  return reconstructHistoricalTransitionChain({
    currentSource,
    expectedTerminalDigest: reconstruction.expectedDigest,
    milestone: `runner-call-cache predecessor ${surface} ${path}`,
    path,
    stages: [historicalTransitionStage(reconstruction)],
  });
}

export function atRunnerCallCacheSourcePredecessor(path, currentSource) {
  return reconstructRunnerCallCachePredecessor({
    currentSource,
    path,
    reconstructions: POST_RUNNER_CALL_CACHE_SOURCE_RECONSTRUCTIONS,
    surface: 'source',
  });
}

export function atRunnerCallCacheCompiledPredecessor(path, currentSource) {
  return reconstructRunnerCallCachePredecessor({
    currentSource,
    path,
    reconstructions: POST_RUNNER_CALL_CACHE_COMPILED_RECONSTRUCTIONS,
    surface: 'compiled',
  });
}
