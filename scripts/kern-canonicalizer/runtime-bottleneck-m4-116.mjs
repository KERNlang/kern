import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { digestCompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerPolicy } from './policy.mjs';
import { loadCanonicalizerTripleRowHeadroomM4115 } from './triple-row-headroom-m4-115.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-bottleneck.4';
const RECEIPT_DIGEST = '5342271907023c75b1c3b5acfd714860f6686d31a5a3bf60c37e7d8f73803056';
const SUMMARY_URL = new URL('./runtime-bottleneck-m4-116.json', import.meta.url);
const M4115_RECEIPT_DIGEST =
  '0142e5d39fc94ec76e2cf793a62a922fa9087a12fb4cd83b9499cfc58f922b9d';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker.kern#24:checkModule';
const SOURCE_DIGESTS = {
  canonicalizerCompositeSha256:
    '75546d8edbf2753fc49aacaf24ab2fa416d7b3d3bd8984b37dd76317691ce88f',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    '18ff4b7116de086ab43a9d501545727ab27a6b99c10f991215d6d07607ed3216',
  diagnosticObserverSha256:
    '6037e9f2e37e3888b45d64458c627c217abfd52105271de226bf47e053e495b6',
  effectMachineSha256:
    '3de758e08833d0881159f4716710701a605b45a0f56313bb191fabe02666e2eb',
  helperRuntimeSha256:
    'd3254d54b5bf2b86c89776faad6b49f073d0754c0bc10dd269ce887cd0c3229c',
  measurementSha256:
    '8f94040ef6ad833985ea438db7956c6f39287e9e3e458a9dde58d8886afe8cb7',
  publicRuntimeHandlerSha256:
    'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  runtimePolicySha256:
    '919726462eabc002cb072cd8004fffe7f3e731ed430574dd608788580ca1f163',
  sequenceSha256:
    'fbd95b89099ceffbb6c2e8f2136620bfe51bda5bd2a22ba93de1db7743a68bfe',
  witnessSourceSha256:
    'f8c9b50d5be28074479bebed4c93e6e6d7f8f15ea9efab54c2b396dcde924d99',
};
const SOURCE_URLS = {
  canonicalizerCompositeSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer.composed.kern', import.meta.url),
  compositionRecordSha256: new URL('./composition.json', import.meta.url),
  diagnosticObserverSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine-diagnostics.ts', import.meta.url),
  effectMachineSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine.ts', import.meta.url),
  helperRuntimeSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts', import.meta.url),
  measurementSha256: new URL('./runtime-bottleneck-m4-116-measure.mjs', import.meta.url),
  publicRuntimeHandlerSha256:
    new URL('../../packages/core/src/runtime-handler.ts', import.meta.url),
  runtimePolicySha256: new URL('./policy.json', import.meta.url),
  sequenceSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine-sequence.ts', import.meta.url),
  witnessSourceSha256:
    new URL('../../examples/capstone-checker-subset/checker.kern', import.meta.url),
};

function fail(message) {
  throw new TypeError(`coverage M4.116 runtime-bottleneck rejection: ${message}`);
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
  const m4115Bytes = readFileSync(
    new URL('./triple-row-headroom-m4-115.json', import.meta.url),
  );
  if (digest(m4115Bytes) !== M4115_RECEIPT_DIGEST) {
    fail('M4.115 receipt bytes must remain exact');
  }
  const m4115 = loadCanonicalizerTripleRowHeadroomM4115();
  if (
    m4115.witnesses[0]?.id !== WITNESS_ID ||
    m4115.summary.maxExactFloor !== 176_119 ||
    m4115.limits.productionMaxCollectionLength !== 65_536 ||
    m4115.limits.promotionBudget !== 49_152 ||
    m4115.promotion.profilePromotionApproved
  ) {
    fail('M4.115 witness, boundaries, and NO-GO must remain exact');
  }
  for (const [name, url] of Object.entries(SOURCE_URLS)) {
    if (digest(readFileSync(url)) !== SOURCE_DIGESTS[name]) {
      fail(`${name} executable input must remain exact`);
    }
  }
  if (digestCompiledCoreJavaScript() !== SOURCE_DIGESTS.compiledCoreJavaScriptSha256) {
    fail('compiled core JavaScript executed by the measurement must remain exact');
  }
  const policy = loadCanonicalizerPolicy();
  if (
    policy.kirLimits.maxDepth !== 76 ||
    policy.runtimeLimits.maxDepth !== 64 ||
    policy.runtimeLimits.maxCollectionLength !== 65_536
  ) {
    fail('runtime and structural KIR limits must remain exact');
  }
  return m4115;
}

const SELECTED_HELPERS = [
  'tablesok',
  'valuefacts',
  'childcount',
  'childat',
  'stringat',
  'numberat',
  'propid',
  'propcount',
  'typesource',
  'typefields',
  'validstatementlist',
  'validstatement',
  'exprsource',
  'expressionsources',
  'emitstatementlist',
  'emitstatement',
];

function selected(values) {
  if (Object.keys(values).join(',') !== SELECTED_HELPERS.join(',')) {
    fail('selected helper ordering must remain exact');
  }
  return values;
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
  phase,
  selectedHelperExecutions,
  selectedHelperPreparations,
  typefields,
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
    phase,
    roundTrip: outcome === 'success',
    selectedHelperExecutions: selected(selectedHelperExecutions),
    selectedHelperPreparations: selected(selectedHelperPreparations),
    typefields,
  };
}

const PROMOTION_EXECUTIONS = selected({
  tablesok: 1, valuefacts: 1, childcount: 19, childat: 18,
  stringat: 139, numberat: 0, propid: 37, propcount: 18,
  typesource: 18, typefields: 18, validstatementlist: 0, validstatement: 0,
  exprsource: 0, expressionsources: 0, emitstatementlist: 0, emitstatement: 0,
});
const PRODUCTION_EXECUTIONS = selected({
  tablesok: 1, valuefacts: 1, childcount: 25, childat: 24,
  stringat: 187, numberat: 0, propid: 49, propcount: 24,
  typesource: 24, typefields: 24, validstatementlist: 0, validstatement: 0,
  exprsource: 0, expressionsources: 0, emitstatementlist: 0, emitstatement: 0,
});
const FLOOR_EXECUTIONS = selected({
  tablesok: 1, valuefacts: 1, childcount: 61, childat: 122,
  stringat: 4062, numberat: 643, propid: 120, propcount: 60,
  typesource: 59, typefields: 59, validstatementlist: 36, validstatement: 62,
  exprsource: 65, expressionsources: 1, emitstatementlist: 36, emitstatement: 62,
});
const PROMOTION_PREPARATIONS = selected({
  tablesok: 1, valuefacts: 2, childcount: 19, childat: 138,
  stringat: 463, numberat: 0, propid: 157, propcount: 19,
  typesource: 18, typefields: 35, validstatementlist: 0, validstatement: 0,
  exprsource: 0, expressionsources: 0, emitstatementlist: 0, emitstatement: 0,
});
const PRODUCTION_PREPARATIONS = selected({
  tablesok: 1, valuefacts: 2, childcount: 25, childat: 255,
  stringat: 763, numberat: 0, propid: 280, propcount: 25,
  typesource: 24, typefields: 47, validstatementlist: 0, validstatement: 0,
  exprsource: 0, expressionsources: 0, emitstatementlist: 0, emitstatement: 0,
});
const FLOOR_PREPARATIONS = selected({
  tablesok: 1, valuefacts: 2, childcount: 62, childat: 1959,
  stringat: 13954, numberat: 1285, propid: 1892, propcount: 61,
  typesource: 120, typefields: 118, validstatementlist: 71, validstatement: 124,
  exprsource: 195, expressionsources: 66, emitstatementlist: 71, emitstatement: 124,
});

export function buildCanonicalizerRuntimeBottleneckM4116() {
  const m4115 = exactInputs();
  const promotionBudget = m4115.limits.promotionBudget;
  const productionCeiling = m4115.limits.productionMaxCollectionLength;
  const exactFloor = m4115.summary.maxExactFloor;
  return {
    baseline: {
      implementationBaseCommit: 'b278b00ae1a03cc36e52449980c76cdcaa9ad536',
      m4115ReceiptSha256: M4115_RECEIPT_DIGEST,
      productionCeilingDeficit: m4115.summary.productionCeilingDeficit,
      promotionBudgetDeficit: m4115.summary.promotionBudgetDeficit,
    },
    diagnosis: {
      budgetAttribution:
        'all-retained-loop-iterations-exact-typefields-full-scans-source-attributed',
      exactFloorTypefieldsIterations: 142_249,
      exactFloorTypefieldsShareBasisPoints: 8_077,
      mechanism: 'repeated-full-value-table-scans-during-function-parameter-type-validation',
      nextMilestone: 'M4.117',
      optimizationTarget: 'single-pass-authenticated-function-type-field-index',
      productionToFloor: {
        additionalCacheHits: 15_115,
        additionalCacheKeyCodeUnits: 304_642_579,
        additionalCacheMisses: 10_900,
        additionalForIterations: 110_401,
        additionalHelperExecutions: 5_450,
        additionalHelperFrameSuspensions: 4_971,
        additionalHelperPreparations: 20_565,
        additionalRetainedIterations: 110_583,
        additionalWhileIterations: 182,
        minimumAdditionalCompletedTypefieldsIterations: 84_385,
        minimumAdditionalCompletedTypefieldsScans: 35,
      },
      productionFailureBeforeStatementValidation: true,
      productionMinimumCompletedTypefieldsIterations: 55_453,
      productionMinimumTypefieldsShareBasisPoints: 8_461,
      promotionToProduction: {
        additionalCacheHits: 596,
        additionalCacheKeyCodeUnits: 6_069_919,
        additionalCacheMisses: 208,
        additionalForIterations: 16_384,
        additionalHelperExecutions: 104,
        additionalHelperFrameSuspensions: 44,
        additionalHelperPreparations: 700,
        additionalRetainedIterations: 16_384,
        additionalWhileIterations: 0,
        additionalCompletedTypefieldsIterations: 14_466,
        additionalCompletedTypefieldsScans: 6,
      },
      promotionFailureBeforeStatementValidation: true,
      promotionMinimumCompletedTypefieldsIterations: 40_987,
      promotionMinimumTypefieldsShareBasisPoints: 8_338,
      valueRowsPerTypefieldsExecution: 2_411,
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(m4115.limits.activeProfile),
      candidateProfile: structuredClone(m4115.limits.candidateProfile),
      exactFloor,
      maxDepth: m4115.moduleEnvelope.maxDepth,
      productionMaxCollectionLength: productionCeiling,
      promotionBudget,
    },
    observations: [
      observation({
        budget: promotionBudget,
        cache: { hits: 851, misses: 742 },
        cacheKeyCodeUnits: { maximum: 92_285, total: 11_082_392 },
        helperExecutionCount: 371,
        helperFrameSuspensionCount: 187,
        helperPreparationCount: 1_222,
        loopIterations: { attemptedByType: { for: 49_152 }, retained: 49_152, rolledBack: 0 },
        outcome: 'failure',
        phase: 'function-parameter-validation-before-statements',
        selectedHelperExecutions: PROMOTION_EXECUTIONS,
        selectedHelperPreparations: PROMOTION_PREPARATIONS,
        typefields: { executionsEntered: 18, minimumCompletedFullScans: 17 },
      }),
      observation({
        budget: productionCeiling,
        cache: { hits: 1_447, misses: 950 },
        cacheKeyCodeUnits: { maximum: 92_285, total: 17_152_311 },
        helperExecutionCount: 475,
        helperFrameSuspensionCount: 231,
        helperPreparationCount: 1_922,
        loopIterations: { attemptedByType: { for: 65_536 }, retained: 65_536, rolledBack: 0 },
        outcome: 'failure',
        phase: 'function-parameter-validation-before-statements',
        selectedHelperExecutions: PRODUCTION_EXECUTIONS,
        selectedHelperPreparations: PRODUCTION_PREPARATIONS,
        typefields: { executionsEntered: 24, minimumCompletedFullScans: 23 },
      }),
      observation({
        budget: exactFloor,
        cache: { hits: 16_562, misses: 11_850 },
        cacheKeyCodeUnits: { maximum: 92_325, total: 321_794_890 },
        helperExecutionCount: 5_925,
        helperFrameSuspensionCount: 5_202,
        helperPreparationCount: 22_487,
        loopIterations: {
          attemptedByType: { for: 175_937, while: 182 },
          retained: 176_119,
          rolledBack: 0,
        },
        outcome: 'success',
        phase: 'complete-validation-and-emission',
        selectedHelperExecutions: FLOOR_EXECUTIONS,
        selectedHelperPreparations: FLOOR_PREPARATIONS,
        typefields: { completedFullScans: 59, executionsEntered: 59 },
      }),
    ],
    observer: {
      defaultOff: true,
      eventData: 'frozen-scalars',
      helperExecuteSemantics: 'body-entry-not-completion',
      otherHelperLoopAttributionAvailable: false,
      publicHandlerOptionExposed: false,
    },
    promotion: {
      disposition: 'runtime-bottleneck-attributed-optimization-required',
      nextMilestone: 'M4.117',
      profilePromotionApproved: false,
      promotionReady: false,
    },
    source: {
      ...structuredClone(SOURCE_DIGESTS),
      runtimeHandlerAbi: KERN_RUNTIME_HANDLER_ABI,
    },
    witness: {
      id: WITNESS_ID,
      parameterRows: 58,
      structuralRows: { nodes: 122, properties: 193, values: 2_411 },
    },
  };
}

export function validateCanonicalizerRuntimeBottleneckM4116(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeBottleneckM4116();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.116 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeBottleneckM4116() {
  const path = fileURLToPath(SUMMARY_URL);
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (
    stat === undefined ||
    !stat.isFile() ||
    realpathSync(path) !== path
  ) {
    fail('receipt must be a regular non-symlink file');
  }
  const source = readFileSync(path);
  let parsed;
  try {
    parsed = JSON.parse(source.toString('utf8'));
  } catch {
    fail('receipt must be valid JSON');
  }
  const result = validateCanonicalizerRuntimeBottleneckM4116(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeBottleneckM4116());
}
