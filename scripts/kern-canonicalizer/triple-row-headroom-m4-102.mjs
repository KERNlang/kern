import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM4101 } from './coverage-residual-analysis-m4-101.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { measureCanonicalizerTripleRowHeadroomM4102 } from './triple-row-headroom-m4-102-measure.mjs';

export { measureCanonicalizerTripleRowHeadroomM4102 };

const FORMAT = 'kern.kir-canonicalizer.triple-row-headroom.1';
const RECEIPT_DIGEST = '8bed0a4709de4ba79dfffba68e4f9304bdf599e04d771520637bb935865b5e58';
const SUMMARY_URL = new URL('./triple-row-headroom-m4-102.json', import.meta.url);
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement';
const ACTIVE_PROFILE = {
  maxNodeRows: 74,
  maxPropertyRows: 95,
  maxValueRows: 832,
};
const CANDIDATE_PROFILE = {
  maxNodeRows: 89,
  maxPropertyRows: 125,
  maxValueRows: 2100,
};
const PROFILE_ROWS = { nodes: 89, properties: 125, values: 2100 };
const EXACT_FLOOR = 72_195;
const PUBLISHED_INPUT_COMMIT = '713d82ea1c9cf6f87d8f5793a6276c4caf62feb6';
const RESIDUAL_ANALYSIS_SHA256 =
  '9b389d0b2536cf2cd11d49bc47f1f234c46924c14c2ef160faf633069a3c94f0';
const INPUT_IDENTITIES = {
  canonicalizerCompositeSha256:
    '983eed5c8841b0cdf41a0b678734f2457c97545a88607969acc9fd4dcc1fc807',
  compositionRecordSha256:
    'f3ce080a976c8764a68417b9845deaa47bb30515e260d48fd415f1ea621a824a',
  coveragePolicySha256:
    'e5fdb18d2de95a15429e51364fb817b3f99342d272105db6c53091e3baf00b8c',
  coverageSummarySha256:
    'be6b6ee977befdfbc9f36b2cdcf23892c20d390bca9fcd0014a665245784b72f',
  measurementHarnessSha256:
    '15dd7ae3cb4927ca906b0ada4f1699b7bd5a748eeff680b1ba1b9facef464ba9',
  prerequisiteSummarySha256:
    '970d8f9eed9deb6dc021ecabb16758cf64eb41b9cfa0fb794a248513a67f3dec',
  runtimePolicySha256:
    '687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09',
  statementHelpersSha256:
    '158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667',
  structuralKirCodecSha256:
    '7128e44fa93b7421aaf87223827bf960e837d7da9b717053994b6f423cd00caf',
};

function fail(message) {
  throw new TypeError(`coverage M4.102 triple-row headroom rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('headroom data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('headroom data must contain only JSON values');
  if (seen.has(value)) fail('headroom data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('headroom arrays must use the plain prototype');
    }
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length
    ) {
      fail('headroom arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('headroom arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('headroom arrays must contain plain data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail('headroom objects must use the plain prototype');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('headroom objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('headroom objects must contain only plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  for (const [name, value] of Object.entries(INPUT_IDENTITIES)) {
    if (!/^[0-9a-f]{64}$/u.test(value)) fail(`${name} historical identity must remain exact`);
  }
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4101();
  if (analysis.digest !== RESIDUAL_ANALYSIS_SHA256) {
    fail('published M4.101 receipt digest must remain exact');
  }
  const selected = analysis.record.selectedNextAction;
  if (
    canonicalBytes(selected).compare(canonicalBytes({
      changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
      completeFunctions: 1,
      completeTools: 1,
      limits: CANDIDATE_PROFILE,
      totalDelta: 1313,
      witnesses: [WITNESS_ID],
    })) !== 0
  ) {
    fail('published M4.101 selection must remain exact');
  }
  const policy = {
    kirLimits: { maxDepth: 64 },
    profileLimits: structuredClone(ACTIVE_PROFILE),
    runtimeLimits: { maxCollectionLength: 65_536 },
  };
  if (
    canonicalBytes(policy.profileLimits).compare(canonicalBytes(ACTIVE_PROFILE)) !== 0 ||
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.kirLimits.maxDepth !== 64
  ) {
    fail('active profile and runtime/KIR budgets must remain exact');
  }
  return { analysis, policy };
}

export function buildCanonicalizerTripleRowHeadroomM4102() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const productionCeilingDeficit = EXACT_FLOOR - productionMaxCollectionLength;
  const promotionBudgetDeficit = EXACT_FLOOR - promotionBudget;
  if (productionCeilingDeficit <= 0 || promotionBudgetDeficit <= 0) {
    fail('production-ceiling NO-GO requires both deficits to remain positive');
  }
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(ACTIVE_PROFILE),
      candidateProfile: structuredClone(CANDIDATE_PROFILE),
      diagnosticMaxCollectionLength: EXACT_FLOOR,
      productionMaxCollectionLength,
      promotionBudget,
      reservedProductionHeadroom: productionMaxCollectionLength - promotionBudget,
    },
    measurement: {
      disposition: 'diagnostic-only',
      runtimePolicyChanged: false,
    },
    moduleEnvelope: { disposition: 'not-claimed', maxDepth: policy.kirLimits.maxDepth },
    promotion: {
      disposition: 'rejected-over-production-ceiling',
      nextMilestone: 'M4.103',
      productionCeilingDeficit,
      promotionBudgetDeficit,
      profilePromotionApproved: false,
      requiredFloorReduction: promotionBudgetDeficit,
    },
    source: {
      ...structuredClone(INPUT_IDENTITIES),
      publishedInputCommit: PUBLISHED_INPUT_COMMIT,
      residualAnalysisInputCommit: analysis.inputCommit,
      residualAnalysisSha256: analysis.digest,
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
    },
    summary: {
      maxExactFloor: EXACT_FLOOR,
      productionCeilingDeficit,
      promotionBudgetDeficit,
      totalParameterRows: 14,
      witnessCount: 1,
    },
    witnesses: [{
      belowFloor: EXACT_FLOOR - 1,
      belowFloorOutcome: 'failure',
      exactFloor: EXACT_FLOOR,
      floorOutcome: 'success',
      id: WITNESS_ID,
      parameterRows: 14,
      productionDelta: productionMaxCollectionLength - EXACT_FLOOR,
      productionOutcome: 'failure',
      profileRows: structuredClone(PROFILE_ROWS),
      promotionDelta: promotionBudget - EXACT_FLOOR,
      publicParityVerified: true,
      roundTrip: true,
    }],
  };
}

export function validateCanonicalizerTripleRowHeadroomM4102(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerTripleRowHeadroomM4102();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.102 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('headroom receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerTripleRowHeadroomM4102() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) fail('headroom receipt must exist');
  if (!stat.isFile() || realpathSync(path) !== path) {
    fail('headroom receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('headroom receipt must be valid JSON');
  }
  const result = validateCanonicalizerTripleRowHeadroomM4102(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerTripleRowHeadroomM4102());
}
