import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM454 } from './coverage-residual-analysis-m4-54.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';

const FORMAT = 'kern.kir-canonicalizer.dual-row-headroom.1';
const RECEIPT_DIGEST = '10e36abdda5e7de48c65689f9d2a318a6095497bdd3cff81aa64e3ab4e6e535b';
const SUMMARY_URL = new URL('./dual-row-headroom-m4-55.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows'],
  completeFunctions: 7,
  completeTools: 4,
  limits: { maxNodeRows: 25, maxPropertyRows: 50, maxValueRows: 388 },
  totalDelta: 25,
  witnesses: [
    'examples/capstone-assertion-engine/compare.kern#4:compareNode',
    'examples/capstone-checker-subset/checker-while.kern#14:literalTrue',
    'examples/capstone-checker-subset/checker-while.kern#17:checkerWhileRejectDetail',
    'examples/capstone-checker-subset/checker.kern#14:termProvenanced',
    'examples/capstone-checker-subset/checker.kern#6:whileRejectDetail',
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#3:emitstatementlist',
    'examples/selfhost-validator/validator.kern#11:owncallable',
  ],
};
const WITNESS_FACTS = [
  {
    exactFloor: 26_356,
    id: EXPECTED_SELECTION.witnesses[0],
    parameterRows: 13,
    profileRows: { nodes: 24, properties: 39, values: 373 },
    tool: 'assertion-engine',
  },
  {
    exactFloor: 15_094,
    id: EXPECTED_SELECTION.witnesses[1],
    parameterRows: 7,
    profileRows: { nodes: 23, properties: 33, values: 244 },
    tool: 'checker',
  },
  {
    exactFloor: 19_763,
    id: EXPECTED_SELECTION.witnesses[2],
    parameterRows: 22,
    profileRows: { nodes: 25, properties: 49, values: 189 },
    tool: 'checker',
  },
  {
    exactFloor: 17_423,
    id: EXPECTED_SELECTION.witnesses[3],
    parameterRows: 11,
    profileRows: { nodes: 24, properties: 36, values: 237 },
    tool: 'checker',
  },
  {
    exactFloor: 19_622,
    id: EXPECTED_SELECTION.witnesses[4],
    parameterRows: 22,
    profileRows: { nodes: 25, properties: 48, values: 188 },
    tool: 'checker',
  },
  {
    exactFloor: 21_985,
    id: EXPECTED_SELECTION.witnesses[5],
    parameterRows: 15,
    profileRows: { nodes: 25, properties: 50, values: 235 },
    tool: 'canonicalizer',
  },
  {
    exactFloor: 17_931,
    id: EXPECTED_SELECTION.witnesses[6],
    parameterRows: 12,
    profileRows: { nodes: 24, properties: 42, values: 212 },
    tool: 'validator',
  },
];

function fail(message) {
  throw new TypeError(`coverage M4.55 dual-row headroom rejection: ${message}`);
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
  const analysis = loadPublishedCanonicalizerResidualAnalysisM454();
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.54 selection must remain exact');
  }
  for (const fact of WITNESS_FACTS) {
    const assignment = analysis.record.assignments.find(({ id }) => id === fact.id);
    if (
      assignment === undefined ||
      assignment.parameterRows !== fact.parameterRows ||
      assignment.tool !== fact.tool ||
      !same(assignment.profileRows, fact.profileRows) ||
      !same(assignment.reasons, ['profile.rows.nodes', 'profile.rows.properties'])
    ) {
      fail(`published M4.54 witness assignment must remain exact for ${fact.id}`);
    }
  }

  const policy = loadCanonicalizerPolicy();
  if (!same(policy.profileLimits, { maxNodeRows: 19, maxPropertyRows: 31, maxValueRows: 388 })) {
    fail('active profile must remain at the published M4.54 boundary');
  }
  if (policy.runtimeLimits.maxCollectionLength !== 65_536 || policy.kirLimits.maxDepth !== 64) {
    fail('runtime and KIR depth limits must remain at the published boundary');
  }
  return { analysis, policy };
}

export function measureCanonicalizerDualRowHeadroomM455() {
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

export function validateCanonicalizerDualRowHeadroomM455(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerDualRowHeadroomM455();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.55 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerDualRowHeadroomM455() {
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
  const result = validateCanonicalizerDualRowHeadroomM455(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

export function writeCanonicalizerDualRowHeadroomM455() {
  const result = measureCanonicalizerDualRowHeadroomM455();
  writeCoverageSummary(SUMMARY_URL, result);
  return result;
}
