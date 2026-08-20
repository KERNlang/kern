import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import {
  PRE_M4129_COMPOSITE_MEASUREMENT_REPLACEMENTS,
} from './assignment-target-projection-target.mjs';
import {
  canonicalCompositionRecordBytes,
} from './composition.mjs';
import {
  loadCanonicalizerCombinedHeadroomM4127,
} from './combined-headroom-m4-127.mjs';
import { digestPreM4135CompiledCoreJavaScript } from './coverage-dependencies.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import {
  loadPreM4129CanonicalizerComposition,
} from './historical-composition.mjs';
import { loadPreM4130CanonicalizerPolicy } from './historical-policy.mjs';
import {
  reconstructLegacyParameterSource,
} from './historical-parameter-sources.mjs';
import { reconstructHistoricalSource } from './historical-source.mjs';
import {
  PRE_M4131_RUNTIME_MEASUREMENT_REPLACEMENTS,
} from './validate-parameter-migration-target.mjs';
import { reconstructCanonicalizerHistoricalRuntimeSource } from './runtime-source-historical-chain.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-bottleneck.5';
const RECEIPT_DIGEST =
  '55512e5cdb91aa43b46ea8ccc09edb3cfe1890920071c13bed10c2d9f81440ac';
const SUMMARY_URL = new URL('./runtime-bottleneck-m4-128.json', import.meta.url);
const M4127_RECEIPT_DIGEST =
  '604f2b9a59d2cd4b56b2a4263fcbb5129dd7bfb41c0601e7573b4a576515dcce';
const M4127_RECEIPT_URL =
  new URL('./combined-headroom-m4-127.json', import.meta.url);
const INPUT_COMMIT = 'e874d1adf4371ebc76e87fbf564e6fa516305aff';
const WITNESS_ID =
  'examples/selfhost-validator/validator.kern#20:validate';
const VALUE_ROWS = 4_493;
const CANDIDATE_KIR = { maxBytes: 273_051, maxDepth: 98, maxNodes: 5_313 };
const CANDIDATE_PROFILE = {
  maxNodeRows: 202,
  maxPropertyRows: 308,
  maxValueRows: VALUE_ROWS,
};
const SOURCE_DIGESTS = {
  diagnosticObserverSha256:
    '6037e9f2e37e3888b45d64458c627c217abfd52105271de226bf47e053e495b6',
  effectMachineSha256:
    '3de758e08833d0881159f4716710701a605b45a0f56313bb191fabe02666e2eb',
  helperRuntimeSha256:
    'd3254d54b5bf2b86c89776faad6b49f073d0754c0bc10dd269ce887cd0c3229c',
  measurementSha256:
    'c15de2dee48ceaaa5327fd29195c11ef5a60f0f239825d869b42f950a9b42d3e',
  runtimeHandlerSha256:
    'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  runtimePolicySha256:
    'c1b4f5b8e28eb4c0bb8a7fa0ef0a7dff64a4dd4cc952a5594d9ac95502e349a5',
  sequenceSha256:
    'fbd95b89099ceffbb6c2e8f2136620bfe51bda5bd2a22ba93de1db7743a68bfe',
  witnessSourceSha256:
    '96a1c96800132f2401d743eac02f0efe8cb0717980ceb56c2af531798790eaac',
};
const SOURCE_URLS = {
  diagnosticObserverSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine-diagnostics.ts', import.meta.url),
  effectMachineSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine.ts', import.meta.url),
  helperRuntimeSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine-helper-runtime.ts', import.meta.url),
  measurementSha256:
    new URL('./runtime-bottleneck-m4-128-measure.mjs', import.meta.url),
  runtimeHandlerSha256:
    new URL('../../packages/core/src/runtime-handler.ts', import.meta.url),
  runtimePolicySha256:
    new URL('./policy.json', import.meta.url),
  sequenceSha256:
    new URL('../../packages/core/src/ir/semantics/internal-effect-machine-sequence.ts', import.meta.url),
  witnessSourceSha256:
    new URL('../../examples/selfhost-validator/validator.kern', import.meta.url),
};
const SELECTED_HELPERS = [
  'recordfield',
  'validstatementlist',
  'validstatement',
  'statementfacts',
  'exprsource',
  'expressionsources',
  'emitstatementlist',
  'emitstatement',
  'indentation',
];

function fail(message) {
  throw new TypeError(`coverage M4.128 runtime-bottleneck rejection: ${message}`);
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
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail('receipt arrays must use the plain prototype');
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.some((key) => typeof key === 'symbol') ||
      keys.length !== value.length + 1 ||
      Object.keys(value).length !== value.length
    ) fail('receipt arrays must be dense and undecorated');
    for (const [index, key] of Object.keys(value).entries()) {
      if (key !== String(index)) fail('receipt arrays must use canonical indices');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt arrays must contain plain enumerable data properties');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    fail('receipt objects must use the plain prototype');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('receipt objects must not contain symbols');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('receipt objects must contain plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  if (digest(readFileSync(M4127_RECEIPT_URL)) !== M4127_RECEIPT_DIGEST) {
    fail('M4.127 receipt bytes must remain exact');
  }
  const receipt = loadCanonicalizerCombinedHeadroomM4127();
  if (
    receipt.witnesses.length !== 1 ||
    receipt.witnesses[0].id !== WITNESS_ID ||
    receipt.witnesses[0].exactFloor !== 54_894 ||
    receipt.witnesses[0].profileRows.values !== VALUE_ROWS ||
    receipt.limits.promotionBudget !== 49_152 ||
    receipt.limits.productionBudget !== 65_536 ||
    receipt.promotion.promotionBudgetDeficit !== 5_742 ||
    receipt.promotion.combinedPromotionApproved
  ) fail('M4.127 witness, budgets, and NO-GO must remain exact');
  if (
    !canonicalBytes(receipt.limits.candidateKir).equals(canonicalBytes(CANDIDATE_KIR)) ||
    !canonicalBytes(receipt.limits.candidateProfile).equals(
      canonicalBytes(CANDIDATE_PROFILE),
    )
  ) fail('M4.127 candidate KIR and profile must remain exact');
  for (const [name, url] of Object.entries(SOURCE_URLS)) {
    if (name === 'runtimePolicySha256') continue;
    let source = readFileSync(url);
    if (
      name === 'diagnosticObserverSha256' ||
      name === 'effectMachineSha256' ||
      name === 'helperRuntimeSha256' ||
      name === 'sequenceSha256'
    ) {
      source = reconstructCanonicalizerHistoricalRuntimeSource({
        currentSource: source,
        expectedDigest: SOURCE_DIGESTS[name],
        milestone: `M4.128 ${name}`,
        sourceKey: name,
      });
    } else if (name === 'measurementSha256') {
      source = reconstructHistoricalSource({
        currentSource: source,
        expectedDigest: SOURCE_DIGESTS[name],
        milestone: 'M4.128 measurement',
        replacements: [
          ...PRE_M4129_COMPOSITE_MEASUREMENT_REPLACEMENTS,
          ...PRE_M4131_RUNTIME_MEASUREMENT_REPLACEMENTS,
        ],
      });
    } else if (name === 'witnessSourceSha256') {
      source = reconstructLegacyParameterSource({
        currentSource: source,
        expectedDigest: SOURCE_DIGESTS[name],
        milestone: 'M4.128 validate witness',
        name: 'validate',
      });
    }
    if (digest(source) !== SOURCE_DIGESTS[name]) {
      fail(`${name} executable input must remain exact`);
    }
  }
  const historicalPolicy = loadPreM4130CanonicalizerPolicy();
  if (digest(canonicalBytes(historicalPolicy)) !== SOURCE_DIGESTS.runtimePolicySha256) {
    fail('historical runtime policy identity must remain exact');
  }
  if (
    digestPreM4135CompiledCoreJavaScript() !==
      receipt.source.compiledCoreJavaScriptSha256
  ) fail('compiled core JavaScript must remain exact');
  const composition = loadPreM4129CanonicalizerComposition();
  if (
    digest(composition.composite) !==
      receipt.source.canonicalizerCompositeSha256 ||
    digest(canonicalCompositionRecordBytes(composition.record)) !==
      receipt.source.compositionRecordSha256
  ) fail('canonicalizer composition identities must remain exact');
  return receipt;
}

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
  executions,
  loops,
  outcome,
  phase,
  preparations,
  suspensions,
}) {
  return {
    cache,
    cacheKeyCodeUnits,
    iterationBudget: budget,
    loopIterations: loops,
    observerParityVerified: true,
    outcome,
    parentRestartCount: 0,
    phase,
    roundTrip: outcome === 'success',
    selectedHelperExecutions: selected(executions),
    selectedHelperPreparations: selected(preparations),
    selectedSuspensions: suspensions,
  };
}

const PROMOTION = observation({
  budget: 49_152,
  cache: { hits: 19_728, misses: 19_208 },
  cacheKeyCodeUnits: { maximum: 171_088, total: 850_680_033 },
  executions: selected({
    recordfield: 2, validstatementlist: 75, validstatement: 120,
    statementfacts: 121, exprsource: 138, expressionsources: 1,
    emitstatementlist: 0, emitstatement: 0, indentation: 0,
  }),
  loops: {
    attemptedByType: { for: 49_152 },
    retained: 49_152,
    rolledBack: 0,
  },
  outcome: 'failure',
  phase: 'second-recordfield-scan',
  preparations: selected({
    recordfield: 3, validstatementlist: 146, validstatement: 236,
    statementfacts: 316, exprsource: 276, expressionsources: 139,
    emitstatementlist: 0, emitstatement: 0, indentation: 0,
  }),
  suspensions: {
    'validstatement->recordfield': 2,
    'validstatement->exprsource': 138,
    'exprsource->expressionsources': 1,
    'emitstatementlist->emitstatement': 0,
    'emitstatement->emitstatementlist': 0,
  },
});

const MIDPOINT = observation({
  budget: 52_023,
  cache: { hits: 19_728, misses: 19_208 },
  cacheKeyCodeUnits: { maximum: 171_088, total: 850_680_033 },
  executions: selected({
    recordfield: 2, validstatementlist: 75, validstatement: 120,
    statementfacts: 121, exprsource: 138, expressionsources: 1,
    emitstatementlist: 0, emitstatement: 0, indentation: 0,
  }),
  loops: {
    attemptedByType: { for: 52_023 },
    retained: 52_023,
    rolledBack: 0,
  },
  outcome: 'failure',
  phase: 'second-recordfield-scan',
  preparations: selected({
    recordfield: 3, validstatementlist: 146, validstatement: 236,
    statementfacts: 316, exprsource: 276, expressionsources: 139,
    emitstatementlist: 0, emitstatement: 0, indentation: 0,
  }),
  suspensions: {
    'validstatement->recordfield': 2,
    'validstatement->exprsource': 138,
    'exprsource->expressionsources': 1,
    'emitstatementlist->emitstatement': 0,
    'emitstatement->emitstatementlist': 0,
  },
});

const UPPER = observation({
  budget: 53_500,
  cache: { hits: 21_066, misses: 20_810 },
  cacheKeyCodeUnits: { maximum: 171_096, total: 940_522_101 },
  executions: selected({
    recordfield: 2, validstatementlist: 100, validstatement: 159,
    statementfacts: 160, exprsource: 183, expressionsources: 1,
    emitstatementlist: 23, emitstatement: 40, indentation: 6,
  }),
  loops: {
    attemptedByType: { for: 53_404, while: 96 },
    retained: 53_500,
    rolledBack: 0,
  },
  outcome: 'failure',
  phase: 'emission-in-progress',
  preparations: selected({
    recordfield: 4, validstatementlist: 199, validstatement: 318,
    statementfacts: 482, exprsource: 411, expressionsources: 184,
    emitstatementlist: 43, emitstatement: 77, indentation: 46,
  }),
  suspensions: {
    'validstatement->recordfield': 2,
    'validstatement->exprsource': 183,
    'exprsource->expressionsources': 1,
    'emitstatementlist->emitstatement': 40,
    'emitstatement->emitstatementlist': 22,
  },
});

const FLOOR = observation({
  budget: 54_894,
  cache: { hits: 22_148, misses: 21_420 },
  cacheKeyCodeUnits: { maximum: 171_098, total: 1_033_257_783 },
  executions: selected({
    recordfield: 2, validstatementlist: 100, validstatement: 159,
    statementfacts: 160, exprsource: 183, expressionsources: 1,
    emitstatementlist: 100, emitstatement: 159, indentation: 12,
  }),
  loops: {
    attemptedByType: { for: 54_613, while: 281 },
    retained: 54_894,
    rolledBack: 0,
  },
  outcome: 'success',
  phase: 'complete',
  preparations: selected({
    recordfield: 4, validstatementlist: 199, validstatement: 318,
    statementfacts: 678, exprsource: 549, expressionsources: 184,
    emitstatementlist: 199, emitstatement: 318, indentation: 171,
  }),
  suspensions: {
    'validstatement->recordfield': 2,
    'validstatement->exprsource': 183,
    'exprsource->expressionsources': 1,
    'emitstatementlist->emitstatement': 159,
    'emitstatement->emitstatementlist': 99,
  },
});

export function buildCanonicalizerRuntimeBottleneckM4128() {
  const m4127 = exactInputs();
  const recordfieldIterations =
    FLOOR.selectedHelperExecutions.recordfield * VALUE_ROWS;
  const projectedFloor = FLOOR.iterationBudget - recordfieldIterations;
  return {
    baseline: {
      inputCommit: INPUT_COMMIT,
      m4127ReceiptSha256: M4127_RECEIPT_DIGEST,
      promotionBudgetDeficit: m4127.promotion.promotionBudgetDeficit,
    },
    diagnosis: {
      budgetAttribution:
        'all-retained-no-restarts-exact-recordfield-scan-source-attributed',
      emissionNotEnteredAtPromotion: true,
      exactRecordfieldIterations: recordfieldIterations,
      exactFloorRecordfieldShareBasisPoints:
        Math.round(recordfieldIterations * 10_000 / FLOOR.iterationBudget),
      mechanism:
        'two-full-value-table-recordfield-scans-during-assignment-target-validation',
      nextMilestone: 'M4.129',
      optimizationTarget:
        'fold-assignment-target-kind-authentication-into-existing-expression-projection',
      projectedFloorAfterTarget: projectedFloor,
      projectedPromotionHeadroom: m4127.limits.promotionBudget - projectedFloor,
      promotionFailureDuringSecondRecordfieldScan: true,
      promotionToMidpoint: {
        additionalForIterations: 2_871,
        changedCacheEvents: 0,
        changedHelperExecutions: 0,
        changedHelperPreparations: 0,
        changedHelperSuspensions: 0,
      },
      promotionToFloor: {
        additionalCacheHits: 2_420,
        additionalCacheKeyCodeUnits: 182_577_750,
        additionalCacheMisses: 2_212,
        additionalForIterations: 5_461,
        additionalRetainedIterations: 5_742,
        additionalWhileIterations: 281,
      },
      recordfieldIterationsBeyondDeficit:
        recordfieldIterations - m4127.promotion.promotionBudgetDeficit,
      upperToFloor: {
        additionalEmitstatementExecutions: 119,
        additionalForIterations: 1_209,
        additionalRetainedIterations: 1_394,
        additionalWhileIterations: 185,
      },
      valueRowsPerRecordfieldScan: VALUE_ROWS,
    },
    format: FORMAT,
    limits: {
      exactFloor: FLOOR.iterationBudget,
      productionBudget: m4127.limits.productionBudget,
      promotionBudget: m4127.limits.promotionBudget,
      requiredFloorReduction: m4127.promotion.requiredFloorReduction,
      runtimeMaxDepth: m4127.limits.runtimeMaxDepth,
    },
    measurement: {
      disposition: 'authenticated-diagnosis-only',
      kirPolicyChanged: false,
      profilePolicyChanged: false,
      runtimePolicyChanged: false,
      sourceChanged: false,
    },
    observations: [
      structuredClone(PROMOTION),
      structuredClone(MIDPOINT),
      structuredClone(UPPER),
      structuredClone(FLOOR),
    ],
    observer: {
      elapsedTimeExcluded: true,
      helperExecuteSemantics: 'entry-not-completion',
      observerDefault: 'off',
      recentPromotionTail: [
        'prepare:recordfield',
        'cache:recordfield:miss',
        'suspend:validstatement->recordfield',
        'cache:recordfield:miss',
        'execute:recordfield',
      ],
    },
    promotion: {
      combinedPromotionApproved: false,
      nextMilestone: 'M4.129',
      requiredFloorReduction: m4127.promotion.requiredFloorReduction,
    },
    source: {
      ...structuredClone(SOURCE_DIGESTS),
      canonicalizerCompositeSha256:
        m4127.source.canonicalizerCompositeSha256,
      compiledCoreJavaScriptSha256:
        m4127.source.compiledCoreJavaScriptSha256,
      compositionRecordSha256:
        m4127.source.compositionRecordSha256,
      m4127ReceiptSha256: M4127_RECEIPT_DIGEST,
      m4127PublishedInputCommit: m4127.source.publishedInputCommit,
      publishedInputCommit: INPUT_COMMIT,
      runtimeHandlerAbi: KERN_RUNTIME_HANDLER_ABI,
    },
    witness: {
      artifactBytes: m4127.witnesses[0].artifactBytes,
      id: WITNESS_ID,
      parameterRows: m4127.witnesses[0].parameterRows,
      structuralRows: structuredClone(m4127.witnesses[0].profileRows),
    },
  };
}

export function validateCanonicalizerRuntimeBottleneckM4128(value) {
  assertPlainReceiptData(value);
  const expected = buildCanonicalizerRuntimeBottleneckM4128();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('diagnosis must match the exact M4.128 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated diagnosis exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeBottleneckM4128() {
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
  const result = validateCanonicalizerRuntimeBottleneckM4128(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, buildCanonicalizerRuntimeBottleneckM4128());
}
