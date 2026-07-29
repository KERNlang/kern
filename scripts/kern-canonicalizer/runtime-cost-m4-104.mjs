import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadHistoricalCanonicalizerPolicy } from './historical-policy.mjs';
import { loadCanonicalizerRuntimeBottleneckM4103 } from './runtime-bottleneck-m4-103.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.6';
const RECEIPT_DIGEST = 'eace33240c8425569685d76530e4b59ec5b07fa874572a93458ea5e17f84ec92';
const SUMMARY_URL = new URL('./runtime-cost-m4-104.json', import.meta.url);
const M4103_RECEIPT_DIGEST =
  'a8f80c8d63cbaba2ff6d5d579d347ff9c489719e8f5170a95acadfbbfcd19488';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement';
const SOURCE_DIGESTS = {
  canonicalizerCompositeSha256:
    '9fb89f33f5b76d5b177d20318357c56a9624d4199915f877e78cd313f22bc13d',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    '0e4b18086df8f0a6cabaa7b9daaa80acad34bea1badf361ab1649f7bf8f35789',
  expressionHelpersSha256:
    '3c0c38daa48946926f28a797bb38f3f45291f12dd90656989dbd587819d828e3',
  mainSourceSha256:
    '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195',
  measurementSha256:
    '876db33173e52f3a24647f75596f041b61174003fcefd2dffef7b120e43f7459',
  runtimePolicySha256:
    '687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09',
  statementHelpersSha256:
    'a91390500b1d7e2bb3749d537001eb49d64fa809bd22fae13763b2e6c21f716c',
};
function fail(message) {
  throw new TypeError(`coverage M4.104 runtime-cost rejection: ${message}`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('receipt arrays must use the plain prototype');
    }
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
  const m4103Bytes = readFileSync(new URL('./runtime-bottleneck-m4-103.json', import.meta.url));
  if (digest(m4103Bytes) !== M4103_RECEIPT_DIGEST) fail('M4.103 receipt bytes must remain exact');
  const m4103 = loadCanonicalizerRuntimeBottleneckM4103();
  if (
    m4103.witness.id !== WITNESS_ID ||
    m4103.limits.exactFloor !== 72_195 ||
    m4103.limits.productionMaxCollectionLength !== 65_536 ||
    m4103.limits.promotionBudget !== 49_152 ||
    m4103.promotion.profilePromotionApproved
  ) {
    fail('M4.103 runtime-bottleneck handoff must remain exact');
  }
  const policy = loadHistoricalCanonicalizerPolicy({
    expectedDigest: SOURCE_DIGESTS.runtimePolicySha256,
    kirLimitOverrides: {
      maxBytes: 262_144,
      maxDepth: 64,
      maxNodes: 4_096,
    },
    milestone: 'M4.104',
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
  return { m4103, policy };
}

function observation(iterationBudget, outcome, forIterations) {
  return {
    cache: { hits: 8_603, misses: 8_682 },
    cacheKeyCodeUnits: { maximum: 79_416, total: 203_553_701 },
    iterationBudget,
    loopIterations: {
      attemptedByType: { for: forIterations, while: 104 },
      retained: iterationBudget,
      rolledBack: 0,
    },
    observerParityVerified: true,
    outcome,
    parentRestartCount: 0,
    roundTrip: outcome === 'success',
    selectedHelperExecutions: {
      childat: 89,
      childcount: 90,
      emitstatement: 73,
      emitstatementlist: 27,
      quotesource: 65,
      validstatement: 73,
      validstatementlist: 27,
    },
  };
}

export function buildCanonicalizerRuntimeCostM4104() {
  const { m4103, policy } = exactInputs();
  const exactFloor = 62_830;
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  return {
    baseline: {
      implementationBaseCommit: '7c341bb2ece7900617ea16715bf881650624fcf8',
      m4103ReceiptSha256: M4103_RECEIPT_DIGEST,
      priorExactFloor: m4103.limits.exactFloor,
      priorProductionCeilingDeficit: m4103.baseline.productionCeilingDeficit,
      priorPromotionBudgetDeficit: m4103.baseline.promotionBudgetDeficit,
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
      observation(exactFloor - 1, 'failure', 62_725),
      observation(exactFloor, 'success', 62_726),
    ],
    optimization: {
      exactFloorReduction: m4103.limits.exactFloor - exactFloor,
      parentBeforeChildAuthenticated: true,
      quoteEscapeLoopIterations: 104,
      runtimeEngineChanged: false,
      strategy:
        'sparse-validated-source-quoting-with-dense-backslash-fallback-and-parent-bounded-child-lookup',
    },
    promotion: {
      disposition: 'production-headroom-authenticated-promotion-budget-no-go',
      nextMilestone: 'M4.105',
      profilePromotionApproved: false,
      promotionReady: false,
    },
    result: {
      belowFloor: exactFloor - 1,
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      floorReduction: m4103.limits.exactFloor - exactFloor,
      productionHeadroom: productionMaxCollectionLength - exactFloor,
      promotionBudgetDeficit: exactFloor - promotionBudget,
      roundTrip: true,
    },
    source: {
      ...structuredClone(SOURCE_DIGESTS),
      runtimeHandlerAbi: 'kern.runtime.handler.v1',
    },
    witness: {
      id: WITNESS_ID,
      parameterRows: 14,
      structuralRows: { nodes: 89, properties: 125, values: 2_100 },
    },
  };
}

export function validateCanonicalizerRuntimeCostM4104(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeCostM4104();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.104 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM4104() {
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
  const result = validateCanonicalizerRuntimeCostM4104(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeCostM4104());
}
