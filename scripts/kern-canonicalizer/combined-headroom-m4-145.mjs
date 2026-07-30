import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import {
  loadPreM4147CanonicalizerComposition,
} from './historical-composition.mjs';
import {
  PRE_M4146_M4145_MEASUREMENT_REPLACEMENTS,
} from './combined-promotion-target.mjs';
import { digestCompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { assertExactPlainData } from './coverage-prerequisite-shape.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadPreM4146CanonicalizerPolicy } from './historical-policy.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import {
  loadPublishedCanonicalizerProjectionAnalysisM4144,
} from './projection-analysis-m4-144.mjs';

const FORMAT = 'kern.kir-canonicalizer.combined-headroom.2';
const RECEIPT_DIGEST =
  'e61beda6a311742d0475fdcd52ab0147cffe74300c1ee339ea79acceb3f147ba';
const SUMMARY_URL = new URL('./combined-headroom-m4-145.json', import.meta.url);
const PROJECTION_ANALYSIS_DIGEST =
  '0aa57f2721cd76c9fed61ab5aaf22deccb868277e3627587712c92c907a6b086';
const PUBLISHED_INPUT_COMMIT =
  '7273d51ee0c61785251aaf13106f6b6556720990';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer.kern#3:expressionsources';
const ACTIVE_KIR_LIMITS = {
  maxBytes: 273_051,
  maxDepth: 98,
  maxNodes: 5_313,
};
const CANDIDATE_KIR_LIMITS = {
  maxBytes: 367_368,
  maxDepth: 122,
  maxNodes: 7_136,
};
const ACTIVE_PROFILE = {
  maxNodeRows: 202,
  maxPropertyRows: 308,
  maxValueRows: 4_493,
};
const CANDIDATE_PROFILE = {
  maxNodeRows: 205,
  maxPropertyRows: 332,
  maxValueRows: 6_304,
};
const DERIVED_RUNTIME_BYTES = {
  maxBytes: 2_938_944,
  maxStringBytes: 1_469_472,
};
const EXACT_FLOOR = 43_054;
const INPUT_IDENTITIES = {
  canonicalizerCompositeSha256:
    '9e7ecb330e665b7bf2a0d7e13d78f4cf3c0b9e5b27a799bdafbabd0e18ca770a',
  compiledCoreJavaScriptSha256:
    '29daa6ca4f8017ea214b72434c92b00b33a92f328a9f49798264f5c94e51f5b2',
  compositionRecordSha256:
    '3093e49e5c543d874a30bf501cb364e192d3dcb17fdad010204997b71ea99726',
  flattenAdapterSha256:
    'ed283c69e34371c592a0ba48ff18581b100cfb98faedcc4dfdc50383db253c2f',
  measurementHarnessSha256:
    '887186e2f2b1f38d1d53f10840d659ceaf475f188db499e012a51face48ac8d3',
  policySha256:
    '54d5a78b40f47e1ca1bfdbf1a7d3836c756aae1ace22ff0245d008af78178ff4',
  runtimeHandlerSha256:
    'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  structuralKirCodecSha256:
    '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const INPUT_URLS = {
  flattenAdapterSha256: new URL('./flatten.mjs', import.meta.url),
  measurementHarnessSha256:
    new URL('./combined-headroom-m4-145-measure.mjs', import.meta.url),
  policySha256: new URL('./policy.json', import.meta.url),
  runtimeHandlerSha256:
    new URL('../../packages/core/src/runtime-handler.ts', import.meta.url),
  structuralKirCodecSha256:
    new URL('../../packages/core/src/kir-structural/canonical.ts', import.meta.url),
};

function fail(message) {
  throw new TypeError(`coverage M4.145 combined headroom rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function exactInputs() {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4144();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.144 receipt digest must remain exact');
  }
  if (!isDeepStrictEqual(analysis.record.selectedNextAction, {
    changedKirLimits: ['maxBytes', 'maxDepth', 'maxNodes'],
    changedProfileLimits: ['maxNodeRows', 'maxPropertyRows', 'maxValueRows'],
    completeFunctions: 1,
    completeTools: 1,
    kirLimits: CANDIDATE_KIR_LIMITS,
    migratedParameterRows: 6,
    profileLimits: CANDIDATE_PROFILE,
    totalDelta: 98_002,
    witnesses: [WITNESS_ID],
  })) fail('published M4.144 selection must remain exact');
  if (
    analysis.inputCommit !== 'e3cc1d133ef90c4e802d8df5318935e3c826398b' ||
    analysis.record.input.inputCommit !== analysis.inputCommit
  ) fail('published M4.144 input commit must remain exact');

  for (const [name, expected] of Object.entries(INPUT_IDENTITIES)) {
    if (!/^[0-9a-f]{64}$/u.test(expected)) fail(`${name} identity must remain exact`);
    if (
      name === 'compiledCoreJavaScriptSha256' ||
      name === 'policySha256'
    ) continue;
    const url = INPUT_URLS[name];
    let source = url === undefined ? undefined : readFileSync(url);
    if (name === 'measurementHarnessSha256') {
      source = reconstructHistoricalSource({
        currentSource: source,
        expectedDigest: expected,
        milestone: 'M4.145 measurement',
        replacements: PRE_M4146_M4145_MEASUREMENT_REPLACEMENTS,
      });
    }
    if (source !== undefined && digest(source) !== expected) {
      fail(`${name} source identity must remain exact`);
    }
  }
  if (
    digestCompiledCoreJavaScript() !==
      INPUT_IDENTITIES.compiledCoreJavaScriptSha256
  ) fail('compiled core JavaScript executed by measurement must remain exact');
  const composition = loadPreM4147CanonicalizerComposition();
  if (
    digest(composition.composite) !==
      INPUT_IDENTITIES.canonicalizerCompositeSha256 ||
    digest(composition.recordBytes) !==
      INPUT_IDENTITIES.compositionRecordSha256
  ) fail('canonicalizer composition identities must remain exact');

  const livePolicy = loadCanonicalizerPolicy();
  if (
    !isDeepStrictEqual({
      maxBytes: livePolicy.kirLimits.maxBytes,
      maxDepth: livePolicy.kirLimits.maxDepth,
      maxNodes: livePolicy.kirLimits.maxNodes,
    }, CANDIDATE_KIR_LIMITS) ||
    !isDeepStrictEqual(livePolicy.profileLimits, CANDIDATE_PROFILE) ||
    !isDeepStrictEqual({
      maxBytes: livePolicy.runtimeLimits.maxBytes,
      maxStringBytes: livePolicy.runtimeLimits.maxStringBytes,
    }, DERIVED_RUNTIME_BYTES) ||
    livePolicy.runtimeLimits.maxCollectionLength !== 65_536 ||
    livePolicy.runtimeLimits.maxDepth !== 64 ||
    !isDeepStrictEqual(livePolicy.expansionLimits, {
      kirToSourceMaxFactor: 4,
      runtimeEnvelopeMaxFactor: 2,
    })
  ) fail('promoted KIR, profile, runtime, and expansion policy must remain exact');
  const policy = loadPreM4146CanonicalizerPolicy();
  if (digest(canonicalBytes(policy)) !== INPUT_IDENTITIES.policySha256) {
    fail('historical policy identity must remain exact');
  }
  if (
    CANDIDATE_KIR_LIMITS.maxBytes *
      policy.expansionLimits.kirToSourceMaxFactor !==
      DERIVED_RUNTIME_BYTES.maxStringBytes ||
    DERIVED_RUNTIME_BYTES.maxStringBytes *
      policy.expansionLimits.runtimeEnvelopeMaxFactor !==
      DERIVED_RUNTIME_BYTES.maxBytes
  ) fail('derived runtime byte limits must remain exact');
  return { analysis, policy };
}

export function buildCanonicalizerCombinedHeadroomM4145() {
  const { analysis, policy } = exactInputs();
  const productionBudget = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionBudget * 3 / 4);
  const productionHeadroom = productionBudget - EXACT_FLOOR;
  const promotionBudgetHeadroom = promotionBudget - EXACT_FLOOR;
  if (productionHeadroom !== 22_482 || promotionBudgetHeadroom !== 6_098) {
    fail('measured production and promotion headroom must remain exact');
  }
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      activeKir: structuredClone(ACTIVE_KIR_LIMITS),
      activeProfile: structuredClone(ACTIVE_PROFILE),
      candidateKir: structuredClone(CANDIDATE_KIR_LIMITS),
      candidateProfile: structuredClone(CANDIDATE_PROFILE),
      derivedRuntimeBytes: structuredClone(DERIVED_RUNTIME_BYTES),
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
      combinedPromotionApproved: true,
      disposition: 'promotion-budget-headroom-authenticated',
      nextMilestone: 'M4.146',
      productionHeadroom,
      promotionBudgetHeadroom,
      promotionReady: true,
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
        { code: 'limit-bytes', limit: 367_367, name: 'maxBytes' },
        { code: 'limit-depth', limit: 121, name: 'maxDepth' },
        { code: 'limit-nodes', limit: 7_135, name: 'maxNodes' },
      ],
    },
    summary: {
      maxExactFloor: EXACT_FLOOR,
      minimumProductionHeadroom: productionHeadroom,
      minimumPromotionHeadroom: promotionBudgetHeadroom,
      totalArtifactBytes: 367_368,
      totalParameterRows: 6,
      witnessCount: 1,
    },
    witnesses: [{
      artifactBytes: 367_368,
      belowFloor: EXACT_FLOOR - 1,
      belowFloorOutcome: 'failure',
      exactFloor: EXACT_FLOOR,
      floorOutcome: 'success',
      id: WITNESS_ID,
      loopIterations: {
        attemptedByType: { for: 42_666, while: 388 },
        attemptedTotal: EXACT_FLOOR,
      },
      observerParityVerified: true,
      parameterRows: 6,
      productionDelta: productionHeadroom,
      profileRows: { nodes: 205, properties: 332, values: 6_304 },
      promotionDelta: promotionBudgetHeadroom,
      publicParityVerified: true,
      roundTrip: true,
    }],
  };
}

export function validateCanonicalizerCombinedHeadroomM4145(value) {
  assertExactPlainData(
    value,
    'coverage M4.145 combined headroom rejection: receipt data',
  );
  const expected = buildCanonicalizerCombinedHeadroomM4145();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.145 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerCombinedHeadroomM4145(summaryUrl = SUMMARY_URL) {
  const path = summaryUrl instanceof URL ? fileURLToPath(summaryUrl) : summaryUrl;
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
  const result = validateCanonicalizerCombinedHeadroomM4145(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

function isDirectInvocation(invokedPath) {
  if (invokedPath === undefined || invokedPath === '-') return false;
  const resolvedPath = resolve(invokedPath);
  if (lstatSync(resolvedPath, { throwIfNoEntry: false }) === undefined) return false;
  return realpathSync(resolvedPath) === fileURLToPath(import.meta.url);
}

if (isDirectInvocation(process.argv[1])) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerCombinedHeadroomM4145());
}
