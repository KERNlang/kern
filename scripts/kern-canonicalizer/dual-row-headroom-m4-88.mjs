import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadPublishedCanonicalizerResidualAnalysisM487 } from './coverage-residual-analysis-m4-87.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';

const FORMAT = 'kern.kir-canonicalizer.dual-row-headroom.4';
const RECEIPT_DIGEST = '285b42785be8f651d323444ddd3464381b337b74557bbd07e8c3f4bad02a89bb';
const SUMMARY_URL = new URL('./dual-row-headroom-m4-88.json', import.meta.url);
const EXPECTED_SELECTION = {
  changedLimits: ['maxNodeRows', 'maxPropertyRows'],
  completeFunctions: 3,
  completeTools: 2,
  limits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
  totalDelta: 52,
  witnesses: [
    'examples/capstone-checker-subset/checker.kern#18:indexRejectDetail',
    'examples/capstone-checker-subset/checker.kern#23:callRejectCode',
    'examples/selfhost-validator/validator.kern#2:isreserved',
  ],
};
const PUBLISHED_INPUT = {
  canonicalizerCompositeSha256: 'fe5087dfcb79898a4b5d46cd233a2bbbeea156417f18ac314e87330172e31b28',
  canonicalizerPolicySha256: 'a929434c674ecbed5688eb36235f81c203d5d0eb4a34583554caad116960614c',
  commit: 'e7933c9d09bbeab9e6f41221370cb608cbf8a278',
  compositionSha256: '894cf14bc391d3109a20fb6abef8d1c98cab426e2ed6d238d414c8aee46cff3b',
  coverageImplementationDigest: '0d34962bf373ba4a9f47a7afb5ec4044ba2e426a3370e1deaf92cee1ca56253a',
  coveragePolicySha256: '4ac57e59be2bcdb7b9aa0f7f35598703600bf47b4f17709e59c5823c0e605490',
  coverageSummarySha256: 'cc34bcc0d17f9cfa3f173eb9ee8fcbaef174e093f5880c63ecef0f87ae9caf13',
  inputSourceSha256: [
    {
      path: 'examples/capstone-checker-subset/checker.kern',
      sha256: 'a04a2242cb7762b9753f16e49cc0b849eadd736d2d1667d691d267603394ad59',
    },
    {
      path: 'examples/selfhost-validator/validator.kern',
      sha256: 'a9d278832edf050f3a96699980d88fa740f345d85192222b241bb6cc3ac2a2ee',
    },
  ],
  prerequisiteSummarySha256: 'fe6eb4b314e718696e04c9127ebaea1f232d2b993737d4eba1bf17d5a17c5076',
  structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const PUBLISHED_POLICY = {
  kirLimits: { maxDepth: 64 },
  profileLimits: { maxNodeRows: 38, maxPropertyRows: 61, maxValueRows: 580 },
  runtimeLimits: { maxCollectionLength: 65_536 },
};
const WITNESS_FACTS = [
  {
    exactFloor: 36_229,
    id: EXPECTED_SELECTION.witnesses[0],
    parameterRows: 24,
    profileRows: { nodes: 41, properties: 67, values: 404 },
    tool: 'checker',
  },
  {
    exactFloor: 51_321,
    id: EXPECTED_SELECTION.witnesses[1],
    parameterRows: 15,
    profileRows: { nodes: 47, properties: 64, values: 478 },
    tool: 'checker',
  },
  {
    exactFloor: 107_594,
    id: EXPECTED_SELECTION.witnesses[2],
    parameterRows: 1,
    profileRows: { nodes: 74, properties: 77, values: 572 },
    tool: 'validator',
  },
];

function fail(message) {
  throw new TypeError(`coverage M4.88 dual-row headroom rejection: ${message}`);
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
  const analysis = loadPublishedCanonicalizerResidualAnalysisM487();
  if (analysis.digest !== '9046716d876c336140b567a8a40a9b52750106b2ac5db66f38f7621e935c203a') {
    fail('published M4.87 receipt digest must remain exact');
  }
  if (analysis.inputCommit !== '46337a6549390087ef095c18d0e178cf9ef28392') {
    fail('published M4.87 residual input commit must remain exact');
  }
  if (!same(analysis.record.selectedNextAction, EXPECTED_SELECTION)) {
    fail('published M4.87 selection must remain exact');
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
      fail(`published M4.87 witness assignment must remain exact for ${fact.id}`);
    }
  }
  return { analysis, policy: structuredClone(PUBLISHED_POLICY) };
}

export function measureCanonicalizerDualRowHeadroomM488() {
  const { analysis, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const maxExactFloor = Math.max(...WITNESS_FACTS.map(({ exactFloor }) => exactFloor));
  const productionCeilingDeficit = maxExactFloor - productionMaxCollectionLength;
  const promotionBudgetDeficit = maxExactFloor - promotionBudget;
  if (productionCeilingDeficit <= 0 || promotionBudgetDeficit <= 0) {
    fail('production-ceiling NO-GO requires both deficits to remain positive');
  }
  const witnesses = WITNESS_FACTS.map((fact) => ({
    belowFloorOutcome: 'failure',
    exactFloor: fact.exactFloor,
    floorOutcome: 'success',
    id: fact.id,
    parameterRows: fact.parameterRows,
    productionDelta: productionMaxCollectionLength - fact.exactFloor,
    productionOutcome: fact.exactFloor <= productionMaxCollectionLength ? 'success' : 'failure',
    profileRows: structuredClone(fact.profileRows),
    promotionDelta: promotionBudget - fact.exactFloor,
    roundTrip: true,
  }));
  return {
    artifactScope: 'structural-kir-function',
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(policy.profileLimits),
      candidateProfile: structuredClone(EXPECTED_SELECTION.limits),
      diagnosticMaxCollectionLength: maxExactFloor,
      productionMaxCollectionLength,
      promotionBudget,
      reservedProductionHeadroom: productionMaxCollectionLength - promotionBudget,
    },
    measurement: { disposition: 'diagnostic-only', runtimePolicyChanged: false },
    moduleEnvelope: { disposition: 'not-claimed', maxDepth: policy.kirLimits.maxDepth },
    promotion: {
      disposition: 'rejected-over-production-ceiling',
      nextMilestone: 'M4.89',
      productionCeilingDeficit,
      promotionBudgetDeficit,
      requiredFloorReduction: promotionBudgetDeficit,
    },
    source: {
      canonicalizerCompositeSha256: PUBLISHED_INPUT.canonicalizerCompositeSha256,
      canonicalizerPolicySha256: PUBLISHED_INPUT.canonicalizerPolicySha256,
      compositionSha256: PUBLISHED_INPUT.compositionSha256,
      coveragePolicySha256: PUBLISHED_INPUT.coveragePolicySha256,
      inputSourceSha256: structuredClone(PUBLISHED_INPUT.inputSourceSha256),
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
      maxExactFloor,
      productionCeilingDeficit,
      promotionBudgetDeficit,
      totalParameterRows: witnesses.reduce((total, { parameterRows }) => total + parameterRows, 0),
      witnessCount: witnesses.length,
    },
    witnesses,
  };
}

export function validateCanonicalizerDualRowHeadroomM488(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerDualRowHeadroomM488();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.88 receipt digest');
  }
  if (!same(value, expected)) fail('headroom receipt must match authenticated evidence exactly');
  return structuredClone(value);
}

export function loadCanonicalizerDualRowHeadroomM488() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined) fail('headroom receipt must exist');
  if (!stat.isFile()) {
    fail('headroom receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('headroom receipt must be valid JSON');
  }
  const result = validateCanonicalizerDualRowHeadroomM488(parsed);
  if (!source.equals(canonicalBytes(result))) fail('headroom receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerDualRowHeadroomM488());
}
