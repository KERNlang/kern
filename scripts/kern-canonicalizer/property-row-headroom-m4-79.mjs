import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM478 } from './coverage-residual-analysis-m4-78.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';

const FORMAT = 'kern.kir-canonicalizer.property-row-headroom.2';
const RECEIPT_DIGEST = 'd8683f1440e8bb0f8496ab1845c83c7dabe73dbfd26114b78685d8c8e1cf830b';
const SUMMARY_URL = new URL('./property-row-headroom-m4-79.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxPropertyRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 461 },
  totalDelta: 8,
  witnesses: ['examples/capstone-checker-subset/checker-while.kern#16:checkWhileCore'],
};
const PUBLISHED_INPUT = {
  canonicalizerCompositeSha256: '974b8d3ba6fefac4861152be88181c176feda56df9aa820e9f8d3a89e0488f8d',
  canonicalizerPolicySha256: 'ac4983323d0e9da875e75ae12aff079d8d52deee069d77f703280a06f2f42244',
  commit: '07c896900a49d9abd6b5bb4946ee891a97684575',
  compositionSha256: '2e8a4f77f6f343e7a16b42522b74afce3fd91272df3261431cb8e8950c17105d',
  coverageImplementationDigest: 'c8d4a6f063c0021993022ccc5a05360717311fef8934c774a1aee49c86305ea8',
  coverageSummarySha256: 'e47d481662172a8dbbdd0605f284f2248f9b6631e8653a189117a37d806d4ec7',
  inputSourceSha256: '84ca20346a655595cbaab095e3b46b964e46acabd90ead29d1d1a3c6813e8b60',
  prerequisiteSummarySha256: '4c65daf66262f22bd476638a67976b5461f9ae9383e122c0025a7f05eb90fc4f',
  structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const PUBLISHED_POLICY = {
  kirLimits: { maxDepth: 64 },
  profileLimits: { maxNodeRows: 38, maxPropertyRows: 53, maxValueRows: 461 },
  runtimeLimits: { maxCollectionLength: 65_536 },
};
const WITNESS_FACT = {
  exactFloor: 56_238,
  id: EXPECTED_SELECTION.witnesses[0],
  parameterRows: 22,
  profileRows: { nodes: 38, properties: 61, values: 460 },
  tool: 'checker',
};

function fail(message) {
  throw new TypeError(`coverage M4.79 property-row headroom rejection: ${message}`);
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

function exactInputs() {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM478();
  if (analysis.digest !== 'f63342ef1f4b2754add412232fd4cf24758b0a0f77b8522361ea2f66cd1fadc2') {
    fail('published M4.78 receipt digest must remain exact');
  }
  if (analysis.inputCommit !== '2ee34545f1a97acd5889f95e52bdd0952eb362bd') {
    fail('published M4.78 residual input commit must remain exact');
  }
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.78 selection must remain exact');
  }
  const assignment = analysis.record.assignments.find(({ id }) => id === WITNESS_FACT.id);
  if (
    assignment === undefined ||
    assignment.parameterRows !== WITNESS_FACT.parameterRows ||
    assignment.tool !== WITNESS_FACT.tool ||
    !same(assignment.profileRows, WITNESS_FACT.profileRows) ||
    !same(assignment.reasons, ['profile.rows.properties'])
  ) {
    fail(`published M4.78 witness assignment must remain exact for ${WITNESS_FACT.id}`);
  }

  return { analysis, policy: structuredClone(PUBLISHED_POLICY) };
}

export function measureCanonicalizerPropertyRowHeadroomM479() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const promotionBudgetDeficit = WITNESS_FACT.exactFloor - promotionBudget;
  if (promotionBudgetDeficit <= 0) fail('NO-GO receipt requires a positive promotion deficit');
  const witness = {
    belowFloorOutcome: 'failure',
    exactFloor: WITNESS_FACT.exactFloor,
    floorOutcome: 'success',
    id: WITNESS_FACT.id,
    parameterRows: WITNESS_FACT.parameterRows,
    productionHeadroom: productionMaxCollectionLength - WITNESS_FACT.exactFloor,
    profileRows: structuredClone(WITNESS_FACT.profileRows),
    promotionBudgetDeficit,
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
    promotion: {
      disposition: 'rejected-over-budget',
      nextMilestone: 'M4.80',
      requiredFloorReduction: promotionBudgetDeficit,
    },
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
      promotionBudgetDeficit,
      witnessCount: 1,
    },
    witnesses: [witness],
  };
}

export function validateCanonicalizerPropertyRowHeadroomM479(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerPropertyRowHeadroomM479();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.79 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerPropertyRowHeadroomM479() {
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
  const result = validateCanonicalizerPropertyRowHeadroomM479(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

export function writeCanonicalizerPropertyRowHeadroomM479() {
  const result = validateCanonicalizerPropertyRowHeadroomM479(
    measureCanonicalizerPropertyRowHeadroomM479(),
  );
  writeCoverageSummary(SUMMARY_URL, result);
  return result;
}
