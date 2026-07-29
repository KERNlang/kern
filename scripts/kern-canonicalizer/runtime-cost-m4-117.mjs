import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { verifyCanonicalizerComposition } from './composition.mjs';
import { digestCompiledCoreJavaScript } from './coverage-dependencies.mjs';
import {
  reconstructLegacyParameterMeasurementSource,
} from './historical-measurement-sources.mjs';
import {
  reconstructLegacyParameterSource,
} from './historical-parameter-sources.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadHistoricalCanonicalizerPolicy } from './historical-policy.mjs';
import { loadCanonicalizerRuntimeBottleneckM4116 } from './runtime-bottleneck-m4-116.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.8';
const RECEIPT_DIGEST = '125529edf09c4523e778288052c3b66cf08c8099a4f0d18ef25038cb64b54778';
const SUMMARY_URL = new URL('./runtime-cost-m4-117.json', import.meta.url);
const M4116_RECEIPT_DIGEST =
  '5342271907023c75b1c3b5acfd714860f6686d31a5a3bf60c37e7d8f73803056';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker.kern#24:checkModule';
const SOURCE_DIGESTS = {
  baselineMeasurementSha256:
    '8f94040ef6ad833985ea438db7956c6f39287e9e3e458a9dde58d8886afe8cb7',
  canonicalizerCompositeSha256:
    'f40d056b2aac947350f297196cbe71d5acdb5b82d245963adee910620c7b7180',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    'a98f58589b8e0d8006970aa5e530b393e8f3cd247bea1e86f922b98a89d5649e',
  expressionHelpersSha256:
    'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f',
  mainSourceSha256:
    '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195',
  measurementSha256:
    'ddd7bda895c627d1cf0f6878f95d09a2906d9c45cfee4f8c8c123b87977127d3',
  runtimePolicySha256:
    '919726462eabc002cb072cd8004fffe7f3e731ed430574dd608788580ca1f163',
  statementHelpersSha256:
    '11485f2b657a002e8ff4ca93db7b0122768163c65edecb3a1f13da4906569d75',
  witnessSourceSha256:
    'f8c9b50d5be28074479bebed4c93e6e6d7f8f15ea9efab54c2b396dcde924d99',
};
const SOURCE_URLS = {
  baselineMeasurementSha256: new URL('./runtime-bottleneck-m4-116-measure.mjs', import.meta.url),
  canonicalizerCompositeSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer.composed.kern', import.meta.url),
  compositionRecordSha256: new URL('./composition.json', import.meta.url),
  expressionHelpersSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern', import.meta.url),
  mainSourceSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url),
  measurementSha256: new URL('./runtime-cost-m4-117-measure.mjs', import.meta.url),
  runtimePolicySha256: new URL('./policy.json', import.meta.url),
  statementHelpersSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url),
  witnessSourceSha256:
    new URL('../../examples/capstone-checker-subset/checker.kern', import.meta.url),
};

function fail(message) {
  throw new TypeError(`coverage M4.117 runtime-cost rejection: ${message}`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('receipt arrays must be plain');
    const keys = Object.keys(value);
    if (
      Reflect.ownKeys(value).length !== value.length + 1 ||
      keys.length !== value.length ||
      keys.some((key, index) => key !== String(index))
    ) fail('receipt arrays must be dense and undecorated');
    for (const key of keys) assertPlainReceiptData(value[key], seen);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('receipt objects must be plain');
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
  const m4116Bytes = readFileSync(new URL('./runtime-bottleneck-m4-116.json', import.meta.url));
  if (digest(m4116Bytes) !== M4116_RECEIPT_DIGEST) {
    fail('M4.116 receipt bytes must remain exact');
  }
  const m4116 = loadCanonicalizerRuntimeBottleneckM4116();
  if (
    m4116.witness.id !== WITNESS_ID ||
    m4116.limits.exactFloor !== 176_119 ||
    m4116.diagnosis.exactFloorTypefieldsIterations !== 142_249 ||
    m4116.promotion.nextMilestone !== 'M4.117'
  ) fail('M4.116 bottleneck handoff must remain exact');
  verifyCanonicalizerComposition();
  for (const [name, url] of Object.entries(SOURCE_URLS)) {
    if (name === 'runtimePolicySha256') continue;
    let source = readFileSync(url);
    if (name === 'baselineMeasurementSha256') {
      source = reconstructLegacyParameterMeasurementSource({
        currentSource: source,
        expectedDigest: SOURCE_DIGESTS[name],
        milestone: 'M4.117 baseline measurement',
        witnessMilestone: 'M4.116 checkModule witness',
        name: 'checkModule',
      });
    } else if (name === 'witnessSourceSha256') {
      source = reconstructLegacyParameterSource({
        currentSource: readFileSync(url),
        expectedDigest: SOURCE_DIGESTS[name],
        milestone: 'M4.117 checkModule witness',
        name: 'checkModule',
      });
    }
    if (digest(source) !== SOURCE_DIGESTS[name]) {
      fail(`${name} executable input must remain exact`);
    }
  }
  if (digestCompiledCoreJavaScript() !== SOURCE_DIGESTS.compiledCoreJavaScriptSha256) {
    fail('compiled core JavaScript executed by the measurement must remain exact');
  }
  const policy = loadHistoricalCanonicalizerPolicy({
    expectedDigest: SOURCE_DIGESTS.runtimePolicySha256,
    kirLimitOverrides: {},
    milestone: 'M4.117',
    profileLimits: {
      maxNodeRows: 89,
      maxPropertyRows: 125,
      maxValueRows: 2_100,
    },
  });
  if (
    canonicalBytes(policy.profileLimits).compare(canonicalBytes({
      maxNodeRows: 89,
      maxPropertyRows: 125,
      maxValueRows: 2_100,
    })) !== 0 ||
    policy.kirLimits.maxDepth !== 76 ||
    policy.runtimeLimits.maxDepth !== 64 ||
    policy.runtimeLimits.maxCollectionLength !== 65_536
  ) fail('active profile and runtime/KIR limits must remain unchanged');
  return { m4116, policy };
}

const SELECTED_HELPERS = [
  'tablesok', 'valuefacts', 'childcount', 'childat', 'stringat', 'numberat',
  'propid', 'propcount', 'typesource', 'typefields', 'typefieldtablefacts',
  'validstatementlist', 'validstatement', 'exprsource', 'expressionsources',
  'emitstatementlist', 'emitstatement',
];

function selected(values) {
  if (Object.keys(values).join(',') !== SELECTED_HELPERS.join(',')) {
    fail('selected helper ordering must remain exact');
  }
  return values;
}

function observation(iterationBudget, outcome, forIterations) {
  return {
    cache: { hits: 16_798, misses: 12_206 },
    cacheKeyCodeUnits: { maximum: 92_325, total: 330_128_608 },
    helperExecutionCount: 6_103,
    helperFrameSuspensionCount: 5_380,
    helperPreparationCount: 22_901,
    iterationBudget,
    loopIterations: {
      attemptedByType: { for: forIterations, while: 182 },
      retained: iterationBudget,
      rolledBack: 0,
    },
    observerParityVerified: true,
    outcome,
    parentRestartCount: 0,
    roundTrip: outcome === 'success',
    selectedHelperExecutions: selected({
      tablesok: 1, valuefacts: 1, childcount: 61, childat: 122,
      stringat: 4_062, numberat: 820, propid: 120, propcount: 60,
      typesource: 59, typefields: 59, typefieldtablefacts: 1,
      validstatementlist: 36, validstatement: 62, exprsource: 65,
      expressionsources: 1, emitstatementlist: 36, emitstatement: 62,
    }),
    selectedHelperPreparations: selected({
      tablesok: 1, valuefacts: 2, childcount: 62, childat: 1_959,
      stringat: 13_954, numberat: 1_639, propid: 1_892, propcount: 61,
      typesource: 120, typefields: 118, typefieldtablefacts: 60,
      validstatementlist: 71, validstatement: 124, exprsource: 195,
      expressionsources: 66, emitstatementlist: 71, emitstatement: 124,
    }),
  };
}

export function buildCanonicalizerRuntimeCostM4117() {
  const { m4116, policy } = exactInputs();
  const exactFloor = 38_693;
  const productionMaxCollectionLength = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionMaxCollectionLength * 3 / 4);
  return {
    baseline: {
      m4116ReceiptSha256: M4116_RECEIPT_DIGEST,
      priorExactFloor: m4116.limits.exactFloor,
      priorPromotionBudgetDeficit: m4116.baseline.promotionBudgetDeficit,
      priorTypefieldsIterations: m4116.diagnosis.exactFloorTypefieldsIterations,
    },
    format: FORMAT,
    limits: {
      activeProfile: structuredClone(policy.profileLimits),
      candidateProfile: { maxNodeRows: 122, maxPropertyRows: 193, maxValueRows: 2_411 },
      exactFloor,
      maxDepth: policy.kirLimits.maxDepth,
      productionMaxCollectionLength,
      promotionBudget,
    },
    observations: [
      observation(exactFloor - 1, 'failure', 38_510),
      observation(exactFloor, 'success', 38_511),
    ],
    optimization: {
      exactFloorReduction: m4116.limits.exactFloor - exactFloor,
      inputValueTableScanIterations: 2_411,
      projectedFactSlotsPerParent: 3,
      projectionMaterializationIterations: 2_412,
      runtimeEngineChanged: false,
      typefieldTableProjectionExecutions: 1,
      typefieldsExecutions: 59,
      strategy: 'table-wide-authenticated-type-field-projection-with-fixed-parent-view',
    },
    promotion: {
      disposition: 'promotion-budget-headroom-authenticated',
      nextMilestone: 'M4.118',
      profilePromotionApproved: false,
      promotionReady: true,
    },
    result: {
      belowFloor: exactFloor - 1,
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      floorReduction: m4116.limits.exactFloor - exactFloor,
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
      parameterRows: 58,
      structuralRows: { nodes: 122, properties: 193, values: 2_411 },
    },
  };
}

export function validateCanonicalizerRuntimeCostM4117(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeCostM4117();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.117 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM4117() {
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
  const result = validateCanonicalizerRuntimeCostM4117(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeCostM4117());
}
