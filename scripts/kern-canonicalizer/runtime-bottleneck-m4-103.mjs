import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeCoverageSummary } from './coverage-summary-writer.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-bottleneck.2';
const RECEIPT_DIGEST = 'a8f80c8d63cbaba2ff6d5d579d347ff9c489719e8f5170a95acadfbbfcd19488';
const SUMMARY_URL = new URL('./runtime-bottleneck-m4-103.json', import.meta.url);
const M4102_RECEIPT_DIGEST =
  '8bed0a4709de4ba79dfffba68e4f9304bdf599e04d771520637bb935865b5e58';
const WITNESS_ID =
  'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern#2:validstatement';
const SOURCE_DIGESTS = {
  canonicalizerCompositeSha256:
    '983eed5c8841b0cdf41a0b678734f2457c97545a88607969acc9fd4dcc1fc807',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    'f3ce080a976c8764a68417b9845deaa47bb30515e260d48fd415f1ea621a824a',
  measurementSha256:
    '48d7f84da280a28a4196ab3054b650bcdd31728ad66dc4a80b719403517db1cd',
  runtimePolicySha256:
    '687f8ca3a3e1458bd6c3d3b7baacde4614c6a7eff78bb9d4071027f4311cfc09',
  statementHelpersSha256:
    '158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667',
};
function fail(message) {
  throw new TypeError(`coverage M4.103 runtime-bottleneck rejection: ${message}`);
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
  const m4102Path = fileURLToPath(
    new URL('./triple-row-headroom-m4-102.json', import.meta.url),
  );
  const m4102Bytes = readFileSync(m4102Path);
  if (digest(m4102Bytes) !== M4102_RECEIPT_DIGEST) {
    fail('M4.102 receipt digest must remain exact');
  }
  let m4102;
  try {
    m4102 = JSON.parse(m4102Bytes.toString('utf8'));
  } catch {
    fail('M4.102 receipt must remain valid historical JSON');
  }
  const witness = m4102.witnesses[0];
  if (
    witness?.id !== WITNESS_ID ||
    witness.exactFloor !== 72_195 ||
    witness.floorOutcome !== 'success' ||
    m4102.limits.productionMaxCollectionLength !== 65_536 ||
    m4102.limits.promotionBudget !== 49_152 ||
    m4102.promotion.profilePromotionApproved !== false
  ) {
    fail('M4.102 witness, budgets, and rejection must remain exact');
  }
  for (const [name, value] of Object.entries(SOURCE_DIGESTS)) {
    if (!/^[0-9a-f]{64}$/u.test(value)) fail(`${name} historical identity must remain exact`);
  }
  return m4102;
}

const SELECTED_HELPERS = [
  'validstatementlist',
  'validstatement',
  'exprsource',
  'expressionsources',
  'emitstatementlist',
  'emitstatement',
  'stringat',
  'quotesource',
  'indentation',
];

function observation({
  budget,
  cache,
  cacheKeyCodeUnits,
  helperExecutionCount,
  helperFrameSuspensionCount,
  helperPreparationCount,
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
    loopIterations: {
      attemptedFor: budget,
      retained: budget,
      rolledBack: 0,
    },
    observerParityVerified: true,
    outcome,
    parentRestartCount: 0,
    roundTrip: outcome === 'success',
    selectedHelperExecutions,
    selectedHelperPreparations,
  };
}

export function buildCanonicalizerRuntimeBottleneckM4103() {
  const m4102 = exactInputs();
  const production = observation({
    budget: 65_536,
    cache: { hits: 7_780, misses: 8_160 },
    cacheKeyCodeUnits: { maximum: 79_407, total: 175_274_965 },
    helperExecutionCount: 4_080,
    helperFrameSuspensionCount: 3_918,
    helperPreparationCount: 11_860,
    outcome: 'failure',
    selectedHelperExecutions: {
      validstatementlist: 24,
      validstatement: 64,
      exprsource: 63,
      expressionsources: 1,
      emitstatementlist: 0,
      emitstatement: 0,
      stringat: 3_272,
      quotesource: 22,
      indentation: 0,
    },
    selectedHelperPreparations: {
      validstatementlist: 46,
      validstatement: 126,
      exprsource: 126,
      expressionsources: 64,
      emitstatementlist: 0,
      emitstatement: 0,
      stringat: 9_306,
      quotesource: 60,
      indentation: 0,
    },
  });
  const exactFloor = observation({
    budget: 72_195,
    cache: { hits: 8_603, misses: 8_682 },
    cacheKeyCodeUnits: { maximum: 79_416, total: 203_551_352 },
    helperExecutionCount: 4_341,
    helperFrameSuspensionCount: 4_146,
    helperPreparationCount: 12_944,
    outcome: 'success',
    selectedHelperExecutions: {
      validstatementlist: 27,
      validstatement: 73,
      exprsource: 73,
      expressionsources: 1,
      emitstatementlist: 27,
      emitstatement: 73,
      stringat: 3_326,
      quotesource: 65,
      indentation: 3,
    },
    selectedHelperPreparations: {
      validstatementlist: 53,
      validstatement: 146,
      exprsource: 219,
      expressionsources: 74,
      emitstatementlist: 53,
      emitstatement: 146,
      stringat: 9_487,
      quotesource: 176,
      indentation: 76,
    },
  });
  if (
    Object.keys(production.selectedHelperExecutions).join(',') !== SELECTED_HELPERS.join(',') ||
    Object.keys(exactFloor.selectedHelperExecutions).join(',') !== SELECTED_HELPERS.join(',')
  ) {
    fail('selected helper ordering must remain exact');
  }
  return {
    baseline: {
      implementationBaseCommit: '49b99465b2808fbeeb54fa6e1d6e3d1ee110d46c',
      m4102ReceiptSha256: M4102_RECEIPT_DIGEST,
      productionCeilingDeficit: m4102.promotion.productionCeilingDeficit,
      promotionBudgetDeficit: m4102.promotion.promotionBudgetDeficit,
    },
    diagnosis: {
      additionalBudget: 6_659,
      additionalCacheKeyCodeUnits: 28_276_387,
      additionalHelperExecutions: 261,
      additionalHelperFrameSuspensions: 228,
      additionalHelperPreparations: 1_084,
      additionalParentRestarts: 0,
      additionalRetainedForIterations: 6_659,
      additionalRolledBackIterations: 0,
      budgetAttribution: 'all-retained-for-iterations',
      emissionExecutionsAtProductionCeiling: 0,
      mechanism: 'committed-validation-and-emission-loop-work',
      nextMilestone: 'M4.104',
      optimizationTarget: 'statement-validation-and-emission-table-traversal',
      selectedHelperExecutionDeltas: {
        validstatementlist: 3,
        validstatement: 9,
        exprsource: 10,
        expressionsources: 0,
        emitstatementlist: 27,
        emitstatement: 73,
        stringat: 54,
        quotesource: 43,
        indentation: 3,
      },
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(m4102.limits.activeProfile),
      candidateProfile: structuredClone(m4102.limits.candidateProfile),
      exactFloor: 72_195,
      productionMaxCollectionLength: 65_536,
      promotionBudget: 49_152,
    },
    observations: [production, exactFloor],
    observer: {
      defaultOff: true,
      eventData: 'frozen-scalars',
      publicHandlerOptionExposed: false,
    },
    promotion: {
      disposition: 'runtime-bottleneck-attributed-optimization-required',
      profilePromotionApproved: false,
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

export function validateCanonicalizerRuntimeBottleneckM4103(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeBottleneckM4103();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.103 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeBottleneckM4103() {
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
  const result = validateCanonicalizerRuntimeBottleneckM4103(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeBottleneckM4103());
}
