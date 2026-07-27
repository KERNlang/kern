import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { loadPublishedCanonicalizerResidualAnalysisM495 } from './coverage-residual-analysis-m4-95.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';
import { loadCanonicalizerRuntimeCostM493 } from './runtime-cost-m4-93.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-bottleneck.1';
const RECEIPT_DIGEST = '3a80e118c7621923401596d7ab16fd013067363daa88b819817c0208e2afe391';
const SUMMARY_URL = new URL('./runtime-bottleneck-m4-96.json', import.meta.url);
const M493_RECEIPT_DIGEST = '62631ce9d2c97e80b6187c0d75bcb878a610ab1076ab8df71a46d53c0e51b3f3';
const M495_RECEIPT_DIGEST = 'f69bbae69a3f25d059dcdc23e023f4432dcd23c19dc9e6228087811f178a4928';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk';
const SOURCE_DIGESTS = {
  diagnosticObserverSha256: '5ec2371772592e27e5978bdbc546c2457bf0b2b2f57a4659502f0eb7e5d38bd5',
  effectMachineSha256: '1a20b7512f63c3dbd752cf8788c7dcbab187158e4ec618d3b34646c1567c0ddd',
  effectMachineTypesSha256: '940848eff7fb9c63e2539d2f250934c0e9fe1379f171290b3017c3fc1d1a650f',
  envelopeExecuteCompatSha256: '0a6aab9d9d9cc3861bccbf173fc4886b9252cef0dee77cae6b77795692df6904',
  envelopeExecuteSha256: '2b364468abdfbaf204fff5ee5f047cf5d9536bcf526e022e8c8b4d77ad1196aa',
  envelopeTypesSha256: '867977e57f7de7e3491ed2db84ab544ba22513154c0c893afba70cb832e8f626',
  helperRuntimeSha256: 'e2249e5b67594b129da870da973c415eacac5259ac43d66d32d18404134f2809',
  internalEngineSha256: '8942228e95a0c523aab81244366faa8863d798fd29ff9c127417889572f5a7d0',
  measurementSha256: '84303bed8a56e2c6783292c3880f25598abdbc4c518a97e19b815e91ed913058',
  publicRuntimeHandlerSha256: 'f2ca9bd81f2f6c37fc5c931037ba008eb3cf1f3675beb4cc2d74b767cff7f8a1',
  sequenceSha256: '5bf2c66b99fc825cc78bbe89d10c35a90c7d9cb4e66e40ce03cbd49f3f1c8745',
};
function fail(message) {
  throw new TypeError(`coverage M4.96 runtime-bottleneck rejection: ${message}`);
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
  const m493 = loadCanonicalizerRuntimeCostM493();
  const m495 = loadPublishedCanonicalizerResidualAnalysisM495();
  if (digest(canonicalBytes(m493)) !== M493_RECEIPT_DIGEST) fail('M4.93 receipt digest must remain exact');
  if (m495.digest !== M495_RECEIPT_DIGEST) fail('M4.95 receipt digest must remain exact');
  const selection = m495.record.selectedNextAction;
  if (
    selection?.completeFunctions !== 1 ||
    selection.witnesses?.[0] !== WITNESS_ID ||
    JSON.stringify(selection.limits) !== JSON.stringify({
      maxNodeRows: 74,
      maxPropertyRows: 95,
      maxValueRows: 832,
    })
  ) {
    fail('M4.95 selected witness and structural profile must remain exact');
  }
  return { m493, m495 };
}

export function measureCanonicalizerRuntimeBottleneckM496() {
  const { m493, m495 } = exactInputs();
  return {
    baseline: {
      implementationBaseCommit: 'f3f2f8ccfd37746e5c06bbd25623887326845f4e',
      m493ReceiptSha256: M493_RECEIPT_DIGEST,
      m495ReceiptSha256: M495_RECEIPT_DIGEST,
      priorProductionObservation: structuredClone(m493.productionObservation),
      residualReasonAssignmentsSha256: m495.record.assignmentsDigest,
    },
    diagnosis: {
      additionalBudget: 500,
      additionalCacheKeyCodeUnits: 38_788_004,
      additionalExpressionsourcesExecutions: 91,
      additionalRetainedIterations: 500,
      additionalRolledBackIterations: 78_379,
      dominantHelper: 'expressionsources',
      mechanism: 'parent-frame-restart-after-nested-helper-cache-miss',
      nextMilestone: 'M4.97',
      selectedRestartBreakdown: {
        'expressionsources->stringat': 83,
        'expressionsources->validbinaryop': 2,
        'expressionsources->validexpressionidentifier': 6,
      },
    },
    format: FORMAT,
    limits: {
      activeProfile: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
      candidateProfile: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
      productionMaxCollectionLength: 65_536,
      promotionBudget: 49_152,
    },
    observations: [
      {
        cache: { hits: 2_303, misses: 1_269 },
        cacheKeyCodeUnits: { maximum: 31_994, total: 10_231_254 },
        expressionsources: { executions: 1, parentRestarts: 0, preparations: 1 },
        iterationBudget: 34_000,
        loopIterations: { attempted: 34_266, retained: 34_000, rolledBack: 266 },
        outcome: 'failure',
        publicParityVerified: true,
      },
      {
        cache: { hits: 8_894, misses: 1_572 },
        cacheKeyCodeUnits: { maximum: 31_994, total: 49_019_258 },
        expressionsources: { executions: 92, parentRestarts: 91, preparations: 1 },
        iterationBudget: 34_500,
        loopIterations: { attempted: 113_145, retained: 34_500, rolledBack: 78_645 },
        outcome: 'failure',
        publicParityVerified: false,
      },
    ],
    observer: {
      defaultOff: true,
      eventData: 'frozen-scalars',
      failureDisposition: 'ignored',
      publicHandlerOptionExposed: false,
    },
    promotion: {
      disposition: 'runtime-bottleneck-attributed-headroom-unproven',
      profilePromotionApproved: false,
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

export function validateCanonicalizerRuntimeBottleneckM496(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerRuntimeBottleneckM496();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.96 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeBottleneckM496() {
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
  const result = validateCanonicalizerRuntimeBottleneckM496(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerRuntimeBottleneckM496());
}
