import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { digestCompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadCanonicalizerRuntimeCostM4104 } from './runtime-cost-m4-104.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-bottleneck.3';
const RECEIPT_DIGEST = '06538ef420d2374ecf39f5b12d775189c73cfa11a66a3ef460cf795c273db7e0';
const SUMMARY_URL = new URL('./runtime-bottleneck-m4-105.json', import.meta.url);
const M4104_RECEIPT_DIGEST =
  'eace33240c8425569685d76530e4b59ec5b07fa874572a93458ea5e17f84ec92';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement';
const SOURCE_DIGESTS = {
  canonicalizerCompositeSha256:
    '9fb89f33f5b76d5b177d20318357c56a9624d4199915f877e78cd313f22bc13d',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    '0e4b18086df8f0a6cabaa7b9daaa80acad34bea1badf361ab1649f7bf8f35789',
  diagnosisMeasurementSha256:
    '2ce865d2caff4e3cbf982bf48b96e0afae223be0812c76af45bfd1c41db9c38b',
  expressionHelpersSha256:
    '3c0c38daa48946926f28a797bb38f3f45291f12dd90656989dbd587819d828e3',
  mainSourceSha256:
    '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195',
  runtimeCostMeasurementSha256:
    '876db33173e52f3a24647f75596f041b61174003fcefd2dffef7b120e43f7459',
  runtimePolicySha256:
    '687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09',
  statementHelpersSha256:
    'a91390500b1d7e2bb3749d537001eb49d64fa809bd22fae13763b2e6c21f716c',
};
const SOURCE_URLS = {
  canonicalizerCompositeSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer.composed.kern', import.meta.url),
  compositionRecordSha256: new URL('./composition.json', import.meta.url),
  diagnosisMeasurementSha256:
    new URL('./runtime-bottleneck-m4-105-measure.mjs', import.meta.url),
  expressionHelpersSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern', import.meta.url),
  mainSourceSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url),
  runtimeCostMeasurementSha256:
    new URL('./runtime-cost-m4-104-measure.mjs', import.meta.url),
  runtimePolicySha256: new URL('./policy.json', import.meta.url),
  statementHelpersSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url),
};

function fail(message) {
  throw new TypeError(`coverage M4.105 runtime-bottleneck rejection: ${message}`);
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
  const m4104Bytes = readFileSync(new URL('./runtime-cost-m4-104.json', import.meta.url));
  if (digest(m4104Bytes) !== M4104_RECEIPT_DIGEST) fail('M4.104 receipt bytes must remain exact');
  const m4104 = loadCanonicalizerRuntimeCostM4104();
  if (
    m4104.witness.id !== WITNESS_ID ||
    m4104.result.exactFloor !== 62_830 ||
    m4104.result.promotionBudgetDeficit !== 13_678 ||
    m4104.promotion.profilePromotionApproved
  ) {
    fail('M4.104 runtime-cost handoff must remain exact');
  }
  if (digestCompiledCoreJavaScript() !== SOURCE_DIGESTS.compiledCoreJavaScriptSha256) {
    fail('compiled core JavaScript executed by the measurement must remain exact');
  }
  for (const [name, url] of Object.entries(SOURCE_URLS)) {
    if (digest(readFileSync(url)) !== SOURCE_DIGESTS[name]) {
      fail(`${name} executed by the diagnosis must remain exact`);
    }
  }
  const policy = loadCanonicalizerPolicy();
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
  return { m4104, policy };
}

function observation({
  budget,
  cache,
  cacheKeyCodeUnits,
  helperExecutionCount,
  helperFrameSuspensionCount,
  helperPreparationCount,
  loopIterations,
  outcome,
  selectedHelperExecutions,
  selectedHelperPreparations,
}) {
  return {
    cache,
    cacheKeyCodeUnits,
    helperExecutionCount,
    helperFrameSuspensionCount,
    helperPreparationCount,
    iterationBudget: budget,
    loopIterations,
    observerParityVerified: true,
    outcome,
    parentRestartCount: 0,
    roundTrip: outcome === 'success',
    selectedHelperExecutions,
    selectedHelperPreparations,
  };
}

const PROMOTION_EXECUTIONS = {
  childat: 50,
  childcount: 51,
  emitstatement: 0,
  emitstatementlist: 0,
  expressionsources: 1,
  exprsource: 33,
  indentation: 0,
  numberat: 67,
  propcount: 49,
  propid: 76,
  quotesource: 22,
  stringat: 3_196,
  structuralname: 23,
  validstatement: 34,
  validstatementlist: 13,
};
const FLOOR_EXECUTIONS = {
  childat: 89,
  childcount: 90,
  emitstatement: 73,
  emitstatementlist: 27,
  expressionsources: 1,
  exprsource: 73,
  indentation: 3,
  numberat: 68,
  propcount: 89,
  propid: 125,
  quotesource: 65,
  stringat: 3_326,
  structuralname: 29,
  validstatement: 73,
  validstatementlist: 27,
};
const PROMOTION_PREPARATIONS = {
  childat: 175,
  childcount: 86,
  emitstatement: 0,
  emitstatementlist: 0,
  expressionsources: 34,
  exprsource: 66,
  indentation: 0,
  numberat: 134,
  propcount: 110,
  propid: 210,
  quotesource: 60,
  stringat: 9_124,
  structuralname: 33,
  typesource: 16,
  valididentifier: 102,
  validstatement: 66,
  validstatementlist: 24,
};
const FLOOR_PREPARATIONS = {
  childat: 342,
  childcount: 192,
  emitstatement: 146,
  emitstatementlist: 53,
  expressionsources: 74,
  exprsource: 219,
  indentation: 76,
  numberat: 135,
  propcount: 230,
  propid: 433,
  quotesource: 176,
  stringat: 9_487,
  structuralname: 84,
  typesource: 32,
  valididentifier: 108,
  validstatement: 146,
  validstatementlist: 53,
};

function deltas(before, after) {
  return Object.fromEntries(Object.keys(after).map((name) => [name, after[name] - before[name]]));
}

export function buildCanonicalizerRuntimeBottleneckM4105() {
  const { m4104, policy } = exactInputs();
  const promotionBudget = m4104.limits.promotionBudget;
  const exactFloor = m4104.result.exactFloor;
  return {
    baseline: {
      implementationBaseCommit: 'e69fc5f35343456067f46dfc7f5636a2aaccbbca',
      m4104ReceiptSha256: M4104_RECEIPT_DIGEST,
      productionHeadroom: m4104.result.productionHeadroom,
      promotionBudgetDeficit: m4104.result.promotionBudgetDeficit,
    },
    diagnosis: {
      additionalCacheHits: 1_203,
      additionalCacheKeyCodeUnits: 43_438_182,
      additionalCacheMisses: 1_086,
      additionalForIterations: 13_574,
      additionalHelperExecutions: 543,
      additionalHelperFrameSuspensions: 510,
      additionalHelperPreparations: 1_746,
      additionalParentRestarts: 0,
      additionalRetainedIterations: 13_678,
      additionalRolledBackIterations: 0,
      additionalWhileIterations: 104,
      budgetAttribution: 'all-retained-loop-iterations-helper-attribution-unavailable',
      emissionExecutionsAtPromotionBudget: 0,
      mechanism: 'committed-statement-validation-table-traversal-before-emission',
      nextMilestone: 'M4.106',
      optimizationTarget:
        'consolidated-authenticated-statement-property-and-child-count-access',
      selectedHelperExecutionDeltas: deltas(PROMOTION_EXECUTIONS, FLOOR_EXECUTIONS),
      selectedHelperPreparationDeltas: deltas(PROMOTION_PREPARATIONS, FLOOR_PREPARATIONS),
      validstatementExecutionsAtExactFloor: FLOOR_EXECUTIONS.validstatement,
      validstatementExecutionsAtPromotionBudget: PROMOTION_EXECUTIONS.validstatement,
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(policy.profileLimits),
      candidateProfile: structuredClone(m4104.limits.candidateProfile),
      exactFloor,
      maxDepth: policy.kirLimits.maxDepth,
      productionMaxCollectionLength: policy.runtimeLimits.maxCollectionLength,
      promotionBudget,
    },
    observations: [
      observation({
        budget: promotionBudget,
        cache: { hits: 7_400, misses: 7_596 },
        cacheKeyCodeUnits: { maximum: 79_407, total: 160_115_519 },
        helperExecutionCount: 3_798,
        helperFrameSuspensionCount: 3_636,
        helperPreparationCount: 11_198,
        loopIterations: {
          attemptedByType: { for: 49_152 },
          retained: 49_152,
          rolledBack: 0,
        },
        outcome: 'failure',
        selectedHelperExecutions: structuredClone(PROMOTION_EXECUTIONS),
        selectedHelperPreparations: structuredClone(PROMOTION_PREPARATIONS),
      }),
      observation({
        budget: exactFloor,
        cache: { hits: 8_603, misses: 8_682 },
        cacheKeyCodeUnits: { maximum: 79_416, total: 203_553_701 },
        helperExecutionCount: 4_341,
        helperFrameSuspensionCount: 4_146,
        helperPreparationCount: 12_944,
        loopIterations: {
          attemptedByType: { for: 62_726, while: 104 },
          retained: 62_830,
          rolledBack: 0,
        },
        outcome: 'success',
        selectedHelperExecutions: structuredClone(FLOOR_EXECUTIONS),
        selectedHelperPreparations: structuredClone(FLOOR_PREPARATIONS),
      }),
    ],
    observer: {
      defaultOff: true,
      eventData: 'frozen-scalars',
      helperLoopAttributionAvailable: false,
      publicHandlerOptionExposed: false,
    },
    promotion: {
      disposition: 'residual-runtime-bottleneck-attributed-optimization-required',
      nextMilestone: 'M4.106',
      profilePromotionApproved: false,
      promotionReady: false,
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

export function validateCanonicalizerRuntimeBottleneckM4105(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeBottleneckM4105();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.105 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeBottleneckM4105() {
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
  const result = validateCanonicalizerRuntimeBottleneckM4105(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeBottleneckM4105());
}
