import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM462 } from './coverage-residual-analysis-m4-62.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.node-row-headroom.2';
const RECEIPT_DIGEST = '110260eb3a2c9ed942e309d5b6e1331f2752bc486bfe99840c887e2a6ef7e7c3';
const SUMMARY_URL = new URL('./node-row-headroom-m4-63.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows'],
  completeFunctions: 4,
  completeTools: 2,
  limits: { maxNodeRows: 28, maxPropertyRows: 50, maxValueRows: 388 },
  totalDelta: 3,
  witnesses: [
    'examples/capstone-checker-subset/checker-while.kern#1:isSafeMagnitude',
    'examples/capstone-checker-subset/checker.kern#22:mapCallRejectDetail',
    'examples/selfhost-validator/validator.kern#10:fnokat',
    'examples/selfhost-validator/validator.kern#12:ownexportkind',
  ],
};
const WITNESS_FACTS = [
  {
    exactFloor: 21_736,
    id: EXPECTED_SELECTION.witnesses[0],
    parameterRows: 2,
    profileRows: { nodes: 27, properties: 39, values: 288 },
    tool: 'checker',
  },
  {
    exactFloor: 27_076,
    id: EXPECTED_SELECTION.witnesses[1],
    parameterRows: 13,
    profileRows: { nodes: 28, properties: 42, values: 309 },
    tool: 'checker',
  },
  {
    exactFloor: 21_825,
    id: EXPECTED_SELECTION.witnesses[2],
    parameterRows: 8,
    profileRows: { nodes: 28, properties: 38, values: 270 },
    tool: 'validator',
  },
  {
    exactFloor: 24_993,
    id: EXPECTED_SELECTION.witnesses[3],
    parameterRows: 14,
    profileRows: { nodes: 28, properties: 48, values: 260 },
    tool: 'validator',
  },
];

function fail(message) {
  throw new TypeError(`coverage M4.63 node-row headroom rejection: ${message}`);
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
  seen.delete(value);
}

function same(left, right) {
  return canonicalBytes(left).equals(canonicalBytes(right));
}

function repositorySource(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
}

function exactInputs() {
  const analysis = loadPublishedCanonicalizerResidualAnalysisM462();
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.62 selection must remain exact');
  }
  for (const fact of WITNESS_FACTS) {
    const assignment = analysis.record.assignments.find(({ id }) => id === fact.id);
    if (
      assignment === undefined ||
      assignment.parameterRows !== fact.parameterRows ||
      assignment.tool !== fact.tool ||
      !same(assignment.profileRows, fact.profileRows) ||
      !same(assignment.reasons, ['profile.rows.nodes'])
    ) {
      fail(`published M4.62 witness assignment must remain exact for ${fact.id}`);
    }
  }

  const policy = loadCanonicalizerPolicy();
  if (!same(policy.profileLimits, { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 388 })) {
    fail('active profile must remain at the published M4.62 boundary');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR depth limits must remain at the published boundary');
  }
  return { analysis, policy };
}

export function measureCanonicalizerNodeRowHeadroomM463() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const witnesses = WITNESS_FACTS.map((fact) => ({
    belowFloorOutcome: 'failure',
    exactFloor: fact.exactFloor,
    floorOutcome: 'success',
    id: fact.id,
    parameterRows: fact.parameterRows,
    productionHeadroom: productionMaxCollectionLength - fact.exactFloor,
    profileRows: fact.profileRows,
    promotionHeadroom: promotionBudget - fact.exactFloor,
    roundTrip: true,
  }));
  const maxExactFloor = Math.max(...witnesses.map(({ exactFloor }) => exactFloor));
  const inputPaths = [...new Set(EXPECTED_SELECTION.witnesses.map((id) => id.split('#')[0]))];
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      candidateProfile: EXPECTED_SELECTION.limits,
      productionMaxCollectionLength,
      promotionBudget,
      reservedProductionHeadroom: productionMaxCollectionLength - promotionBudget,
    },
    moduleEnvelope: { disposition: 'not-claimed', maxDepth: policy.kirLimits.maxDepth },
    source: {
      canonicalizerCompositeSha256: digest(repositorySource('examples/kern-canonicalizer/canonicalizer.composed.kern')),
      canonicalizerPolicySha256: digest(readFileSync(new URL('./policy.json', import.meta.url))),
      compositionSha256: digest(readFileSync(new URL('./composition.json', import.meta.url))),
      inputSourceSha256: inputPaths.map((path) => ({ path, sha256: digest(repositorySource(path)) })),
      publishedCoverageImplementationDigest: analysis.record.baseline.coverageImplementationDigest,
      residualAnalysisInputCommit: analysis.inputCommit,
      residualAnalysisSha256: analysis.digest,
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
      structuralKirCodecSha256: digest(repositorySource('packages/core/src/kir-structural/canonical.ts')),
    },
    summary: {
      maxExactFloor,
      minimumProductionHeadroom: productionMaxCollectionLength - maxExactFloor,
      minimumPromotionHeadroom: promotionBudget - maxExactFloor,
      witnessCount: witnesses.length,
    },
    witnesses,
  };
}

export function validateCanonicalizerNodeRowHeadroomM463(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerNodeRowHeadroomM463();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.63 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerNodeRowHeadroomM463() {
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
  const result = validateCanonicalizerNodeRowHeadroomM463(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

export function writeCanonicalizerNodeRowHeadroomM463() {
  const result = validateCanonicalizerNodeRowHeadroomM463(
    measureCanonicalizerNodeRowHeadroomM463(),
  );
  writeCoverageSummary(SUMMARY_URL, result);
  return result;
}
