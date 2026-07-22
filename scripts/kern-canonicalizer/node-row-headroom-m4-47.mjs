import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM446 } from './coverage-residual-analysis-m4-46.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.node-row-headroom.1';
const RECEIPT_DIGEST = '0da8ef5be1be0ea2ac12ef739bd6cc38070d60b7b3a775f45602857d40979af1';
const SUMMARY_URL = new URL('./node-row-headroom-m4-47.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows'],
  completeFunctions: 4,
  completeTools: 3,
  limits: { maxNodeRows: 19, maxPropertyRows: 30, maxValueRows: 388 },
  totalDelta: 3,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#12:isIndexRebound',
    'examples/capstone-checker-subset/checker.kern#9:isUserCallable',
    'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern#4:validinteger',
    'examples/selfhost-validator/validator.kern#3:isportable',
  ],
};
const SOURCE_PATHS = [
  'examples/capstone-checker-subset/checker.kern',
  'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
  'examples/selfhost-validator/validator.kern',
];
const WITNESS_FACTS = [
  {
    exactFloor: 8_303,
    id: EXPECTED_SELECTION.witnesses[0],
    parameterRows: 6,
    profileRows: { nodes: 17, properties: 26, values: 152 },
  },
  {
    exactFloor: 10_361,
    id: EXPECTED_SELECTION.witnesses[1],
    parameterRows: 4,
    profileRows: { nodes: 19, properties: 26, values: 185 },
  },
  {
    exactFloor: 15_236,
    id: EXPECTED_SELECTION.witnesses[2],
    parameterRows: 1,
    profileRows: { nodes: 19, properties: 28, values: 290 },
  },
  {
    exactFloor: 10_591,
    id: EXPECTED_SELECTION.witnesses[3],
    parameterRows: 1,
    profileRows: { nodes: 18, properties: 24, values: 217 },
  },
];

function fail(message) {
  throw new TypeError(`coverage M4.47 node-row headroom rejection: ${message}`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('headroom arrays must use the plain prototype');
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
    if (Object.getPrototypeOf(value) !== Object.prototype) fail('headroom objects must use the plain prototype');
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
  const analysis = loadPublishedCanonicalizerResidualAnalysisM446();
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.46 selection must remain exact');
  }
  const selectedAssignments = analysis.record.assignments.filter(({ id }) =>
    EXPECTED_SELECTION.witnesses.includes(id));
  if (
    selectedAssignments.length !== WITNESS_FACTS.length ||
    selectedAssignments.reduce((total, { parameterRows }) => total + parameterRows, 0) !== 12
  ) {
    fail('published M4.46 witness assignments must remain exact');
  }
  for (const expected of WITNESS_FACTS) {
    const assignment = selectedAssignments.find(({ id }) => id === expected.id);
    if (
      assignment === undefined || assignment.parameterRows !== expected.parameterRows ||
      !same(assignment.profileRows, expected.profileRows)
    ) {
      fail(`published M4.46 witness ${expected.id} must remain exact`);
    }
  }

  const policy = loadCanonicalizerPolicy();
  if (!same(policy.profileLimits, { maxNodeRows: 16, maxPropertyRows: 30, maxValueRows: 388 })) {
    fail('active profile must remain at the published M4.46 boundary');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR depth limits must remain at the published boundary');
  }
  return { analysis, policy };
}

export function measureCanonicalizerNodeRowHeadroomM447() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const witnesses = WITNESS_FACTS.map((witness) => ({
    belowFloorOutcome: 'failure',
    exactFloor: witness.exactFloor,
    floorOutcome: 'success',
    id: witness.id,
    parameterRows: witness.parameterRows,
    productionHeadroom: productionMaxCollectionLength - witness.exactFloor,
    profileRows: witness.profileRows,
    promotionHeadroom: promotionBudget - witness.exactFloor,
    roundTrip: true,
  }));
  const maxExactFloor = Math.max(...witnesses.map(({ exactFloor }) => exactFloor));
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
      knownDepthBlocker: EXPECTED_SELECTION.witnesses[3],
      maxDepth: policy.kirLimits.maxDepth,
      moduleCodecSha256: digest(repositorySource('packages/core/src/kir-structural/module-canonical.ts')),
    },
    source: {
      canonicalizerCompositeSha256: digest(repositorySource('examples/kern-canonicalizer/canonicalizer.composed.kern')),
      canonicalizerPolicySha256: digest(readFileSync(new URL('./policy.json', import.meta.url))),
      compositionSha256: digest(readFileSync(new URL('./composition.json', import.meta.url))),
      inputSourceSha256: SOURCE_PATHS.map((path) => ({ path, sha256: digest(repositorySource(path)) })),
      publishedCoverageImplementationDigest: analysis.record.baseline.coverageImplementationDigest,
      residualAnalysisSha256: analysis.digest,
      residualAnalysisSourceCommit: analysis.sourceCommit,
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

export function validateCanonicalizerNodeRowHeadroomM447(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerNodeRowHeadroomM447();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.47 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match current authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerNodeRowHeadroomM447() {
  const path = fileURLToPath(SUMMARY_URL);
  let stat;
  let source;
  try {
    stat = lstatSync(path);
    source = readFileSync(path);
  } catch {
    fail('headroom receipt must exist');
  }
  if (!stat.isFile() || realpathSync(path) !== path) {
    fail('headroom receipt must be a regular non-symlink file');
  }
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('headroom receipt must be valid JSON');
  }
  const result = validateCanonicalizerNodeRowHeadroomM447(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}
