import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerRuntimeCostM497 } from './runtime-cost-m4-97.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.5';
const RECEIPT_DIGEST = '21ab630c3c937ee62d15fadfcec9faee80cf87a2d7eb6fdee7c41b3723efc201';
const SUMMARY_URL = new URL('./runtime-cost-m4-98.json', import.meta.url);
const M497_RECEIPT_DIGEST =
  '9b0d7ce9b03c1b8f54e701172c66cb3b834fa9476e346d8ba25e82bf21549e71';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk';
// This authenticates the M4.98-era limits, not the live policy after M4.99 promotion.
const PUBLISHED_POLICY = {
  kirLimits: { maxDepth: 64 },
  profileLimits: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
  runtimeLimits: { maxCollectionLength: 65_536 },
};
const SOURCE_DIGESTS = {
  compositeSha256: '983eed5c8841b0cdf41a0b678734f2457c97545a88607969acc9fd4dcc1fc807',
  compositionRecordSha256: 'f3ce080a976c8764a68417b9845deaa47bb30515e260d48fd415f1ea621a824a',
  expressionHelpersSha256: '47c72251301f56db86b84e80dcfa6d88915855ff717b1aacac87648593a2b0f4',
  mainSourceSha256: '2980bbec0ba1d835983ea3f5ca5497aa28e110650d68225502d4be92f8b52d68',
  measurementHarnessSha256: 'c314c15dc7e9fc722dc128b6bc849eb116f59fb108fa18d7bcd5ca58c874bcd0',
  measurementOwnerSha256: '629c291e670c0bd645e8bfd8b4ddc1ad6009383b71e7b6c5c7ffb88af5d57f58',
};
const SOURCE_URLS = {
  compositeSha256: new URL(
    '../../examples/kern-canonicalizer/canonicalizer.composed.kern',
    import.meta.url,
  ),
  compositionRecordSha256: new URL('./composition.json', import.meta.url),
  expressionHelpersSha256: new URL(
    '../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern',
    import.meta.url,
  ),
  mainSourceSha256: new URL(
    '../../examples/kern-canonicalizer/canonicalizer.kern',
    import.meta.url,
  ),
  measurementHarnessSha256: new URL('./runtime-cost-m4-97-measure.mjs', import.meta.url),
  measurementOwnerSha256: new URL('./runtime-cost-m4-98-measure.mjs', import.meta.url),
};

function fail(message) {
  throw new TypeError(`coverage M4.98 runtime-cost rejection: ${message}`);
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
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key === 'symbol') ||
      keys.length !== value.length + 1 ||
      Object.keys(value).some((key, index) => key !== String(index))
    ) {
      fail('receipt arrays must be dense and undecorated');
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        fail('receipt arrays must contain plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('receipt objects must use the plain prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('receipt objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      fail('receipt objects must contain plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  const m497Bytes = readFileSync(new URL('./runtime-cost-m4-97.json', import.meta.url));
  if (digest(m497Bytes) !== M497_RECEIPT_DIGEST) fail('M4.97 receipt bytes must remain exact');
  const m497 = loadCanonicalizerRuntimeCostM497();
  if (
    m497.witness.id !== WITNESS_ID ||
    m497.result.exactFloor !== 53_086 ||
    m497.promotion.nextMilestone !== 'M4.98' ||
    m497.promotion.profilePromotionApproved
  ) {
    fail('M4.97 runtime-cost handoff must remain exact');
  }
  for (const [name, expected] of Object.entries(SOURCE_DIGESTS)) {
    if (digest(readFileSync(SOURCE_URLS[name])) !== expected) {
      fail(`${name} source identity must remain exact`);
    }
  }
  const policy = structuredClone(PUBLISHED_POLICY);
  if (
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.kirLimits.maxDepth !== 64 ||
    JSON.stringify(policy.profileLimits) !== JSON.stringify({
      maxNodeRows: 74,
      maxPropertyRows: 77,
      maxValueRows: 580,
    })
  ) {
    fail('active profile and runtime/KIR limits must remain unchanged');
  }
  return { m497, policy };
}

function floorObservation(iterationBudget, outcome, publicParityVerified) {
  return {
    cache: { hits: 4_893, misses: 4_260 },
    cacheKeyCodeUnits: { maximum: 32_003, total: 38_906_648 },
    expressionsources: { executions: 1, preparations: 36 },
    frameSuspensions: 1_817,
    iterationBudget,
    loopIterations: { attempted: iterationBudget, retained: iterationBudget, rolledBack: 0 },
    outcome,
    propertyHelpers: { propcountExecutions: 53, propidExecutions: 96 },
    publicParityVerified,
    selectedFrameSuspensions: {
      'expressionsources->numberat': 27,
      'expressionsources->quotesource': 10,
      'expressionsources->stringat': 1_165,
      'expressionsources->validbinaryop': 3,
      'expressionsources->validexpressionidentifier': 36,
    },
  };
}

export function measureCanonicalizerRuntimeCostM498() {
  const { m497, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const exactFloor = 46_381;
  const priorFloor = m497.result.exactFloor;
  return {
    baseline: {
      implementationBaseCommit: '98b023acb48a69deb92c6c3407d948099388517b',
      m497ReceiptSha256: M497_RECEIPT_DIGEST,
      priorExactFloor: priorFloor,
      priorPromotionBudgetDeficit: m497.result.promotionBudgetDeficit,
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(policy.profileLimits),
      candidateProfile: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
      maxDepth: policy.kirLimits.maxDepth,
      productionMaxCollectionLength,
      promotionBudget,
    },
    observations: [
      floorObservation(exactFloor - 1, 'failure', false),
      floorObservation(exactFloor, 'success', true),
    ],
    optimization: {
      logicalLoopReduction: priorFloor - exactFloor,
      propertyLoopUpperBoundBefore: 14_155,
      propertyOrderAuthenticated: true,
      runtimeEngineChanged: false,
      strategy: 'authenticate-nondecreasing-property-owners-and-exit-passed-owner',
    },
    promotion: {
      disposition: 'promotion-budget-headroom-authenticated',
      nextMilestone: 'M4.99',
      profilePromotionApproved: false,
      promotionReady: true,
    },
    result: {
      belowFloor: exactFloor - 1,
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      floorReduction: priorFloor - exactFloor,
      productionHeadroom: productionMaxCollectionLength - exactFloor,
      promotionBudgetHeadroom: promotionBudget - exactFloor,
      roundTrip: true,
    },
    source: {
      ...structuredClone(SOURCE_DIGESTS),
      runtimeHandlerAbi: KERN_RUNTIME_HANDLER_ABI,
    },
    witness: {
      id: WITNESS_ID,
      parameterRows: 24,
      structuralRows: { nodes: 53, properties: 95, values: 832 },
    },
  };
}

export function validateCanonicalizerRuntimeCostM498(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerRuntimeCostM498();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.98 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM498() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (stat === undefined || !stat.isFile()) fail('receipt must be a regular non-symlink file');
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('receipt must be valid JSON');
  }
  const result = validateCanonicalizerRuntimeCostM498(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerRuntimeCostM498());
}
