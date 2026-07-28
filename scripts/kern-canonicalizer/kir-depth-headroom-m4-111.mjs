import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { verifyCanonicalizerComposition } from './composition.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadHistoricalCanonicalizerPolicy } from './historical-policy.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadPublishedCanonicalizerProjectionAnalysisM4110 } from './projection-analysis-m4-110.mjs';

const FORMAT = 'kern.kir-canonicalizer.kir-depth-headroom.1';
const PUBLISHED_DIGEST = '0acd91174c05caa96587876209abe1e3aa8744d3d8643204d07028c3e0526be9';
const PUBLISHED_INPUT_COMMIT = 'd18950f53c69962deff6cdbf15914c60f39d35bc';
const PROJECTION_ANALYSIS_DIGEST =
  '38f26bb48237832163acb8fa99ee0b65b8dc343f77f6a7570481e54d01d6732f';
const SUMMARY_URL = new URL('./kir-depth-headroom-m4-111.json', import.meta.url);
const MEASUREMENT_URL =
  new URL('./kir-depth-headroom-m4-111-measure.mjs', import.meta.url);
const ACTIVE_KIR_LIMITS = { maxBytes: 262144, maxDepth: 64, maxNodes: 4096 };
const CANDIDATE_KIR_LIMITS = { maxBytes: 262144, maxDepth: 76, maxNodes: 4096 };
const PROFILE_LIMITS = { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2100 };
const INPUT_IDENTITIES = {
  canonicalizerCompositeSha256:
    'fd9baa340533b016f0beb7d39feb3d16fd220febfd08b8bb99a6fc034677b5a8',
  compositionRecordSha256:
    'ff914ec5e387843472722dc51d12a525436726b6099eae4e042390d26e0ed592',
  coveragePrerequisiteSummarySha256:
    '0c8df9af61367e383fd2321775f0def1bfcd873c1331a168a627f0d8312d6f26',
  coverageSummarySha256:
    'a48353818f1958219e2ad82d67b1ac4e7f209647aeddd1ec8a46bf69b8245b8b',
  flattenAdapterSha256:
    'ed283c69e34371c592a0ba48ff18581b100cfb98faedcc4dfdc50383db253c2f',
  measurementHarnessSha256:
    '6308135fdbc31fb73d319c6df4c82321b8a3fc63cdd2f44b525fccf86180e01b',
  policySha256:
    '035af4bfe549ffdf8e19c584dcae4ab60b574a4109253227a703475afb321658',
  runtimeHandlerSha256:
    'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  structuralKirCodecSha256:
    '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const INPUT_URLS = {
  compositionRecordSha256: new URL('./composition.json', import.meta.url),
  flattenAdapterSha256: new URL('./flatten.mjs', import.meta.url),
  runtimeHandlerSha256: new URL('../../packages/core/src/runtime-handler.ts', import.meta.url),
  structuralKirCodecSha256:
    new URL('../../packages/core/src/kir-structural/canonical.ts', import.meta.url),
};
const MEASUREMENT_REPLACEMENTS = [
  {
    current:
      'const HISTORICAL_ACTIVE_DEPTH = 64;\nconst CANDIDATE_DEPTH = 76;',
    historical: 'const CANDIDATE_DEPTH = 76;',
  },
  {
    current:
      '  if (\n' +
      '    policy.kirLimits.maxDepth !== CANDIDATE_DEPTH ||\n' +
      '    policy.runtimeLimits.maxDepth !== HISTORICAL_ACTIVE_DEPTH\n' +
      '  ) {\n' +
      "    fail('live KIR depth must retain M4.112 while runtime depth remains 64');\n" +
      '  }',
    historical:
      '  if (policy.kirLimits.maxDepth !== 64 || policy.runtimeLimits.maxDepth !== 64) {\n' +
      "    fail('active KIR and runtime depth policies must remain 64');\n" +
      '  }',
  },
  {
    current: '    requiredDepth <= HISTORICAL_ACTIVE_DEPTH ||',
    historical: '    requiredDepth <= policy.kirLimits.maxDepth ||',
  },
];
const WITNESSES = [
  {
    artifactBytes: 30374,
    belowFloor: 10702,
    belowFloorOutcome: 'failure',
    exactFloor: 10703,
    floorOutcome: 'success',
    id: 'examples/capstone-assertion-engine/compare.kern#2:compareList',
    parameterRows: 13,
    productionDelta: 54833,
    promotionDelta: 38449,
    publicParityVerified: true,
    requiredDepth: 70,
    roundTrip: true,
    structuralRows: { nodes: 38, properties: 69, values: 432 },
  },
  {
    artifactBytes: 40699,
    belowFloor: 13106,
    belowFloorOutcome: 'failure',
    exactFloor: 13107,
    floorOutcome: 'success',
    id: 'examples/capstone-assertion-engine/compare.kern#3:compareMap',
    parameterRows: 13,
    productionDelta: 52429,
    promotionDelta: 36045,
    publicParityVerified: true,
    requiredDepth: 70,
    roundTrip: true,
    structuralRows: { nodes: 44, properties: 78, values: 606 },
  },
  {
    artifactBytes: 31725,
    belowFloor: 10604,
    belowFloorOutcome: 'failure',
    exactFloor: 10605,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker-while.kern#11:lengthReceiverProven',
    parameterRows: 12,
    productionDelta: 54931,
    promotionDelta: 38547,
    publicParityVerified: true,
    requiredDepth: 66,
    roundTrip: true,
    structuralRows: { nodes: 34, properties: 57, values: 464 },
  },
  {
    artifactBytes: 44863,
    belowFloor: 18031,
    belowFloorOutcome: 'failure',
    exactFloor: 18032,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker-while.kern#9:numericBindingProven',
    parameterRows: 16,
    productionDelta: 47504,
    promotionDelta: 31120,
    publicParityVerified: true,
    requiredDepth: 72,
    roundTrip: true,
    structuralRows: { nodes: 54, properties: 80, values: 639 },
  },
  {
    artifactBytes: 25160,
    belowFloor: 14057,
    belowFloorOutcome: 'failure',
    exactFloor: 14058,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker.kern#17:paramCallsitesOk',
    parameterRows: 23,
    productionDelta: 51478,
    promotionDelta: 35094,
    publicParityVerified: true,
    requiredDepth: 72,
    roundTrip: true,
    structuralRows: { nodes: 39, properties: 71, values: 325 },
  },
  {
    artifactBytes: 16812,
    belowFloor: 4289,
    belowFloorOutcome: 'failure',
    exactFloor: 4290,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker.kern#20:mapKeyToken',
    parameterRows: 9,
    productionDelta: 61246,
    promotionDelta: 44862,
    publicParityVerified: true,
    requiredDepth: 67,
    roundTrip: true,
    structuralRows: { nodes: 21, properties: 33, values: 230 },
  },
  {
    artifactBytes: 26850,
    belowFloor: 8373,
    belowFloorOutcome: 'failure',
    exactFloor: 8374,
    floorOutcome: 'success',
    id: 'examples/capstone-checker-subset/checker.kern#21:mapKnownBefore',
    parameterRows: 12,
    productionDelta: 57162,
    promotionDelta: 40778,
    publicParityVerified: true,
    requiredDepth: 71,
    roundTrip: true,
    structuralRows: { nodes: 31, properties: 48, values: 391 },
  },
  {
    artifactBytes: 85047,
    belowFloor: 31027,
    belowFloorOutcome: 'failure',
    exactFloor: 31028,
    floorOutcome: 'success',
    id: 'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#4:emitstatement',
    parameterRows: 15,
    productionDelta: 34508,
    promotionDelta: 18124,
    publicParityVerified: true,
    requiredDepth: 76,
    roundTrip: true,
    structuralRows: { nodes: 70, properties: 115, values: 1377 },
  },
  {
    artifactBytes: 33125,
    belowFloor: 16322,
    belowFloorOutcome: 'failure',
    exactFloor: 16323,
    floorOutcome: 'success',
    id: 'examples/selfhost-validator/validator.kern#15:exportkind',
    parameterRows: 21,
    productionDelta: 49213,
    promotionDelta: 32829,
    publicParityVerified: true,
    requiredDepth: 76,
    roundTrip: true,
    structuralRows: { nodes: 39, properties: 69, values: 483 },
  },
];

function fail(message) {
  throw new TypeError(`coverage M4.111 KIR depth headroom rejection: ${message}`);
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
  const analysis = loadPublishedCanonicalizerProjectionAnalysisM4110();
  if (analysis.digest !== PROJECTION_ANALYSIS_DIGEST) {
    fail('published M4.110 receipt digest must remain exact');
  }
  const expectedWitnesses = WITNESSES.map(({ id }) => id);
  if (
    canonicalBytes(analysis.record.selectedNextAction.witnesses)
      .compare(canonicalBytes(expectedWitnesses)) !== 0
  ) {
    fail('published M4.110 witness population must remain exact');
  }
  const policy = loadCanonicalizerPolicy();
  if (
    canonicalBytes({
      maxBytes: policy.kirLimits.maxBytes,
      maxDepth: policy.kirLimits.maxDepth,
      maxNodes: policy.kirLimits.maxNodes,
    }).compare(canonicalBytes(CANDIDATE_KIR_LIMITS)) !== 0 ||
    canonicalBytes(policy.profileLimits).compare(canonicalBytes(PROFILE_LIMITS)) !== 0 ||
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.runtimeLimits.maxDepth !== 64
  ) {
    fail('promoted KIR, profile, and runtime policies must remain exact');
  }
  loadHistoricalCanonicalizerPolicy({
    expectedDigest: INPUT_IDENTITIES.policySha256,
    kirLimitOverrides: {
      maxDepth: 64,
    },
    milestone: 'M4.111',
    profileLimits: PROFILE_LIMITS,
  });
  reconstructHistoricalSource({
    currentSource: readFileSync(MEASUREMENT_URL),
    expectedDigest: INPUT_IDENTITIES.measurementHarnessSha256,
    milestone: 'M4.111 measurement',
    replacements: MEASUREMENT_REPLACEMENTS,
  });
  for (const [name, url] of Object.entries(INPUT_URLS)) {
    if (digest(readFileSync(url)) !== INPUT_IDENTITIES[name]) {
      fail(`${name} source identity must remain exact`);
    }
  }
  const composition = verifyCanonicalizerComposition();
  if (digest(composition.source) !== INPUT_IDENTITIES.canonicalizerCompositeSha256) {
    fail('canonicalizer composite identity must remain exact');
  }
  return { analysis, policy };
}

export function buildCanonicalizerKirDepthHeadroomM4111() {
  const { analysis } = exactInputs();
  const productionBudget = 65_536;
  const promotionBudget = 49_152;
  const maxExactFloor = Math.max(...WITNESSES.map(({ exactFloor }) => exactFloor));
  const totalParameterRows = WITNESSES.reduce(
    (total, { parameterRows }) => total + parameterRows,
    0,
  );
  if (
    maxExactFloor !== 31_028 ||
    totalParameterRows !== 134 ||
    WITNESSES.some(({ promotionDelta }) => promotionDelta < 0)
  ) {
    fail('measured M4.111 GO evidence must retain exact headroom');
  }
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
      nextMilestone: 'M4.112',
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
      belowCandidateDepth: CANDIDATE_KIR_LIMITS.maxDepth - 1,
      belowCandidateOutcome: 'failure',
      candidateDepth: CANDIDATE_KIR_LIMITS.maxDepth,
      candidateOutcome: 'success',
      rejectedWitnesses: WITNESSES
        .filter(({ requiredDepth }) => requiredDepth === CANDIDATE_KIR_LIMITS.maxDepth)
        .map(({ id }) => id),
    },
    summary: {
      maxExactFloor,
      minimumProductionHeadroom: productionBudget - maxExactFloor,
      minimumPromotionHeadroom: promotionBudget - maxExactFloor,
      totalArtifactBytes: WITNESSES.reduce(
        (total, { artifactBytes }) => total + artifactBytes,
        0,
      ),
      totalParameterRows,
      witnessCount: WITNESSES.length,
    },
    witnesses: structuredClone(WITNESSES),
  };
}

export function validateCanonicalizerKirDepthHeadroomM4111(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerKirDepthHeadroomM4111();
  if (digest(canonicalBytes(expected)) !== PUBLISHED_DIGEST) {
    fail('measured evidence must match the exact M4.111 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('headroom receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerKirDepthHeadroomM4111() {
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
  const result = validateCanonicalizerKirDepthHeadroomM4111(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerKirDepthHeadroomM4111());
}
