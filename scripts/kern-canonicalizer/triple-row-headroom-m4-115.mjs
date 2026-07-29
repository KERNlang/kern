import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { loadPublishedCanonicalizerResidualAnalysisM4114 } from './coverage-residual-analysis-m4-114.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadHistoricalCanonicalizerPolicy } from './historical-policy.mjs';
import { measureCanonicalizerTripleRowHeadroomM4115 } from './triple-row-headroom-m4-115-measure.mjs';

export { measureCanonicalizerTripleRowHeadroomM4115 };

const FORMAT = 'kern.kir-canonicalizer.triple-row-headroom.1';
const RECEIPT_DIGEST = '0142e5d39fc94ec76e2cf793a62a922fa9087a12fb4cd83b9499cfc58f922b9d';
const SUMMARY_URL = new URL('./triple-row-headroom-m4-115.json', import.meta.url);
const WITNESS_ID =
  'examples/capstone-checker-subset/checker.kern#24:checkModule';
const ACTIVE_PROFILE = {
  maxNodeRows: 89,
  maxPropertyRows: 125,
  maxValueRows: 2100,
};
const CANDIDATE_PROFILE = {
  maxNodeRows: 122,
  maxPropertyRows: 193,
  maxValueRows: 2411,
};
const PROFILE_ROWS = { nodes: 122, properties: 193, values: 2411 };
const EXACT_FLOOR = 176_119;
const PUBLISHED_INPUT_COMMIT = '11c05d913809b3ca999fee8155b6be76d6eef361';
const RESIDUAL_ANALYSIS_SHA256 =
  '23fd8f52fa70e2a72fb4b4b1b7ae4c477b369a5f46853691b86b7506a9717e0c';
const INPUT_IDENTITIES = {
  canonicalizerCompositeSha256:
    '75546d8edbf2753fc49aacaf24ab2fa416d7b3d3bd8984b37dd76317691ce88f',
  checkerSourceSha256:
    'f8c9b50d5be28074479bebed4c93e6e6d7f8f15ea9efab54c2b396dcde924d99',
  compositionRecordSha256:
    '18ff4b7116de086ab43a9d501545727ab27a6b99c10f991215d6d07607ed3216',
  coveragePolicySha256:
    '4c75933f4505db9f7bf73daa8a633517e4719ba4c60b15b3dadc59083ef3a4f7',
  coverageSummarySha256:
    '7027b476b0a76324d1a5456c2f0cc9128cc1d012449c1d4a30f1818335f6c864',
  flattenAdapterSha256:
    'ed283c69e34371c592a0ba48ff18581b100cfb98faedcc4dfdc50383db253c2f',
  measurementHarnessSha256:
    'a2686430ed13626e8678cf1efa074c7795c341c673cabd463447f7422261df0d',
  prerequisiteSummarySha256:
    'faa55d5859d68f110eb388f9bb933e116d647382b706b64ad7d377f7cb470749',
  runtimeHandlerSha256:
    'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  runtimePolicySha256:
    '919726462eabc002cb072cd8004fffe7f3e731ed430574dd608788580ca1f163',
  structuralKirCodecSha256:
    '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};

function fail(message) {
  throw new TypeError(`coverage M4.115 triple-row headroom rejection: ${message}`);
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
    if (!/^[0-9a-f]{64}$/u.test(value)) fail(`${name} input identity must remain exact`);
  }
  const analysis = loadPublishedCanonicalizerResidualAnalysisM4114();
  if (analysis.digest !== RESIDUAL_ANALYSIS_SHA256) {
    fail('published M4.114 receipt digest must remain exact');
  }
  if (!canonicalBytes(analysis.record.selectedNextAction).equals(canonicalBytes({
    changedLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    limits: CANDIDATE_PROFILE,
    totalDelta: 412,
    witnesses: [WITNESS_ID],
  }))) {
    fail('published M4.114 selection must remain exact');
  }
  const policy = loadHistoricalCanonicalizerPolicy({
    expectedDigest: INPUT_IDENTITIES.runtimePolicySha256,
    kirLimitOverrides: {
      maxBytes: 262_144,
      maxDepth: 76,
      maxNodes: 4_096,
    },
    milestone: 'M4.115',
    profileLimits: ACTIVE_PROFILE,
    runtimeLimitOverrides: {
      maxBytes: 2_097_152,
      maxStringBytes: 1_048_576,
    },
  });
  if (
    !canonicalBytes(policy.profileLimits).equals(canonicalBytes(ACTIVE_PROFILE)) ||
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.kirLimits.maxDepth !== 76 ||
    policy.runtimeLimits.maxDepth !== 64
  ) {
    fail('active profile and runtime/KIR budgets must remain exact');
  }
  return { analysis, policy };
}

export function buildCanonicalizerTripleRowHeadroomM4115() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const productionCeilingDeficit = EXACT_FLOOR - productionMaxCollectionLength;
  const promotionBudgetDeficit = EXACT_FLOOR - promotionBudget;
  if (productionCeilingDeficit !== 110_583 || promotionBudgetDeficit !== 126_967) {
    fail('production and promotion deficits must remain exact');
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
      nextMilestone: 'M4.116',
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
      runtimeHandlerAbi: KERN_RUNTIME_HANDLER_ABI,
    },
    summary: {
      maxExactFloor: EXACT_FLOOR,
      productionCeilingDeficit,
      promotionBudgetDeficit,
      totalArtifactBytes: 149_053,
      totalParameterRows: 58,
      witnessCount: 1,
    },
    witnesses: [{
      artifactBytes: 149_053,
      belowFloor: EXACT_FLOOR - 1,
      belowFloorOutcome: 'failure',
      exactFloor: EXACT_FLOOR,
      floorOutcome: 'success',
      id: WITNESS_ID,
      parameterRows: 58,
      productionDelta: productionMaxCollectionLength - EXACT_FLOOR,
      productionOutcome: 'failure',
      profileRows: structuredClone(PROFILE_ROWS),
      promotionDelta: promotionBudget - EXACT_FLOOR,
      publicParityVerified: true,
      roundTrip: true,
    }],
  };
}

export function validateCanonicalizerTripleRowHeadroomM4115(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerTripleRowHeadroomM4115();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.115 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('headroom receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerTripleRowHeadroomM4115() {
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
  const result = validateCanonicalizerTripleRowHeadroomM4115(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerTripleRowHeadroomM4115());
}
