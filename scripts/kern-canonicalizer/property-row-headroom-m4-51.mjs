import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM450 } from './coverage-residual-analysis-m4-50.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.property-row-headroom.1';
const RECEIPT_DIGEST = 'c36711a885495d41b879bdcc364122f380dfde1a720a0985cdafbd78e067dfbe';
const SUMMARY_URL = new URL('./property-row-headroom-m4-51.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxPropertyRows'],
  completeFunctions: 1,
  completeTools: 1,
  limits: { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 },
  totalDelta: 1,
  witnesses: [
    'examples/selfhost-validator/validator.kern#17:classcyclefrom',
  ],
};
const WITNESS_FACT = {
  exactFloor: 11_951,
  id: EXPECTED_SELECTION.witnesses[0],
  parameterRows: 6,
  profileRows: { nodes: 19, properties: 31, values: 202 },
};

function fail(message) {
  throw new TypeError(`coverage M4.51 property-row headroom rejection: ${message}`);
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
  if (seen.has(value)) fail('headroom data must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('headroom arrays must use the plain prototype');
    }
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (ownKeys.some((key) => typeof key === 'symbol') ||
        ownKeys.length !== value.length + 1 || enumerableKeys.length !== value.length) {
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
  seen.delete(value);
}

function same(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

function repositorySource(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
}

function exactInputs() {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM450();
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.50 selection must remain exact');
  }
  const assignment = analysis.record.assignments.find(({ id }) => id === WITNESS_FACT.id);
  if (
    assignment === undefined || assignment.parameterRows !== WITNESS_FACT.parameterRows ||
    assignment.tool !== 'validator' || !same(assignment.profileRows, WITNESS_FACT.profileRows) ||
    !same(assignment.reasons, ['profile.rows.properties'])
  ) {
    fail('published M4.50 witness assignment must remain exact');
  }

  const policy = loadCanonicalizerPolicy();
  if (!same(policy.profileLimits, { maxNodeRows: 19, maxPropertyRows: 30, maxValueRows: 388 })) {
    fail('active profile must remain at the published M4.50 boundary');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR depth limits must remain at the published boundary');
  }
  return { analysis, policy };
}

export function measureCanonicalizerPropertyRowHeadroomM451() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const witnesses = [{
    belowFloorOutcome: 'failure',
    exactFloor: WITNESS_FACT.exactFloor,
    floorOutcome: 'success',
    id: WITNESS_FACT.id,
    parameterRows: WITNESS_FACT.parameterRows,
    productionHeadroom: productionMaxCollectionLength - WITNESS_FACT.exactFloor,
    profileRows: WITNESS_FACT.profileRows,
    promotionHeadroom: promotionBudget - WITNESS_FACT.exactFloor,
    roundTrip: true,
  }];
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      candidateProfile: EXPECTED_SELECTION.limits,
      productionMaxCollectionLength,
      promotionBudget,
      reservedProductionHeadroom: productionMaxCollectionLength - promotionBudget,
    },
    moduleEnvelope: {
      disposition: 'not-claimed',
      maxDepth: policy.kirLimits.maxDepth,
    },
    source: {
      canonicalizerCompositeSha256: digest(repositorySource('examples/kern-canonicalizer/canonicalizer.composed.kern')),
      canonicalizerPolicySha256: digest(readFileSync(new URL('./policy.json', import.meta.url))),
      compositionSha256: digest(readFileSync(new URL('./composition.json', import.meta.url))),
      inputSourceSha256: [{
        path: 'examples/selfhost-validator/validator.kern',
        sha256: digest(repositorySource('examples/selfhost-validator/validator.kern')),
      }],
      publishedCoverageImplementationDigest: analysis.record.baseline.coverageImplementationDigest,
      residualAnalysisSha256: analysis.digest,
      residualAnalysisSourceCommit: analysis.sourceCommit,
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
      structuralKirCodecSha256: digest(repositorySource('packages/core/src/kir-structural/canonical.ts')),
    },
    summary: {
      maxExactFloor: WITNESS_FACT.exactFloor,
      minimumProductionHeadroom: productionMaxCollectionLength - WITNESS_FACT.exactFloor,
      minimumPromotionHeadroom: promotionBudget - WITNESS_FACT.exactFloor,
      witnessCount: witnesses.length,
    },
    witnesses,
  };
}

export function validateCanonicalizerPropertyRowHeadroomM451(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerPropertyRowHeadroomM451();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.51 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match current authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerPropertyRowHeadroomM451() {
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
  const result = validateCanonicalizerPropertyRowHeadroomM451(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

export function writeCanonicalizerPropertyRowHeadroomM451() {
  const result = measureCanonicalizerPropertyRowHeadroomM451();
  writeCoverageSummary(SUMMARY_URL, result);
  return result;
}
