import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestPreM4135CompiledCoreJavaScript } from './coverage-dependencies.mjs';
import {
  PRE_M4129_M4106_MEASUREMENT_REPLACEMENTS,
} from './assignment-target-projection-target.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadHistoricalCanonicalizerComposition } from './historical-composition.mjs';
import { loadHistoricalCanonicalizerPolicy } from './historical-policy.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { loadCanonicalizerRuntimeBottleneckM4105 } from './runtime-bottleneck-m4-105.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.7';
const RECEIPT_DIGEST = '827525373e1716137b53e322c913ec7dcb4f8ea0cd12dc1d8d77605c692a886a';
const SUMMARY_URL = new URL('./runtime-cost-m4-106.json', import.meta.url);
const M4105_RECEIPT_DIGEST =
  '06538ef420d2374ecf39f5b12d775189c73cfa11a66a3ef460cf795c273db7e0';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement';
export const M4106_SOURCE_DIGESTS = {
  canonicalizerCompositeSha256:
    'c68131992b98a4c2a78b9404f537180e1959e88a3116d5513d989ea7a1418f47',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    '11b218a5477fc6c4e7d2b8fd0f9c8c208facd472f300e214c25f83bb5799770c',
  expressionHelpersSha256:
    'bdb40cb0006af0e92b3a4383c7c71a3df7e417fda1569a1860d8f9a65d08ee52',
  mainSourceSha256:
    '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195',
  measurementSha256:
    '0c847478ae7f774b9fdd79ad830116b8ebc6e769bc39b11f4f7ba3097d3b3d30',
  runtimePolicySha256:
    '687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09',
  statementHelpersSha256:
    'fd2dc3cddf57509244dfc4210bbcc106727a80422b379cfd21d09ee90e1d67b2',
};
const MEASUREMENT_URL = new URL('./runtime-cost-m4-106-measure.mjs', import.meta.url);
const MEASUREMENT_REPLACEMENTS = [
  {
    current:
      "import assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';",
    historical:
      "import assert from 'node:assert/strict';\nimport { createHash } from 'node:crypto';\nimport { readFileSync } from 'node:fs';",
  },
  {
    current: "import { assertValidstatementDirectRoot } from './validstatement-target.mjs';\n",
    historical: '',
  },
  {
    current:
      "  new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url);\nconst PROFILE_ROWS",
    historical:
      "  new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url);\nconst WITNESS_SOURCE_SHA256 =\n  'fd2dc3cddf57509244dfc4210bbcc106727a80422b379cfd21d09ee90e1d67b2';\nconst PROFILE_ROWS",
  },
  {
    current:
      '  const source = readFileSync(WITNESS_SOURCE_URL);\n  const parsed = parseDocumentWithDiagnostics',
    historical:
      "  const source = readFileSync(WITNESS_SOURCE_URL);\n  assert.equal(createHash('sha256').update(source).digest('hex'), WITNESS_SOURCE_SHA256);\n  const parsed = parseDocumentWithDiagnostics",
  },
  {
    current: '  assertValidstatementDirectRoot(sourceRoot);',
    historical:
      "  assert.equal(sourceRoot?.type, 'fn');\n  assert.equal(sourceRoot?.props?.name, 'validstatement');",
  },
];

function fail(message) {
  throw new TypeError(`coverage M4.106 runtime-cost rejection: ${message}`);
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertPlainReceiptData(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('receipt data must contain only finite numbers');
    return;
  }
  if (typeof value !== 'object') fail('receipt data must contain only JSON values');
  if (seen.has(value)) fail('receipt data must not contain cycles or shared references');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('receipt arrays must use the plain prototype');
    const ownKeys = Reflect.ownKeys(value);
    const enumerableKeys = Object.keys(value);
    if (
      ownKeys.some((key) => typeof key === 'symbol') ||
      ownKeys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length
    ) {
      fail('receipt arrays must be dense and undecorated');
    }
    for (const [index, key] of enumerableKeys.entries()) {
      if (key !== String(index)) fail('receipt arrays must contain only canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt arrays must contain plain enumerable data elements');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail('receipt objects must use the plain prototype');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('receipt objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('receipt objects must contain plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  const m4105Bytes = readFileSync(new URL('./runtime-bottleneck-m4-105.json', import.meta.url));
  if (digest(m4105Bytes) !== M4105_RECEIPT_DIGEST) fail('M4.105 receipt bytes must remain exact');
  const m4105 = loadCanonicalizerRuntimeBottleneckM4105();
  if (
    m4105.witness.id !== WITNESS_ID ||
    m4105.limits.exactFloor !== 62_830 ||
    m4105.limits.productionMaxCollectionLength !== 65_536 ||
    m4105.limits.promotionBudget !== 49_152 ||
    m4105.promotion.profilePromotionApproved
  ) {
    fail('M4.105 runtime-bottleneck handoff must remain exact');
  }
  if (digestPreM4135CompiledCoreJavaScript() !== M4106_SOURCE_DIGESTS.compiledCoreJavaScriptSha256) {
    fail('compiled core JavaScript executed by the measurement must remain exact');
  }
  loadHistoricalCanonicalizerComposition({
    expectedDigests: {
      canonicalizerCompositeSha256: M4106_SOURCE_DIGESTS.canonicalizerCompositeSha256,
      compositionRecordSha256: M4106_SOURCE_DIGESTS.compositionRecordSha256,
      expressionHelpersSha256: M4106_SOURCE_DIGESTS.expressionHelpersSha256,
      mainSourceSha256: M4106_SOURCE_DIGESTS.mainSourceSha256,
      statementHelpersSha256: M4106_SOURCE_DIGESTS.statementHelpersSha256,
    },
    milestone: 'M4.106',
  });
  reconstructHistoricalSource({
    currentSource: readFileSync(MEASUREMENT_URL),
    expectedDigest: M4106_SOURCE_DIGESTS.measurementSha256,
    milestone: 'M4.106 measurement',
    replacements: [
      ...PRE_M4129_M4106_MEASUREMENT_REPLACEMENTS,
      ...MEASUREMENT_REPLACEMENTS,
    ],
  });
  const policy = loadHistoricalCanonicalizerPolicy({
    expectedDigest: M4106_SOURCE_DIGESTS.runtimePolicySha256,
    kirLimitOverrides: {
      maxBytes: 262_144,
      maxDepth: 64,
      maxNodes: 4_096,
    },
    milestone: 'M4.106',
    profileLimits: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
    runtimeLimitOverrides: {
      maxBytes: 2_097_152,
      maxStringBytes: 1_048_576,
    },
  });
  if (
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.kirLimits.maxDepth !== 64 ||
    JSON.stringify(policy.profileLimits) !== JSON.stringify({
      maxNodeRows: 74,
      maxPropertyRows: 95,
      maxValueRows: 832,
    })
  ) {
    fail('active profile and runtime/KIR limits must remain unchanged');
  }
  return { m4105, policy };
}

function observation(iterationBudget, outcome, forIterations) {
  return {
    cache: { hits: 8_429, misses: 8_864 },
    cacheKeyCodeUnits: { maximum: 70_828, total: 170_165_093 },
    iterationBudget,
    loopIterations: {
      attemptedByType: { for: forIterations, while: 93 },
      retained: iterationBudget,
      rolledBack: 0,
    },
    observerParityVerified: true,
    outcome,
    parentRestartCount: 0,
    roundTrip: outcome === 'success',
    selectedHelperExecutions: {
      childat: 89,
      childcount: 17,
      emitstatement: 73,
      emitstatementlist: 27,
      numberat: 661,
      propcount: 16,
      propid: 32,
      statementfacts: 74,
      statementtablefacts: 1,
      validstatement: 73,
      validstatementlist: 27,
    },
  };
}

export function buildCanonicalizerRuntimeCostM4106() {
  const { m4105, policy } = exactInputs();
  const exactFloor = 39_016;
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  return {
    baseline: {
      implementationBaseCommit: '80c67172d02cc4983855874aa29098a770820953',
      m4105ReceiptSha256: M4105_RECEIPT_DIGEST,
      priorExactFloor: m4105.limits.exactFloor,
      priorPromotionBudgetDeficit: m4105.diagnosis.additionalRetainedIterations,
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(policy.profileLimits),
      candidateProfile: { maxNodeRows: 89, maxPropertyRows: 125, maxValueRows: 2_100 },
      exactFloor,
      maxDepth: policy.kirLimits.maxDepth,
      productionMaxCollectionLength,
      promotionBudget,
    },
    observations: [
      observation(exactFloor - 1, 'failure', 38_922),
      observation(exactFloor, 'success', 38_923),
    ],
    optimization: {
      exactFloorReduction: m4105.limits.exactFloor - exactFloor,
      helperFunctionsAdded: 2,
      projectedFactSlotsPerNode: 8,
      runtimeEngineChanged: false,
      statementTableProjectionExecutions: 1,
      strategy:
        'table-wide-authenticated-statement-fact-projection-with-fixed-node-view',
    },
    promotion: {
      disposition: 'promotion-budget-headroom-authenticated',
      nextMilestone: 'M4.107',
      profilePromotionApproved: false,
      promotionReady: true,
    },
    result: {
      belowFloor: exactFloor - 1,
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      floorReduction: m4105.limits.exactFloor - exactFloor,
      productionHeadroom: productionMaxCollectionLength - exactFloor,
      promotionBudgetHeadroom: promotionBudget - exactFloor,
      roundTrip: true,
    },
    source: {
      ...structuredClone(M4106_SOURCE_DIGESTS),
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
    },
    witness: {
      id: WITNESS_ID,
      parameterRows: 14,
      structuralRows: { nodes: 89, properties: 125, values: 1_873 },
    },
  };
}

export function validateCanonicalizerRuntimeCostM4106(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeCostM4106();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.106 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM4106() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile() || realpathSync(path) !== path) {
    fail('receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('receipt must be valid JSON');
  }
  const result = validateCanonicalizerRuntimeCostM4106(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeCostM4106());
}
