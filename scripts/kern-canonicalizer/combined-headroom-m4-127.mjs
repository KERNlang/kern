import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import {
  PRE_M4129_COMPOSITE_MEASUREMENT_REPLACEMENTS,
} from './assignment-target-projection-target.mjs';
import {
  PRE_M4130_M4127_MEASUREMENT_REPLACEMENTS,
} from './combined-promotion-target.mjs';
import {
  canonicalCompositionRecordBytes,
} from './composition.mjs';
import { digestCompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import {
  loadPreM4129CanonicalizerComposition,
} from './historical-composition.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4126,
} from './projection-analysis-m4-126.mjs';
import {
  PRE_M4131_M4127_MEASUREMENT_REPLACEMENTS,
} from './validate-parameter-migration-target.mjs';

const FORMAT = 'kern.kir-canonicalizer.combined-headroom.1';
const RECEIPT_DIGEST =
  '604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce';
const SUMMARY_URL = new URL('./combined-headroom-m4-127.json', import.meta.url);
const PROJECTION_ANALYSIS_DIGEST =
  '25f1ba6ed40efdff909a6c95a11c385c12f9eba2b0025375ed4943f14393e369';
const PUBLISHED_INPUT_COMMIT =
  '04e8f943ee070b4fc0b1d2ceb063adc53ecc5f06';
const WITNESS_ID =
  'examples/selfhost-validator/validator.kern#20:validate';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 262_144,
  maxDepth: 77,
  maxNodes: 4_096,
};
const CANDIDATE_KIR_LIMITS = {
  maxBytes: 273_051,
  maxDepth: 98,
  maxNodes: 5_313,
};
const ACTIVE_PROFILE = {
  maxNodeRows: 122,
  maxPropertyRows: 193,
  maxValueRows: 2_411,
};
const CANDIDATE_PROFILE = {
  maxNodeRows: 202,
  maxPropertyRows: 308,
  maxValueRows: 4_493,
};
const EXACT_FLOOR = 54_894;
const INPUT_IDENTITIES = {
  canonicalizerCompositeSha256:
    'f40d056b2aac947350f297196cbe71d5acdb5b82d245963adee910620c7b7180',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    'a98f58589b8e0d8006970aa5e530b393e8f3cd247bea1e86f922b98a89d5649e',
  flattenAdapterSha256:
    'ed283c69e34371c592a0ba48ff18581b100cfb98faedcc4dfdc50383db253c2f',
  measurementHarnessSha256:
    '9ef514c5d482c2b4735c3591f1c08bfb65b11a51480fde1c427451beb0db9318',
  policySha256:
    'c1b4f5b8e28eb4c0bb8a7fa0ef0a7dff64a4dd4cc952a5594d9ac95502e349a5',
  runtimeHandlerSha256:
    'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  structuralKirCodecSha256:
    '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const INPUT_URLS = {
  flattenAdapterSha256: new URL('./flatten.mjs', import.meta.url),
  measurementHarnessSha256:
    new URL('./combined-headroom-m4-127-measure.mjs', import.meta.url),
  policySha256: new URL('./policy.json', import.meta.url),
  runtimeHandlerSha256:
    new URL('../../packages/core/src/runtime-handler.ts', import.meta.url),
  structuralKirCodecSha256:
    new URL('../../packages/core/src/kir-structural/canonical.ts', import.meta.url),
};

function fail(message) {
  throw new TypeError(`coverage M4.127 combined headroom rejection: ${message}`);
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
    if (!Number.isFinite(value)) fail('receipt data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('receipt data must contain only JSON values');
  if (seen.has(value)) fail('receipt data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('receipt arrays must use the plain prototype');
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key === 'symbol') ||
      keys.length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    ) fail('receipt arrays must be dense and undecorated');
    for (const [index, key] of Object.keys(value).entries()) {
      if (key !== String(index)) fail('receipt arrays must contain canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt arrays must contain plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail('receipt objects must use the plain prototype');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('receipt objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('receipt objects must contain only plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4126();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.126 receipt digest must remain exact');
  }
  if (!canonicalBytes(analysis.record.selectedNextAction).equals(canonicalBytes({
    changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
    changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: CANDIDATE_KIR_LIMITS,
    migratedParameterRows: 41,
    profileLimits: CANDIDATE_PROFILE,
    totalDelta: 14_422,
    witnesses: [WITNESS_ID],
  }))) fail('published M4.126 selection must remain exact');
  for (const [name, expected] of Object.entries(INPUT_IDENTITIES)) {
    if (!/^[0-9a-f]{64}$/u.test(expected)) fail(`${name} identity must remain exact`);
    if (name === 'policySha256') continue;
    const url = INPUT_URLS[name];
    let source = url === undefined ? undefined : readFileSync(url);
    if (name === 'measurementHarnessSha256') {
      source = reconstructHistoricalSource({
        currentSource: source,
        expectedDigest: expected,
        milestone: 'M4.127 measurement',
        replacements: [
          ...PRE_M4129_COMPOSITE_MEASUREMENT_REPLACEMENTS,
          ...PRE_M4130_M4127_MEASUREMENT_REPLACEMENTS,
          ...PRE_M4131_M4127_MEASUREMENT_REPLACEMENTS,
        ],
      });
    }
    if (source !== undefined && digest(source) !== expected) {
      fail(`${name} source identity must remain exact`);
    }
  }
  if (digestCompiledCoreJavaScript() !== INPUT_IDENTITIES.compiledCoreJavaScriptSha256) {
    fail('compiled core JavaScript executed by measurement must remain exact');
  }
  const composition = loadPreM4129CanonicalizerComposition();
  if (
    digest(composition.composite) !==
      INPUT_IDENTITIES.canonicalizerCompositeSha256 ||
    digest(canonicalCompositionRecordBytes(composition.record)) !==
      INPUT_IDENTITIES.compositionRecordSha256
  ) fail('canonicalizer composition identities must remain exact');
  const livePolicy = loadCanonicalizerPolicy();
  if (
    !canonicalBytes({
      maxBytes: livePolicy.kirLimits.maxBytes,
      maxDepth: livePolicy.kirLimits.maxDepth,
      maxNodes: livePolicy.kirLimits.maxNodes,
    }).equals(canonicalBytes(CANDIDATE_KIR_LIMITS)) ||
    !canonicalBytes(livePolicy.profileLimits).equals(canonicalBytes(CANDIDATE_PROFILE)) ||
    livePolicy.runtimeLimits.maxBytes !== 2_184_408 ||
    livePolicy.runtimeLimits.maxCollectionLength !== 65_536 ||
    livePolicy.runtimeLimits.maxDepth !== 64 ||
    livePolicy.runtimeLimits.maxStringBytes !== 1_092_204
  ) fail('promoted KIR, profile, and runtime policy must remain exact');
  const policy = loadPreM4130CanonicalizerPolicy();
  if (digest(canonicalBytes(policy)) !== INPUT_IDENTITIES.policySha256) {
    fail('historical policy identity must remain exact');
  }
  return { analysis, policy };
}

export function buildCanonicalizerCombinedHeadroomM4127() {
  const { analysis, policy } = exactInputs();
  const productionBudget = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionBudget * 3 / 4);
  const productionHeadroom = productionBudget - EXACT_FLOOR;
  const promotionBudgetDeficit = EXACT_FLOOR - promotionBudget;
  if (productionHeadroom !== 10_642 || promotionBudgetDeficit !== 5_742) {
    fail('measured production headroom and promotion deficit must remain exact');
  }
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      activeKir: structuredClone(ACTIVE_KIR_LIMITS),
      activeProfile: structuredClone(ACTIVE_PROFILE),
      candidateKir: structuredClone(CANDIDATE_KIR_LIMITS),
      candidateProfile: structuredClone(CANDIDATE_PROFILE),
      productionBudget,
      promotionBudget,
      reservedProductionHeadroom: productionBudget - promotionBudget,
      runtimeMaxDepth: policy.runtimeLimits.maxDepth,
    },
    measurement: {
      disposition: 'authenticated-evidence-only',
      kirPolicyChanged: false,
      profilePolicyChanged: false,
      runtimePolicyChanged: false,
    },
    promotion: {
      combinedPromotionApproved: false,
      disposition: 'production-headroom-authenticated-promotion-budget-no-go',
      nextMilestone: 'M4.128',
      productionHeadroom,
      promotionBudgetDeficit,
      requiredFloorReduction: promotionBudgetDeficit,
    },
    source: {
      ...structuredClone(INPUT_IDENTITIES),
      projectionAnalysisInputCommit: analysis.inputCommit,
      projectionAnalysisSha256: analysis.digest,
      publishedInputCommit: PUBLISHED_INPUT_COMMIT,
      runtimeHandlerAbi: KERN_RUNTIME_HANDLER_ABI,
    },
    structuralBoundary: {
      candidateKir: structuredClone(CANDIDATE_KIR_LIMITS),
      candidateOutcome: 'success',
      rejectedLimits: [
        { code: 'limit-bytes', limit: 273_050, name: 'maxBytes' },
        { code: 'limit-depth', limit: 97, name: 'maxDepth' },
        { code: 'limit-nodes', limit: 5_312, name: 'maxNodes' },
      ],
    },
    summary: {
      maxExactFloor: EXACT_FLOOR,
      minimumProductionHeadroom: productionHeadroom,
      minimumPromotionHeadroom: -promotionBudgetDeficit,
      totalArtifactBytes: 273_051,
      totalParameterRows: 41,
      witnessCount: 1,
    },
    witnesses: [{
      artifactBytes: 273_051,
      belowFloor: EXACT_FLOOR - 1,
      belowFloorOutcome: 'failure',
      exactFloor: EXACT_FLOOR,
      floorOutcome: 'success',
      id: WITNESS_ID,
      parameterRows: 41,
      productionDelta: productionHeadroom,
      profileRows: { nodes: 202, properties: 308, values: 4_493 },
      promotionDelta: -promotionBudgetDeficit,
      publicParityVerified: true,
      roundTrip: true,
    }],
  };
}

export function validateCanonicalizerCombinedHeadroomM4127(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerCombinedHeadroomM4127();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.127 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerCombinedHeadroomM4127() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    fail('receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('receipt must be valid JSON');
  }
  const result = validateCanonicalizerCombinedHeadroomM4127(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerCombinedHeadroomM4127());
}
