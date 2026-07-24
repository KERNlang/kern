import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM474 } from './coverage-residual-analysis-m4-74.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.dual-row-headroom.3';
const RECEIPT_DIGEST = 'c70022af6c90620c9ade8c03cff85eba41c53966f515b5523bd774985cb877f6';
const SUMMARY_URL = new URL('./dual-row-headroom-m4-75.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxValueRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
  totalDelta: 80,
  witnesses: ['examples/kern-canonicalizer/canonicalizer.kern#0:typesource'],
};
const PUBLISHED_INPUT = {
  commit: 'b867c5d5b67917f7abc7cdc3da5c76b867c69cf5',
  coverageImplementationDigest: '025fbf7ea33aecf8e1ee36fc6ef2334fbb2a71641777660473953e9da38a36ee',
  coverageSummarySha256: '728cf911c27bd81ccbd466d9dbb2c3a7ef08fd7131eda446168cd05a8d8b3e2d',
  prerequisiteSummarySha256: '57f140620f1d8b604b709708e7a2480d2e08311ab045f5c02a77b6d754f8b4be',
};
const WITNESS_FACT = {
  exactFloor: 46_255,
  id: EXPECTED_SELECTION.witnesses[0],
  parameterRows: 6,
  profileRows: { nodes: 38, properties: 51, values: 461 },
  tool: 'canonicalizer',
};

function fail(message) {
  throw new TypeError(`coverage M4.75 dual-row headroom rejection: ${message}`);
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
  const analysis = loadPublishedCanonicalizerResidualAnalysisM474();
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.74 selection must remain exact');
  }
  const assignment = analysis.record.assignments.find(({ id }) => id === WITNESS_FACT.id);
  if (
    assignment === undefined ||
    assignment.parameterRows !== WITNESS_FACT.parameterRows ||
    assignment.tool !== WITNESS_FACT.tool ||
    !same(assignment.profileRows, WITNESS_FACT.profileRows) ||
    !same(assignment.reasons, ['profile.rows.nodes', 'profile.rows.values'])
  ) {
    fail(`published M4.74 witness assignment must remain exact for ${WITNESS_FACT.id}`);
  }

  const policy = loadCanonicalizerPolicy();
  if (!same(policy.profileLimits, { maxNodeRows: 31, maxPropertyRows: 53, maxValueRows: 388 })) {
    fail('active profile must remain at the published M4.74 boundary');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR depth limits must remain at the published boundary');
  }
  return { analysis, policy };
}

export function measureCanonicalizerDualRowHeadroomM475() {
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
      publishedCoverageImplementationDigest: PUBLISHED_INPUT.coverageImplementationDigest,
      publishedCoverageSummarySha256: PUBLISHED_INPUT.coverageSummarySha256,
      publishedInputCommit: PUBLISHED_INPUT.commit,
      publishedPrerequisiteSummarySha256: PUBLISHED_INPUT.prerequisiteSummarySha256,
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

export function validateCanonicalizerDualRowHeadroomM475(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerDualRowHeadroomM475();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.75 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerDualRowHeadroomM475() {
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
  const result = validateCanonicalizerDualRowHeadroomM475(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

export function writeCanonicalizerDualRowHeadroomM475() {
  const result = validateCanonicalizerDualRowHeadroomM475(
    measureCanonicalizerDualRowHeadroomM475(),
  );
  writeCoverageSummary(SUMMARY_URL, result);
  return result;
}
