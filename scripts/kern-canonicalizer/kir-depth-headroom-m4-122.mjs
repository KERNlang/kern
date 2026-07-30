import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  canonicalCompositionRecordBytes,
} from './composition.mjs';
import {
  PRE_M4129_M4116_MEASUREMENT_REPLACEMENTS,
} from './assignment-target-projection-target.mjs';
import { digestPreM4135CompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadHistoricalCanonicalizerPolicy } from './historical-policy.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  loadPreM4129CanonicalizerComposition,
} from './historical-composition.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4121 } from './projection-analysis-m4-121.mjs';

const FORMAT = 'kern.kir-canonicalizer.kir-depth-headroom.1';
const PUBLISHED_DIGEST = 'e9b5e413a81d5c2992cd31eb705728608407e934d0f7c5c3d765865e65ad290e';
const PUBLISHED_INPUT_COMMIT = '7161086c0c2c03b3b12e05d3656138d61f374ab0';
const PROJECTION_ANALYSIS_DIGEST =
  '2579208ec9759c7c31fc76d64dbbe4f09ac9852801506584e78450742a40f1b1';
const SUMMARY_URL = new URL('./kir-depth-headroom-m4-122.json', import.meta.url);
const MEASUREMENT_URL =
  new URL('./kir-depth-headroom-m4-122-measure.mjs', import.meta.url);
const ACTIVE_KIR_LIMITS = { maxBytes: 262144, maxDepth: 76, maxNodes: 4096 };
const CANDIDATE_KIR_LIMITS = { maxBytes: 262144, maxDepth: 77, maxNodes: 4096 };
const PROFILE_LIMITS = { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2411 };
const WITNESS_ID = 'examples/capstone-checker-subset/checker.kern#2:rejectLine';
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
    'bc01de3038ab9071edee3e5f9569c3cdf686e2a4354e61086701e9c3612c1c05',
  policySha256:
    '2572743f5b942cac0e4d33d735d590caee3dbddcfebbb229b8cd94b14118d1b8',
  runtimeHandlerSha256:
    'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  structuralKirCodecSha256:
    '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const INPUT_URLS = {
  flattenAdapterSha256: new URL('./flatten.mjs', import.meta.url),
  runtimeHandlerSha256: new URL('../../packages/core/src/runtime-handler.ts', import.meta.url),
  structuralKirCodecSha256:
    new URL('../../packages/core/src/kir-structural/canonical.ts', import.meta.url),
};
const MEASUREMENT_REPLACEMENTS = [
  {
    current:
      "import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';\n",
    historical:
      "import { loadCanonicalizerPolicy } from './policy.mjs';\n",
  },
  {
    current:
      '  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);\n' +
      '  if (parameters.length !== requirement.parameterRows) {\n' +
      '    fail(`witness ${witnessId} parameter rows must remain exact`);\n' +
      '  }\n' +
      '  const policy = loadPreM4130CanonicalizerPolicy();',
    historical:
      '  const { parameters, root } = migrateLegacyFunctionForPrerequisite(sourceRoot);\n' +
      '  if (parameters.length !== requirement.parameterRows) {\n' +
      '    fail(`witness ${witnessId} parameter rows must remain exact`);\n' +
      '  }\n' +
      '  const policy = loadCanonicalizerPolicy();',
  },
  {
    current:
      'export function measureCanonicalizerKirDepthHeadroomM4122() {\n' +
      '  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4121();\n' +
      '  const policy = loadPreM4130CanonicalizerPolicy();',
    historical:
      'export function measureCanonicalizerKirDepthHeadroomM4122() {\n' +
      '  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4121();\n' +
      '  const policy = loadCanonicalizerPolicy();',
  },
  {
    current:
      "import { loadPreM4124CoverageInputs } from './historical-parameter-sources.mjs';\n",
    historical: '',
  },
  {
    current:
      '  const currentCoveragePolicy = loadCoveragePolicy();\n' +
      '  const historical = loadPreM4124CoverageInputs(currentCoveragePolicy);\n' +
      '  const sourceRoot = sourceFunctionRoots(\n' +
      '    historical.policy,\n' +
      '    historical.sourceOverrides,\n' +
      '  ).get(witnessId);',
    historical:
      '  const coveragePolicy = loadCoveragePolicy();\n' +
      '  const sourceRoot = sourceFunctionRoots(coveragePolicy).get(witnessId);',
  },
  {
    current:
      'const HISTORICAL_ACTIVE_DEPTH = 76;\nconst CANDIDATE_DEPTH = 77;',
    historical:
      'const ACTIVE_DEPTH = 76;\nconst CANDIDATE_DEPTH = 77;',
  },
  {
    current:
      '  if (\n' +
      '    policy.kirLimits.maxDepth !== CANDIDATE_DEPTH ||\n' +
      '    policy.runtimeLimits.maxDepth !== 64\n' +
      '  ) {\n' +
      "    fail('live KIR depth must retain M4.123 while runtime depth remains 64');\n" +
      '  }',
    historical:
      '  if (\n' +
      '    policy.kirLimits.maxDepth !== ACTIVE_DEPTH ||\n' +
      '    policy.runtimeLimits.maxDepth !== 64\n' +
      '  ) {\n' +
      "    fail('live KIR depth must remain 76 while runtime depth remains 64');\n" +
      '  }',
  },
  {
    current:
      '    () => encodeStructuralKir(root, {\n' +
      '      ...policy.kirLimits,\n' +
      '      maxDepth: HISTORICAL_ACTIVE_DEPTH,\n' +
      '    }),',
    historical:
      '    () => encodeStructuralKir(root, { ...policy.kirLimits, maxDepth: ACTIVE_DEPTH }),',
  },
];
const WITNESS = {
  artifactBytes: 7725,
  belowFloor: 1006,
  belowFloorOutcome: 'failure',
  exactFloor: 1007,
  floorOutcome: 'success',
  id: WITNESS_ID,
  parameterRows: 5,
  productionDelta: 64529,
  promotionDelta: 48145,
  publicParityVerified: true,
  requiredDepth: 77,
  roundTrip: true,
  structuralRows: { nodes: 8, properties: 15, values: 106 },
};

function fail(message) {
  throw new TypeError(`coverage M4.122 KIR depth headroom rejection: ${message}`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('arrays must use the plain prototype');
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key === 'symbol') ||
      keys.length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    ) fail('arrays must be dense and undecorated');
    for (const [index, key] of Object.keys(value).entries()) {
      if (key !== String(index)) fail('arrays must contain canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('arrays must contain plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('objects must use the plain prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('objects must contain plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4121();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.121 receipt digest must remain exact');
  }
  if (
    canonicalBytes(analysis.record.selectedNextAction).compare(canonicalBytes({
      changedLimits: ['maxDepth'],
      completeFunctions: 1,
      completeTools: 1,
      kirLimits: CANDIDATE_KIR_LIMITS,
      migratedParameterRows: 5,
      totalDelta: 1,
      witnesses: [WITNESS_ID],
    })) !== 0
  ) fail('published M4.121 selected action must remain exact');
  const requirement = analysis.record.requirements.find(({ id }) => id === WITNESS_ID);
  if (
    canonicalBytes(requirement).compare(canonicalBytes({
      id: WITNESS_ID,
      outcome: 'projected',
      parameterRows: 5,
      profileRows: WITNESS.structuralRows,
      requiredKirLimits: { maxDepth: 77 },
      tool: 'checker',
    })) !== 0
  ) fail('published M4.121 witness requirement must remain exact');

  const policy = loadCanonicalizerPolicy();
  if (
    canonicalBytes({
      maxBytes: policy.kirLimits.maxBytes,
      maxDepth: policy.kirLimits.maxDepth,
      maxNodes: policy.kirLimits.maxNodes,
    }).compare(canonicalBytes({
      maxBytes: 367_368,
      maxDepth: 122,
      maxNodes: 7_136,
    })) !== 0 ||
    canonicalBytes(policy.profileLimits).compare(canonicalBytes({
      maxNodeRows: 205,
      maxPropertyRows: 332,
      maxValueRows: 6_304,
    })) !== 0 ||
    policy.runtimeLimits.maxBytes !== 2_938_944 ||
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.runtimeLimits.maxDepth !== 64 ||
    policy.runtimeLimits.maxStringBytes !== 1_469_472
  ) fail('promoted KIR, profile, and runtime policies must remain exact');

  loadHistoricalCanonicalizerPolicy({
    expectedDigest: INPUT_IDENTITIES.policySha256,
    kirLimitOverrides: ACTIVE_KIR_LIMITS,
    milestone: 'M4.122',
    profileLimits: PROFILE_LIMITS,
    runtimeLimitOverrides: {
      maxBytes: 2_097_152,
      maxStringBytes: 1_048_576,
    },
  });
  reconstructHistoricalSource({
    currentSource: readFileSync(MEASUREMENT_URL),
    expectedDigest: INPUT_IDENTITIES.measurementHarnessSha256,
    milestone: 'M4.122 measurement',
    replacements: [
      ...PRE_M4129_M4116_MEASUREMENT_REPLACEMENTS,
      ...MEASUREMENT_REPLACEMENTS,
    ],
  });

  for (const [name, url] of Object.entries(INPUT_URLS)) {
    if (digest(readFileSync(url)) !== INPUT_IDENTITIES[name]) {
      fail(`${name} source identity must remain exact`);
    }
  }
  if (
    digestPreM4135CompiledCoreJavaScript() !==
      INPUT_IDENTITIES.compiledCoreJavaScriptSha256
  ) fail('compiled core JavaScript executed by the measurement must remain exact');
  const composition = loadPreM4129CanonicalizerComposition();
  if (
    digest(composition.composite) !== INPUT_IDENTITIES.canonicalizerCompositeSha256 ||
    digest(canonicalCompositionRecordBytes(composition.record)) !==
      INPUT_IDENTITIES.compositionRecordSha256
  ) fail('canonicalizer composition identities must remain exact');
  return analysis;
}

export function buildCanonicalizerKirDepthHeadroomM4122() {
  const analysis = exactInputs();
  const productionBudget = 65_536;
  const promotionBudget = 49_152;
  if (
    WITNESS.exactFloor !== 1007 ||
    WITNESS.parameterRows !== 5 ||
    WITNESS.promotionDelta < 0
  ) fail('measured M4.122 GO evidence must retain exact headroom');
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      activeKir: structuredClone(ACTIVE_KIR_LIMITS),
      candidateKir: structuredClone(CANDIDATE_KIR_LIMITS),
      productionBudget,
      profile: structuredClone(PROFILE_LIMITS),
      promotionBudget,
      reservedProductionHeadroom: productionBudget - promotionBudget,
      runtimeMaxDepth: 64,
    },
    measurement: {
      disposition: 'authenticated-evidence-only',
      kirPolicyChanged: false,
      runtimePolicyChanged: false,
    },
    promotion: {
      disposition: 'approved-with-headroom',
      kirDepthPromotionApproved: true,
      nextMilestone: 'M4.123',
      requiredDepth: CANDIDATE_KIR_LIMITS.maxDepth,
    },
    source: {
      ...structuredClone(INPUT_IDENTITIES),
      projectionAnalysisInputCommit: analysis.inputCommit,
      projectionAnalysisSha256: analysis.digest,
      publishedInputCommit: PUBLISHED_INPUT_COMMIT,
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
    },
    structuralBoundary: {
      belowCandidateDepth: ACTIVE_KIR_LIMITS.maxDepth,
      belowCandidateOutcome: 'failure',
      candidateDepth: CANDIDATE_KIR_LIMITS.maxDepth,
      candidateOutcome: 'success',
      rejectedWitnesses: [WITNESS_ID],
    },
    summary: {
      maxExactFloor: WITNESS.exactFloor,
      minimumProductionHeadroom: WITNESS.productionDelta,
      minimumPromotionHeadroom: WITNESS.promotionDelta,
      totalArtifactBytes: WITNESS.artifactBytes,
      totalParameterRows: WITNESS.parameterRows,
      witnessCount: 1,
    },
    witnesses: [structuredClone(WITNESS)],
  };
}

export function validateCanonicalizerKirDepthHeadroomM4122(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerKirDepthHeadroomM4122();
  if (digest(canonicalBytes(expected)) !== PUBLISHED_DIGEST) {
    fail('measured evidence must match the exact M4.122 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('headroom receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerKirDepthHeadroomM4122() {
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
  const result = validateCanonicalizerKirDepthHeadroomM4122(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerKirDepthHeadroomM4122());
}
