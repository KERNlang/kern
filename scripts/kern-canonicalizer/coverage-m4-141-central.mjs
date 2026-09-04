import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  loadCoveragePolicy,
  measureCanonicalizerCoverage,
  summarizeCanonicalizerCoverage,
} from './coverage.mjs';
import { loadPreExpressionV1RuntimeConstitutionSource } from './coverage-catalog.mjs';
import { digestM4145CompiledCoreJavaScript } from './coverage-dependencies.mjs';
import {
  loadCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import {
  loadPreM4142CoverageInputs,
} from './historical-parameter-sources.mjs';
import {
  loadPreM4142CanonicalizerComposition,
} from './historical-composition.mjs';
import {
  loadCanonicalizerExceptionFlowPrerequisiteProvenance,
} from './coverage-prerequisite-provenance.mjs';
import {
  measureCanonicalizerPrerequisiteForInputs,
} from './coverage-prerequisite-inputs.mjs';
import {
  formatM4141ExceptionFlowPromotionStatus,
} from './coverage-status-m4-141.mjs';
import {
  historicalCanonicalizerPolicyDigest,
  loadPreM4146CanonicalizerPolicy,
} from './historical-policy.mjs';

const publishedCoverageSummaryUrl = new URL(
  './coverage-summary-m4-141.json',
  import.meta.url,
);
const publishedPrerequisiteSummaryUrl = new URL(
  './coverage-prerequisite-summary-m4-141.json',
  import.meta.url,
);
export const M4141_COVERAGE_IMPLEMENTATION_DIGEST =
  '507bae018e1494fe645b5ef762fc6eccf58e02dbbe81e9345f25cc7decb3533e';

function loadPublishedSummary(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

export function assertPublishedM4141ImplementationDigest(
  coverage,
  prerequisite,
) {
  assert.equal(
    coverage?.coverageImplementationDigest,
    M4141_COVERAGE_IMPLEMENTATION_DIGEST,
    'frozen M4.141 coverage must retain its independently pinned implementation digest',
  );
  assert.equal(
    prerequisite?.baseline?.coverageImplementationDigest,
    M4141_COVERAGE_IMPLEMENTATION_DIGEST,
    'frozen M4.141 prerequisite must retain its independently pinned implementation digest',
  );
  return M4141_COVERAGE_IMPLEMENTATION_DIGEST;
}

export function assertM4141ExceptionFlowPromotion(
  coverage,
  prerequisite,
) {
  return formatM4141ExceptionFlowPromotionStatus(
    coverage,
    prerequisite,
    loadCanonicalizerExceptionFlowPrerequisiteProvenance(),
    loadCanonicalizerExceptionFlowImplementationHandoff(),
  );
}

export function loadPublishedM4141ExceptionFlowFrontier() {
  const publishedCoverage = loadPublishedSummary(publishedCoverageSummaryUrl);
  const publishedPrerequisite = loadPublishedSummary(publishedPrerequisiteSummaryUrl);
  assertPublishedM4141ImplementationDigest(publishedCoverage, publishedPrerequisite);
  const historical = loadPreM4142CoverageInputs(loadCoveragePolicy());
  const canonicalizerPolicy = loadPreM4146CanonicalizerPolicy();
  const composition = loadPreM4142CanonicalizerComposition();
  const coverage = measureCanonicalizerCoverage(
    historical.policy,
    canonicalizerPolicy,
    {
      constitutionSource: loadPreExpressionV1RuntimeConstitutionSource(),
      sourceOverrides: historical.sourceOverrides,
    },
  );
  coverage.canonicalizerDigest = composition.digests.canonicalizerCompositeSha256;
  coverage.composition = {
    digest: composition.digests.compositionRecordSha256,
    record: composition.record,
  };
  coverage.coveragePolicyDigest = historical.coveragePolicyDigest;
  coverage.coverageImplementationDigest = M4141_COVERAGE_IMPLEMENTATION_DIGEST;
  coverage.compiledCoreDigest = digestM4145CompiledCoreJavaScript();
  coverage.canonicalizerPolicyDigest = historicalCanonicalizerPolicyDigest(canonicalizerPolicy);
  assert.deepEqual(
    summarizeCanonicalizerCoverage(coverage),
    publishedCoverage,
    'reconstructed M4.141 coverage must exactly match its frozen published summary',
  );
  const prerequisite = measureCanonicalizerPrerequisiteForInputs(
    historical.policy,
    historical.sourceOverrides,
    canonicalizerPolicy,
  );
  prerequisite.baseline.canonicalizerDigest = coverage.canonicalizerDigest;
  prerequisite.baseline.compiledCoreDigest = coverage.compiledCoreDigest;
  prerequisite.baseline.coverageImplementationDigest =
    M4141_COVERAGE_IMPLEMENTATION_DIGEST;
  prerequisite.baseline.coveragePolicyDigest = coverage.coveragePolicyDigest;
  prerequisite.baseline.canonicalizerPolicyDigest = coverage.canonicalizerPolicyDigest;
  assert.deepEqual(
    prerequisite,
    publishedPrerequisite,
    'reconstructed M4.141 prerequisite must exactly match its frozen published summary',
  );
  return { coverage, prerequisite };
}

export function assertPublishedM4141ExceptionFlowPromotion() {
  const { coverage, prerequisite } = loadPublishedM4141ExceptionFlowFrontier();
  return assertM4141ExceptionFlowPromotion(coverage, prerequisite);
}
