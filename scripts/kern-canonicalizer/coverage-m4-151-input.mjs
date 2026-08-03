import { readFileSync } from 'node:fs';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
} from './coverage.mjs';
import {
  buildCanonicalizerPrerequisiteSummary,
} from './coverage-prerequisite.mjs';
import { loadPreM4151CanonicalizerComposition } from './historical-composition.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  PRE_M4151_COVERAGE_POLICY_DIGEST,
  QUOTESOURCE_M4151_PATH,
  reconstructPreM4151CoverageInputs,
} from './quotesource-parameter-m4-151-target.mjs';

const POLICY_URL = new URL('./coverage-policy.json', import.meta.url);

export function measureM4150FrontierForM4151() {
  const currentPolicy = loadCoveragePolicy();
  const historical = reconstructPreM4151CoverageInputs(
    currentPolicy,
    readFileSync(POLICY_URL),
  );
  const canonicalizerPolicy = loadCanonicalizerPolicy();
  const sourceOverrides = new Map([[QUOTESOURCE_M4151_PATH, historical.expressionHelpers]]);
  const coverage = measureCanonicalizerCoverage(
    historical.policy,
    canonicalizerPolicy,
    { sourceOverrides },
  );
  const composition = loadPreM4151CanonicalizerComposition();
  coverage.canonicalizerDigest = composition.digests.canonicalizerCompositeSha256;
  coverage.composition = {
    digest: composition.digests.compositionRecordSha256,
    record: composition.record,
  };
  coverage.coveragePolicyDigest = PRE_M4151_COVERAGE_POLICY_DIGEST;
  const prerequisite = buildCanonicalizerPrerequisiteSummary(
    historical.policy,
    sourceOverrides,
    canonicalizerPolicy,
    'kern.kir-canonicalizer.prerequisite-summary.3',
  );
  prerequisite.baseline.canonicalizerDigest = coverage.canonicalizerDigest;
  prerequisite.baseline.coveragePolicyDigest = coverage.coveragePolicyDigest;
  return { coverage, prerequisite };
}
