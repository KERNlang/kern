import {
  authenticateCoverageDependencies,
  verifyAuthenticatedCoverageDependencies,
} from './coverage-dependencies.mjs';

const authenticated = authenticateCoverageDependencies();
const implementation = await import('./coverage-implementation.mjs');
verifyAuthenticatedCoverageDependencies(authenticated);

export const {
  assertCoverageClosed,
  collectCanonicalExpressionKinds,
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  readCorpusMemberBytes,
  selectCanonicalizerTranche,
  summarizeCanonicalizerCoverage,
  validateCoveragePolicy,
} = implementation;
