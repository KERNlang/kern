import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM483 } from './coverage-residual-analysis-m4-83.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';

const FORMAT = 'kern.kir-canonicalizer.value-row-headroom.1';
const RECEIPT_DIGEST = '4b92ced7a43f4aa938a9fe303edcd5fb17b423a61d99b9a8c476ccdc653b8065';
const SOURCE_COMMIT = '6a5dea4687b54600778d62cf21855443567959e6';
const SUMMARY_URL = new URL('./value-row-headroom-m4-84.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
  totalDelta: 119,
  witnesses: ['examples/capstone-checker-subset/checker.kern#16:argProvenanced'],
};
const PUBLISHED_INPUT = {
  canonicalizerCompositeSha256: 'fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28',
  canonicalizerPolicySha256: '6506df16bb042ae3c5544fce3324c500e2401192983fc98ae492d2283ff21495',
  commit: SOURCE_COMMIT,
  compositionSha256: '894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b',
  coverageImplementationDigest: 'e02d1e500c4ddfd668b11854bed8d69c04d0fc79d0adb9484f6d9838ab76c301',
  coverageSummarySha256: 'cb38681a9ad87434c85eef3295e5a7cef4957af2397f75186a9496fc82d9153d',
  inputSourceSha256: 'a703952e717a77015179987a4e5a6940b0b16846a9c122810e959a595eee5017',
  prerequisiteSummarySha256: '1236bd16b762ee0a115a31487f622a77662e609520e1a7e15fb48e784820c5d0',
  structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const PUBLISHED_POLICY = {
  kirLimits: { maxDepth: 64 },
  profileLimits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
  runtimeLimits: { maxCollectionLength: 65_536 },
};
const WITNESS_FACT = {
  exactFloor: 38_773,
  id: EXPECTED_SELECTION.witnesses[0],
  parameterRows: 19,
  profileRows: { nodes: 35, properties: 55, values: 580 },
  tool: 'checker',
};

function fail(message) {
  throw new TypeError(`coverage M4.84 value-row headroom rejection: ${message}`);
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

function same(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

function exactInputs() {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM483();
  if (analysis.digest !== '42815f7d4bd02daa625718deb8b8ae04590efb605dccc69ffc90b3a4bdcbf546') {
    fail('published M4.83 receipt digest must remain exact');
  }
  if (analysis.inputCommit !== '89083ba126201067c918ea7e130382ca171f4097') {
    fail('published M4.83 residual input commit must remain exact');
  }
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.83 selection must remain exact');
  }
  const assignment = analysis.record.assignments.find(({ id }) => id === WITNESS_FACT.id);
  if (
    assignment === undefined ||
    assignment.parameterRows !== WITNESS_FACT.parameterRows ||
    assignment.tool !== WITNESS_FACT.tool ||
    !same(assignment.profileRows, WITNESS_FACT.profileRows) ||
    !same(assignment.reasons, ['profile.rows.values'])
  ) {
    fail(`published M4.83 witness assignment must remain exact for ${WITNESS_FACT.id}`);
  }
  return { analysis, policy: structuredClone(PUBLISHED_POLICY) };
}

export function measureCanonicalizerValueRowHeadroomM484() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const promotionHeadroom = promotionBudget - WITNESS_FACT.exactFloor;
  if (promotionHeadroom < 0) fail('GO receipt requires non-negative promotion headroom');
  const witness = {
    belowFloorOutcome: 'failure',
    exactFloor: WITNESS_FACT.exactFloor,
    floorOutcome: 'success',
    id: WITNESS_FACT.id,
    parameterRows: WITNESS_FACT.parameterRows,
    productionHeadroom: productionMaxCollectionLength - WITNESS_FACT.exactFloor,
    profileRows: structuredClone(WITNESS_FACT.profileRows),
    promotionHeadroom,
    roundTrip: true,
  };
  const inputPath = EXPECTED_SELECTION.witnesses[0].split('#')[0];
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      candidateProfile: structuredClone(EXPECTED_SELECTION.limits),
      productionMaxCollectionLength,
      promotionBudget,
      reservedProductionHeadroom: productionMaxCollectionLength - promotionBudget,
    },
    moduleEnvelope: { disposition: 'not-claimed', maxDepth: policy.kirLimits.maxDepth },
    promotion: { disposition: 'approved', nextMilestone: 'M4.85' },
    source: {
      canonicalizerCompositeSha256: PUBLISHED_INPUT.canonicalizerCompositeSha256,
      canonicalizerPolicySha256: PUBLISHED_INPUT.canonicalizerPolicySha256,
      compositionSha256: PUBLISHED_INPUT.compositionSha256,
      inputSourceSha256: [{ path: inputPath, sha256: PUBLISHED_INPUT.inputSourceSha256 }],
      publishedCoverageImplementationDigest: PUBLISHED_INPUT.coverageImplementationDigest,
      publishedCoverageSummarySha256: PUBLISHED_INPUT.coverageSummarySha256,
      publishedInputCommit: PUBLISHED_INPUT.commit,
      publishedPrerequisiteSummarySha256: PUBLISHED_INPUT.prerequisiteSummarySha256,
      residualAnalysisInputCommit: analysis.inputCommit,
      residualAnalysisSha256: analysis.digest,
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
      structuralKirCodecSha256: PUBLISHED_INPUT.structuralKirCodecSha256,
    },
    summary: {
      maxExactFloor: witness.exactFloor,
      minimumProductionHeadroom: witness.productionHeadroom,
      minimumPromotionHeadroom: witness.promotionHeadroom,
      witnessCount: 1,
    },
    witnesses: [witness],
  };
}

export function validateCanonicalizerValueRowHeadroomM484(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerValueRowHeadroomM484();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.84 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerValueRowHeadroomM484() {
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
  const result = validateCanonicalizerValueRowHeadroomM484(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerValueRowHeadroomM484());
}
