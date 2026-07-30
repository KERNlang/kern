import { readFileSync } from 'node:fs';

import { validateCoverageBase } from './coverage-base-profile.mjs';
import {
  validateCanonicalizerExceptionFlowImplementationHandoff,
} from './coverage-implementation-handoff.mjs';
import {
  validateCanonicalizerExceptionFlowPrerequisiteHandoff,
} from './coverage-prerequisite-provenance.mjs';
import {
  validateCanonicalizerPrerequisiteSummaryStructure,
} from './coverage-prerequisite-structure.mjs';
import {
  canonicalizerPrerequisiteFrontierDigest,
} from './coverage-prerequisite-shape.mjs';
import { summarizeCoverageReceipt } from './coverage-summary.mjs';

const PREREQUISITE_DIGEST =
  '2c36f8d7ec2e91cba6742241e72c79adacc917ad59e3105aabdf15f7e9e712e4';
const IMPLEMENTATION_DIGEST =
  'c9f9d4610800ca53cdec00f5d519d6c1ebaa3e76d26734ebcc69cb3c21ff7753';
const REASON_ASSIGNMENTS_DIGEST =
  '1da9a57ec132a8147f75ab0d252e188aa86b2744b23d58cf3dfa3510b7bcc106';
const PREREQUISITE_FRONTIER_DIGEST =
  '83e01e1dad9db811f7beb370c522457076c563ba3291fb22fe23cf60bd163f19';
const BASELINE_DIGEST_KEYS = [
  'canonicalizerDigest',
  'canonicalizerPolicyDigest',
  'compiledCoreDigest',
  'corpusDigest',
  'coverageImplementationDigest',
  'coveragePolicyDigest',
  'familyRegistryDigest',
  'functionFactsDigest',
  'profileDigest',
];
const REASON_COUNTS = [
  { count: 1, id: 'if.properties.cond.expression.text.character-u007f' },
  { count: 1, id: 'if.properties.cond.expression.text.character-u0080' },
  { count: 1, id: 'if.properties.cond.expression.text.character-u009f' },
  { count: 1, id: 'if.properties.cond.expression.text.character-u2028' },
  { count: 1, id: 'if.properties.cond.expression.text.character-u2029' },
  { count: 1, id: 'if.properties.cond.expression.text.character-ufeff' },
  { count: 1, id: 'projection.limit-nodes' },
];
const PROMOTION = {
  family: 'exception-flow',
  provenanceDigest: PREREQUISITE_DIGEST,
  provenanceKind: 'prerequisite',
};
const PARAMETER_MIGRATION = {
  completeFunctions: 1,
  completeTools: 1,
  migratedParameterRows: 15,
  witnesses: [{
    id: 'examples/kern-canonicalizer/canonicalizer.kern#5:canonicalize',
    parameterRows: 15,
    profileRows: { nodes: 100, properties: 159, values: 2556 },
    tool: 'canonicalizer',
  }],
};
const COVERAGE_SUMMARY_URL = new URL('./coverage-summary-m4-141.json', import.meta.url);
function fail(cause) {
  throw new TypeError(
    'M4.141 must promote the exact authorized exception-flow frontier',
    cause === undefined ? undefined : { cause },
  );
}

function checkedCoverageSummary() {
  const summary = JSON.parse(readFileSync(COVERAGE_SUMMARY_URL, 'utf8'));
  if (
    typeof summary?.coverageImplementationDigest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(summary.coverageImplementationDigest)
  ) fail();
  return summary;
}

export function m4141ParameterMigration() {
  return structuredClone(PARAMETER_MIGRATION);
}

export function formatM4141ExceptionFlowPromotionStatus(
  coverage,
  prerequisite,
  prerequisiteHandoff,
  implementationHandoff,
) {
  let validatedPrerequisite;
  let validatedImplementation;
  let authenticatedCoverageSummary;
  let liveCoverageSummary;
  try {
    validatedPrerequisite = validateCanonicalizerExceptionFlowPrerequisiteHandoff(
      prerequisiteHandoff?.record,
    );
    validatedImplementation = validateCanonicalizerExceptionFlowImplementationHandoff(
      implementationHandoff?.record,
    );
    validateCoverageBase(coverage?.base);
    validateCanonicalizerPrerequisiteSummaryStructure(prerequisite);
    authenticatedCoverageSummary = checkedCoverageSummary();
    liveCoverageSummary = summarizeCoverageReceipt(coverage);
  } catch (cause) {
    fail(cause);
  }
  const base = coverage?.base;
  if (
    prerequisiteHandoff?.digest !== validatedPrerequisite.digest ||
    validatedPrerequisite.digest !== PREREQUISITE_DIGEST ||
    implementationHandoff?.digest !== validatedImplementation.digest ||
    validatedImplementation.digest !== IMPLEMENTATION_DIGEST ||
    validatedImplementation.record.prerequisite.digest !== validatedPrerequisite.digest ||
    validatedImplementation.record.prerequisite.family !== 'exception-flow' ||
    coverage.canonicalizerDigest !== validatedImplementation.record.source.canonicalizerSha256 ||
    JSON.stringify(liveCoverageSummary) !== JSON.stringify(authenticatedCoverageSummary) ||
    canonicalizerPrerequisiteFrontierDigest(prerequisite) !== PREREQUISITE_FRONTIER_DIGEST ||
    base?.id !== 'kern.kir-canonicalizer.profile.m4.141' ||
    coverage.baseCompleteFunctions !== 109 ||
    coverage.functions?.length !== 112 ||
    !base.nodeKinds?.includes('throw') ||
    !base.propertyKeys?.includes('throw.value') ||
    JSON.stringify(base.promotions?.at(-1)) !== JSON.stringify(PROMOTION) ||
    JSON.stringify(coverage.implementationProvenance) !== JSON.stringify(PROMOTION) ||
    JSON.stringify(coverage.selection) !== JSON.stringify({ ranking: [], winner: null }) ||
    prerequisite?.baseline?.baseId !== base.id ||
    BASELINE_DIGEST_KEYS.some((key) => prerequisite.baseline[key] !== coverage[key]) ||
    prerequisite.baseline.baseCompleteFunctions !== 109 ||
    prerequisite.baseline.functionCount !== 112 ||
    prerequisite.baseline.toolCount !== authenticatedCoverageSummary.toolCount ||
    prerequisite.baseline.legacyParameterBlockers !== 3 ||
    prerequisite.outcome !== 'bounded-exhaustion' ||
    prerequisite.minimumFamilyCount !== null ||
    prerequisite.selectedPrerequisite !== null ||
    prerequisite.prerequisiteRanking?.length !== 0 ||
    prerequisite.ranking?.length !== 0 ||
    JSON.stringify(prerequisite.parameterMigration) !== JSON.stringify(PARAMETER_MIGRATION) ||
    JSON.stringify(prerequisite.exhaustion?.activeFamilies) !== '[]' ||
    prerequisite.exhaustion.completingClosureCount !== 0 ||
    prerequisite.exhaustion.evaluatedNonEmptyClosureCount !== 0 ||
    prerequisite.exhaustion.residualFunctionCount !== 2 ||
    prerequisite.exhaustion.reasonAssignmentsDigest !== REASON_ASSIGNMENTS_DIGEST ||
    JSON.stringify(prerequisite.exhaustion.reasonCounts) !== JSON.stringify(REASON_COUNTS) ||
    prerequisite.exhaustion.scope !== 'current-bounded-profile'
  ) {
    fail();
  }
  return 'M4.141 promotes exception-flow through the exact M4.138 prerequisite and M4.140 ' +
    'implementation handoff; the cumulative base remains 109/112 and exposes the exact ' +
    '1-function/15-row canonicalize parameter queue; the structural-family frontier is ' +
    'exhausted and M4.142 owns queue consumption.';
}
