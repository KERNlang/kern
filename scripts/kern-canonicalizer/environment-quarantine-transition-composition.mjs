import {
  POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS,
  POST_ENVIRONMENT_QUARANTINE_SOURCE_RECONSTRUCTIONS,
} from './environment-quarantine-historical-transition.mjs';
import {
  historicalTransitionStage,
  reconstructHistoricalTransitionChain,
} from './historical-transition-chain.mjs';

function reconstructEnvironmentQuarantinePredecessor({
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
    milestone: `environment quarantine predecessor ${surface} ${path}`,
    path,
    stages: [historicalTransitionStage(reconstruction)],
  });
}

export function atEnvironmentQuarantineSourcePredecessor(path, currentSource) {
  return reconstructEnvironmentQuarantinePredecessor({
    currentSource,
    path,
    reconstructions: POST_ENVIRONMENT_QUARANTINE_SOURCE_RECONSTRUCTIONS,
    surface: 'source',
  });
}

export function atEnvironmentQuarantineCompiledPredecessor(path, currentSource) {
  return reconstructEnvironmentQuarantinePredecessor({
    currentSource,
    path,
    reconstructions: POST_ENVIRONMENT_QUARANTINE_COMPILED_RECONSTRUCTIONS,
    surface: 'compiled',
  });
}
