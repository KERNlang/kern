import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM466 } from './coverage-residual-analysis-m4-66.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.node-row-headroom.3';
const RECEIPT_DIGEST = '61e2c3b388160035d5764efcc2037c408eca8fc30f12010430168dd2b3bf9bca';
const SUMMARY_URL = new URL('./node-row-headroom-m4-67.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 30, maxPropertyRows: 50, maxValueRows: 388 },
  totalDelta: 2,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#3:isSurfaceKind',
  ],
};
const WITNESS_FACT = {
  exactFloor: 17_552,
  id: EXPECTED_SELECTION.witnesses[0],
  parameterRows: 1,
  profileRows: { nodes: 30, properties: 32, values: 219 },
  tool: 'checker',
};

function fail(message) {
  throw new TypeError(`coverage M4.67 node-row headroom rejection: ${message}`);
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
  } else {
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
}

function same(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

function repositorySource(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
}

function exactInputs() {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM466();
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.66 selection must remain exact');
  }
  const assignment = analysis.record.assignments.find(({ id }) => id === WITNESS_FACT.id);
  if (
    assignment === undefined ||
    assignment.parameterRows !== WITNESS_FACT.parameterRows ||
    assignment.tool !== WITNESS_FACT.tool ||
    !same(assignment.profileRows, WITNESS_FACT.profileRows) ||
    !same(assignment.reasons, ['profile.rows.nodes'])
  ) {
    fail(`published M4.66 witness assignment must remain exact for ${WITNESS_FACT.id}`);
  }

  const policy = loadCanonicalizerPolicy();
  if (!same(policy.profileLimits, { maxNodeRows: 28, maxPropertyRows: 50, maxValueRows: 388 })) {
    fail('active profile must remain at the published M4.66 boundary');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR depth limits must remain at the published boundary');
  }
  return { analysis, policy };
}

export function measureCanonicalizerNodeRowHeadroomM467() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const witness = {
    belowFloorOutcome: 'failure',
    exactFloor: WITNESS_FACT.exactFloor,
    floorOutcome: 'success',
    id: WITNESS_FACT.id,
    parameterRows: WITNESS_FACT.parameterRows,
    productionHeadroom: productionMaxCollectionLength - WITNESS_FACT.exactFloor,
    profileRows: structuredClone(WITNESS_FACT.profileRows),
    promotionHeadroom: promotionBudget - WITNESS_FACT.exactFloor,
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
    source: {
      canonicalizerCompositeSha256: digest(repositorySource('examples/kern-canonicalizer/canonicalizer.composed.kern')),
      canonicalizerPolicySha256: digest(readFileSync(new URL('./policy.json', import.meta.url))),
      compositionSha256: digest(readFileSync(new URL('./composition.json', import.meta.url))),
      inputSourceSha256: [{ path: inputPath, sha256: digest(repositorySource(inputPath)) }],
      publishedCoverageImplementationDigest: analysis.record.baseline.coverageImplementationDigest,
      residualAnalysisInputCommit: analysis.inputCommit,
      residualAnalysisSha256: analysis.digest,
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
      structuralKirCodecSha256: digest(repositorySource('packages/core/src/kir-structural/canonical.ts')),
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

export function validateCanonicalizerNodeRowHeadroomM467(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerNodeRowHeadroomM467();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.67 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerNodeRowHeadroomM467() {
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
  const result = validateCanonicalizerNodeRowHeadroomM467(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

export function writeCanonicalizerNodeRowHeadroomM467() {
  const result = validateCanonicalizerNodeRowHeadroomM467(
    measureCanonicalizerNodeRowHeadroomM467(),
  );
  writeCoverageSummary(SUMMARY_URL, result);
  return result;
}
