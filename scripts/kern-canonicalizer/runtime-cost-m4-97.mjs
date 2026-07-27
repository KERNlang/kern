import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadCanonicalizerRuntimeBottleneckM496 } from './runtime-bottleneck-m4-96.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.4';
const RECEIPT_DIGEST = '9b0d7ce9b03c1b8f54e701172c66cb3b834fa9476e346d8ba25e82bf21549e71';
const SUMMARY_URL = new URL('./runtime-cost-m4-97.json', import.meta.url);
const M496_RECEIPT_DIGEST =
  '3a80e118c7621923401596d7ab16fd013067363daa88b819817c0208e2afe391';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk';
const SOURCE_DIGESTS = {
  classFrameSha256: '4e2c5ab73bb1c8906bc06f88b1d5bcb43bb524c6ff92e8d2f9fca7bc7126d3de',
  diagnosticObserverSha256: '6037e9f2e37e3888b45d64458c627c217abfd52105271de226bf47e053e495b6',
  effectMachineSha256: '3de758e08833d0881159f4716710701a605b45a0f56313bb191fabe02666e2eb',
  effectMachineTypesSha256: '909f576f295d7670d77d6bc80729b461b27f3b9d22b03333689a649925d378b6',
  expressionV1RuntimeSha256: 'c93dba68ec3bb3fb23cbab8cbd5a788d6fe582c4eabae94cb62897a7e584e6d3',
  helperRuntimeSha256: 'd3254d54b5bf2b86c89776faad6b49f073d0754c0bc10dd269ce887cd0c3229c',
  internalExpressionV1Sha256: 'eb04dd8734cd851427ece85606442e6796142a2100cea7ed248633b250b4726f',
  measurementHarnessSha256: 'e0871fd3bab09099d3159e0b00b0e0983091c52ba943ef26159ac17426db2b2e',
  measurementOwnerSha256: 'c314c15dc7e9fc722dc128b6bc849eb116f59fb108fa18d7bcd5ca58c874bcd0',
  sequenceSha256: 'fbd95b89099ceffbb6c2e8f2136620bfe51bda5bd2a22ba93de1db7743a68bfe',
};
const SOURCE_URLS = {
  classFrameSha256: new URL(
    '../../packages/core/src/ir/semantics/internal-effect-machine-class-frame.ts',
    import.meta.url,
  ),
  diagnosticObserverSha256: new URL(
    '../../packages/core/src/ir/semantics/internal-effect-machine-diagnostics.ts',
    import.meta.url,
  ),
  effectMachineSha256: new URL(
    '../../packages/core/src/ir/semantics/internal-effect-machine.ts',
    import.meta.url,
  ),
  effectMachineTypesSha256: new URL(
    '../../packages/core/src/ir/semantics/internal-effect-machine-types.ts',
    import.meta.url,
  ),
  expressionV1RuntimeSha256: new URL(
    '../../packages/core/src/ir/semantics/expression-v1-runtime.ts',
    import.meta.url,
  ),
  helperRuntimeSha256: new URL(
    '../../packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts',
    import.meta.url,
  ),
  internalExpressionV1Sha256: new URL(
    '../../packages/core/src/ir/semantics/internal-effect-machine-expression-v1.ts',
    import.meta.url,
  ),
  measurementHarnessSha256: new URL('./runtime-bottleneck-m4-96-measure.mjs', import.meta.url),
  measurementOwnerSha256: new URL('./runtime-cost-m4-97-measure.mjs', import.meta.url),
  sequenceSha256: new URL(
    '../../packages/core/src/ir/semantics/internal-effect-machine-sequence.ts',
    import.meta.url,
  ),
};

function fail(message) {
  throw new TypeError(`coverage M4.97 runtime-cost rejection: ${message}`);
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
        fail('receipt arrays must contain plain enumerable data elements');
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
  const m496Bytes = readFileSync(new URL('./runtime-bottleneck-m4-96.json', import.meta.url));
  if (digest(m496Bytes) !== M496_RECEIPT_DIGEST) fail('M4.96 receipt bytes must remain exact');
  const m496 = loadCanonicalizerRuntimeBottleneckM496();
  if (
    m496.witness.id !== WITNESS_ID ||
    m496.diagnosis.mechanism !== 'parent-frame-restart-after-nested-helper-cache-miss' ||
    m496.diagnosis.nextMilestone !== 'M4.97'
  ) {
    fail('M4.96 bottleneck handoff must remain exact');
  }
  for (const [name, expected] of Object.entries(SOURCE_DIGESTS)) {
    if (digest(readFileSync(SOURCE_URLS[name])) !== expected) {
      fail(`${name} source identity must remain exact`);
    }
  }
  const policy = loadCanonicalizerPolicy();
  if (
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.kirLimits.maxDepth !== 64
  ) {
    fail('runtime and KIR limits must remain unchanged');
  }
  return { m496, policy };
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

export function measureCanonicalizerRuntimeCostM497() {
  const { m496, policy } = exactInputs();
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  const exactFloor = 53_086;
  return {
    baseline: {
      implementationBaseCommit: 'c01b42f151be03da47fffc942b43f9a157f4d53e',
      m496ReceiptSha256: M496_RECEIPT_DIGEST,
      observationAt34500: structuredClone(m496.observations[1]),
    },
    format: FORMAT,
    limits: {
      activeProfile: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
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
      atBudget34500: {
        cacheKeyCodeUnits: { maximum: 31_994, total: 8_844_253 },
        cacheKeyCodeUnitsReduction: 40_175_005,
        expressionsourcesExecutionReduction: 91,
        expressionsourcesExecutions: 1,
        expressionsourcesPreparations: 1,
        frameSuspensions: 350,
        loopAttemptsRemoved: 78_645,
        loopIterations: { attempted: 34_500, retained: 34_500, rolledBack: 0 },
        outcome: 'failure',
        publicParityVerified: true,
      },
      dependencyTransport: 'internal-helper-dependency-yield',
      parentFrameRestarts: 0,
      strategy: 'preserve-open-helper-generator-and-retry-current-pure-node',
    },
    promotion: {
      disposition: 'production-headroom-authenticated-promotion-budget-no-go',
      nextMilestone: 'M4.98',
      profilePromotionApproved: false,
    },
    result: {
      belowFloor: exactFloor - 1,
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      productionHeadroom: productionMaxCollectionLength - exactFloor,
      promotionBudgetDeficit: exactFloor - promotionBudget,
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

export function validateCanonicalizerRuntimeCostM497(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerRuntimeCostM497();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.97 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM497() {
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
  const result = validateCanonicalizerRuntimeCostM497(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerRuntimeCostM497());
}
