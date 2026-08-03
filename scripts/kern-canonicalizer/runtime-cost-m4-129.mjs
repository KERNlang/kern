import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import {
  canonicalCompositionRecordBytes,
} from './composition.mjs';
import { loadCoveragePolicy } from './coverage.mjs';
import { digestPreM4135CompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import {
  loadPreM4131CoverageInputs,
  reconstructLegacyParameterSource,
} from './historical-parameter-sources.mjs';
import { loadHistoricalCanonicalizerComposition } from './historical-composition.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import { EXCEPTION_FLOW_M4139_STATEMENT_REPLACEMENTS } from './exception-flow-emission-target.mjs';
import {
  QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
} from './quotesource-rewrite-m4-150-target.mjs';
import {
  QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT,
} from './quotesource-parameter-m4-151-target.mjs';
import {
  loadCanonicalizerRuntimeBottleneckM4128,
} from './runtime-bottleneck-m4-128.mjs';
import {
  PRE_M4131_RUNTIME_MEASUREMENT_REPLACEMENTS,
} from './validate-parameter-migration-target.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.9';
const RECEIPT_DIGEST = 'e4bd57760198241cbe295ef6dcc7e35b1b7ddbb41026ca066d4016de0cfccd7c';
const SUMMARY_URL = new URL('./runtime-cost-m4-129.json', import.meta.url);
const M4128_RECEIPT_DIGEST =
  '55512e5cdb91aa43b46ea8ccc09edb3cfe1890920071c13bed10c2d9f81440ac';
const M4128_RECEIPT_URL =
  new URL('./runtime-bottleneck-m4-128.json', import.meta.url);
const INPUT_COMMIT = '01f3a8156bdc8136b0f3a13ba5a0a968be7ec308';
const WITNESS_ID =
  'examples/selfhost-validator/validator.kern#20:validate';
const SOURCE_DIGESTS = {
  canonicalizerCompositeSha256:
    '32611fb5f35fc9040ab216c92e9c32726c06f8253f005abded8f8d0649bc3331',
  compiledCoreJavaScriptSha256:
    '502bde3b1a95cbafa2039a0227d626aeceb605c0d9de5ebe24183ab9b37f10ec',
  compositionRecordSha256:
    '95e95a72f8bb76ddd3a33140be59687697697dcb94e36c5386c113124f899649',
  coveragePolicySha256:
    'dcc9cc2db3478bd92370a373cf519ef192365bc8181bc5c726a9cce5bd4d80d6',
  expressionHelpersSha256:
    'c32414ee7aa6f29d092dc21de5065f04c4054c54d070dd4d964763047170ee2f',
  mainSourceSha256:
    '23cd17bc4b2869851c294fddfcb9f44bc3174a835e6fc2c6231aa01869f8c195',
  measurementSha256:
    '142beca363a7fbf55f232f2e1c8adac136deb55c025d03774348885501686c19',
  runtimePolicySha256:
    'c1b4f5b8e28eb4c0bb8a7fa0ef0a7dff64a4dd4cc952a5594d9ac95502e349a5',
  statementHelpersSha256:
    '67af44e97b0e874295f312e4c8033a13c57045a38ca2179c6c00b53abb68b5ce',
  witnessSourceSha256:
    '96a1c96800132f2401d743eac02f0efe8cb0717980ceb56c2af531798790eaac',
};
const SOURCE_URLS = {
  coveragePolicySha256: new URL('./coverage-policy.json', import.meta.url),
  expressionHelpersSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer-expression-helpers.kern', import.meta.url),
  mainSourceSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer.kern', import.meta.url),
  measurementSha256: new URL('./runtime-cost-m4-129-measure.mjs', import.meta.url),
  runtimePolicySha256: new URL('./policy.json', import.meta.url),
  statementHelpersSha256:
    new URL('../../examples/kern-canonicalizer/canonicalizer-statement-helpers.kern', import.meta.url),
  witnessSourceSha256:
    new URL('../../examples/selfhost-validator/validator.kern', import.meta.url),
};
const SELECTED_HELPERS = [
  'recordfield',
  'typefields',
  'typefieldtablefacts',
  'validstatement',
  'exprsource',
  'expressionsources',
  'emitstatement',
  'emitstatementlist',
];

function fail(message) {
  throw new TypeError(`coverage M4.129 runtime-cost rejection: ${message}`);
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
    if (typeof key === 'symbol') fail('receipt objects must not contain symbols');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('receipt objects must contain only plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  const m4128Bytes = readFileSync(M4128_RECEIPT_URL);
  if (digest(m4128Bytes) !== M4128_RECEIPT_DIGEST) {
    fail('M4.128 receipt bytes must remain exact');
  }
  const m4128 = loadCanonicalizerRuntimeBottleneckM4128();
  const historicalComposition = loadHistoricalCanonicalizerComposition({
    expectedDigests: {
      canonicalizerCompositeSha256: SOURCE_DIGESTS.canonicalizerCompositeSha256,
      compositionRecordSha256: SOURCE_DIGESTS.compositionRecordSha256,
      expressionHelpersSha256: SOURCE_DIGESTS.expressionHelpersSha256,
      mainSourceSha256: SOURCE_DIGESTS.mainSourceSha256,
      statementHelpersSha256: SOURCE_DIGESTS.statementHelpersSha256,
    },
    expressionHelperReplacements: [
      QUOTESOURCE_PARAMETER_M4151_SOURCE_REPLACEMENT,
      QUOTESOURCE_M4150_SOURCE_REPLACEMENT,
    ],
    milestone: 'M4.129',
    statementHelperReplacements: EXCEPTION_FLOW_M4139_STATEMENT_REPLACEMENTS,
    statementHelperTargets: [],
  });
  if (
    m4128.witness.id !== WITNESS_ID ||
    m4128.observations[3].iterationBudget !== 54_894 ||
    m4128.observations[3].outcome !== 'success' ||
    m4128.diagnosis.exactRecordfieldIterations !== 8_986 ||
    m4128.promotion.requiredFloorReduction !== 5_742 ||
    m4128.promotion.nextMilestone !== 'M4.129'
  ) fail('M4.128 runtime diagnosis handoff must remain exact');
  for (const [name, url] of Object.entries(SOURCE_URLS)) {
    if (name === 'runtimePolicySha256') continue;
    let source = readFileSync(url);
    if (name === 'coveragePolicySha256') {
      const historical = loadPreM4131CoverageInputs(loadCoveragePolicy());
      source = historical.coveragePolicySource;
    } else if (name === 'expressionHelpersSha256') {
      source = historicalComposition.expressionHelpers;
    } else if (name === 'mainSourceSha256') {
      source = historicalComposition.mainSource;
    } else if (name === 'statementHelpersSha256') {
      source = historicalComposition.statementHelpers;
    } else if (name === 'measurementSha256') {
      source = reconstructHistoricalSource({
        currentSource: source,
        expectedDigest: SOURCE_DIGESTS[name],
        milestone: 'M4.129 measurement',
        replacements: PRE_M4131_RUNTIME_MEASUREMENT_REPLACEMENTS,
      });
    } else if (name === 'witnessSourceSha256') {
      source = reconstructLegacyParameterSource({
        currentSource: source,
        expectedDigest: SOURCE_DIGESTS[name],
        milestone: 'M4.129 validate witness',
        name: 'validate',
      });
    }
    if (digest(source) !== SOURCE_DIGESTS[name]) {
      fail(`${name} executable input must remain exact`);
    }
  }
  if (digestPreM4135CompiledCoreJavaScript() !== SOURCE_DIGESTS.compiledCoreJavaScriptSha256) {
    fail('compiled core JavaScript executed by measurement must remain exact');
  }
  const composition = historicalComposition;
  if (
    digest(composition.composite) !== SOURCE_DIGESTS.canonicalizerCompositeSha256 ||
    digest(canonicalCompositionRecordBytes(composition.record)) !==
      SOURCE_DIGESTS.compositionRecordSha256
  ) fail('canonicalizer composition identities must remain exact');
  const policy = loadPreM4130CanonicalizerPolicy();
  if (digest(canonicalBytes(policy)) !== SOURCE_DIGESTS.runtimePolicySha256) {
    fail('historical runtime policy identity must remain exact');
  }
  if (
    policy.runtimeLimits.maxCollectionLength !== 65_536 ||
    policy.runtimeLimits.maxDepth !== 64
  ) fail('runtime policy must remain exact');
  return { m4128, policy };
}

function selected(values) {
  if (Object.keys(values).join(',') !== SELECTED_HELPERS.join(',')) {
    fail('selected helper ordering must remain exact');
  }
  return values;
}

function observation(iterationBudget, outcome, forIterations) {
  return {
    cache: { hits: 22_156, misses: 21_432 },
    cacheKeyCodeUnits: { maximum: 171_098, total: 1_033_785_591 },
    helperExecutionCount: 10_716,
    helperFrameSuspensionCount: 10_197,
    helperPreparationCount: 32_872,
    iterationBudget,
    loopIterations: {
      attemptedByType: { for: forIterations, while: 281 },
      retained: iterationBudget,
      rolledBack: 0,
    },
    observerParityVerified: true,
    outcome,
    parentRestartCount: 0,
    roundTrip: outcome === 'success',
    selectedHelperExecutions: selected({
      recordfield: 0,
      typefields: 44,
      typefieldtablefacts: 1,
      validstatement: 159,
      exprsource: 183,
      expressionsources: 1,
      emitstatement: 159,
      emitstatementlist: 100,
    }),
    selectedHelperPreparations: selected({
      recordfield: 0,
      typefields: 88,
      typefieldtablefacts: 45,
      validstatement: 318,
      exprsource: 549,
      expressionsources: 184,
      emitstatement: 318,
      emitstatementlist: 199,
    }),
  };
}

export function buildCanonicalizerRuntimeCostM4129() {
  const { m4128, policy } = exactInputs();
  const exactFloor = 45_908;
  const productionBudget = policy.runtimeLimits.maxCollectionLength;
  const promotionBudget = Math.floor(productionBudget * 3 / 4);
  return {
    baseline: {
      m4128ReceiptSha256: M4128_RECEIPT_DIGEST,
      priorExactFloor: m4128.observations[3].iterationBudget,
      priorPromotionBudgetDeficit: m4128.promotion.requiredFloorReduction,
      priorRecordfieldIterations: m4128.diagnosis.exactRecordfieldIterations,
    },
    format: FORMAT,
    limits: {
      candidateKir: { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 },
      candidateProfile: {
        maxNodeRows: 202,
        maxPropertyRows: 308,
        maxValueRows: 4_493,
      },
      exactFloor,
      productionBudget,
      promotionBudget,
      runtimeMaxDepth: policy.runtimeLimits.maxDepth,
    },
    observations: [
      observation(exactFloor - 1, 'failure', 45_626),
      observation(exactFloor, 'success', 45_627),
    ],
    optimization: {
      exactFloorReduction: 8_986,
      recordfieldExecutions: 0,
      removedRecordfieldIterations: 8_986,
      runtimeEngineChanged: false,
      strategy: 'reuse-authenticated-type-field-projection-for-assignment-target-kind',
      tableWideLoopAdded: false,
      typefieldTableProjectionExecutions: 1,
    },
    promotion: {
      combinedPromotionApproved: false,
      disposition: 'promotion-budget-headroom-authenticated',
      nextMilestone: 'M4.130',
      promotionReady: true,
    },
    result: {
      belowFloor: exactFloor - 1,
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      floorReduction: 8_986,
      productionHeadroom: productionBudget - exactFloor,
      promotionBudgetHeadroom: promotionBudget - exactFloor,
      roundTrip: true,
    },
    source: {
      ...structuredClone(SOURCE_DIGESTS),
      m4128ReceiptSha256: M4128_RECEIPT_DIGEST,
      publishedInputCommit: INPUT_COMMIT,
      runtimeHandlerAbi: KERN_RUNTIME_HANDLER_ABI,
    },
    witness: {
      artifactBytes: m4128.witness.artifactBytes,
      id: WITNESS_ID,
      parameterRows: m4128.witness.parameterRows,
      structuralRows: structuredClone(m4128.witness.structuralRows),
    },
  };
}

export function validateCanonicalizerRuntimeCostM4129(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeCostM4129();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.129 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM4129() {
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
  const result = validateCanonicalizerRuntimeCostM4129(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeCostM4129());
}
