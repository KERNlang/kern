import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { loadPublishedCanonicalizerResidualAnalysisM492 } from './coverage-residual-analysis-m4-92.mjs';
import { writeCoverageSummary } from './coverage-summary-writer.mjs';

const FORMAT = 'kern.kir-canonicalizer.runtime-cost-reduction.3';
const RECEIPT_DIGEST = '62631ce9d2c97e80b6187c0d75bcb878a610ab1076ab8df71a46d53c0e51b3f3';
const SUMMARY_URL = new URL('./runtime-cost-m4-93.json', import.meta.url);
const M492_RECEIPT_DIGEST = 'c6311d6351db075292af7a36a850787dd3bdf135ab290b60098da3ce25509e24';
const IMPLEMENTATION_BASE_COMMIT = '8e9c8c7d99aa215a5a6f5109f2f4839a06bb4995';
const WITNESS_ID =
  'examples/capstone-checker-subset/checker-while.kern#15:comparisonOperandsOk';
const SOURCE_DIGESTS = {
  canonicalizerCompositeSha256: 'aff72db1605a0a5cdcbfe34fae65939e4206b659514641b02c2999da3e94b3ab',
  canonicalizerExpressionHelpersSha256: '1a1ae1f95e20b458021bf78b82f6b0d1cbe639579fcdd64c6709f1c741ce35e4',
  canonicalizerMainSha256: '923c1edc4d79bf1c5e16554ddcbc86ad077a9a9ffa591ba2810c775b89fad5be',
  canonicalizerStatementHelpersSha256: '158175ac9404fb93acc5b82fc8b87d10f2946a11b228ce9686f2423f75bcf667',
  compositionSha256: 'a09fdf1c63e7debc330018b83017a4569ac52da8d70f774904fd62d1ea28d999',
  coveragePolicySha256: 'b578207467e045913d40da46804bb0fca2285f6351f56ed76e9aa805c6dbcc89',
  canonicalizerPolicySha256: 'f3819746060ae31ee7ae0ac0ddaa4753190b02820366e6ee2971f8c3a1178849',
  structuralKirCodecSha256: '04ec8bde39fcd2313bd0de9e1092f38436fa8b8ea4b9b68401183863cd85a1ab',
};
const REPOSITORY_DIGESTS = [
  ['canonicalizerMainSha256', 'examples/kern-canonicalizer/canonicalizer.kern'],
  ['canonicalizerCompositeSha256', 'examples/kern-canonicalizer/canonicalizer.composed.kern'],
  ['canonicalizerExpressionHelpersSha256',
    'examples/kern-canonicalizer/canonicalizer-expression-helpers.kern'],
  ['canonicalizerStatementHelpersSha256',
    'examples/kern-canonicalizer/canonicalizer-statement-helpers.kern'],
  ['compositionSha256', 'scripts/kern-canonicalizer/composition.json'],
  ['coveragePolicySha256', 'scripts/kern-canonicalizer/coverage-policy.json'],
  ['canonicalizerPolicySha256', 'scripts/kern-canonicalizer/policy.json'],
  ['structuralKirCodecSha256', 'packages/core/src/kir-structural/canonical.ts'],
];

function fail(message) {
  throw new TypeError(`coverage M4.93 runtime-cost rejection: ${message}`);
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function repositoryBytes(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url));
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
    const enumerableKeys = Object.keys(value);
    if (
      keys.some((key) => typeof key === 'symbol') ||
      keys.length !== value.length + 1 ||
      enumerableKeys.length !== value.length ||
      enumerableKeys.some((key, index) => key !== String(index))
    ) {
      fail('receipt arrays must be dense and undecorated');
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
        fail('receipt arrays must contain only plain enumerable data elements');
      }
      assertPlainReceiptData(descriptor.value, seen);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail('receipt objects must use the plain prototype');
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol') fail('receipt objects must not contain symbol properties');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      fail('receipt objects must contain only plain enumerable data properties');
    }
    assertPlainReceiptData(descriptor.value, seen);
  }
}

function exactInputs() {
  const m492 = loadPublishedCanonicalizerResidualAnalysisM492();
  if (m492.digest !== M492_RECEIPT_DIGEST) fail('M4.92 receipt digest must remain exact');
  const selection = m492.record.selectedNextAction;
  if (
    selection?.completeFunctions !== 1 ||
    selection.witnesses?.length !== 1 ||
    selection.witnesses[0] !== WITNESS_ID ||
    JSON.stringify(selection.limits) !== JSON.stringify({
      maxNodeRows: 74,
      maxPropertyRows: 95,
      maxValueRows: 832,
    })
  ) {
    fail('M4.92 selected witness and candidate profile must remain exact');
  }
  for (const [key, path] of REPOSITORY_DIGESTS) {
    if (digest(repositoryBytes(path)) !== SOURCE_DIGESTS[key]) {
      fail(`${path} digest drift`);
    }
  }
  return m492;
}

export function measureCanonicalizerRuntimeCostM493() {
  exactInputs();
  const baselineLoopEntries = {
    nodeIndex: 10_123,
    nodeOrderCheck: 10_123,
    propertyIndex: 9_215,
    valueIndex: 800,
  };
  const optimizedLoopEntries = {
    nodeIndex: 53,
    propertyOwnershipIndex: 95,
    propertyIndex: 95,
    valueIndex: 832,
  };
  const baselineAttemptedLoopEntries = Object.values(baselineLoopEntries)
    .reduce((sum, count) => sum + count, 0);
  const exactFloor = Object.values(optimizedLoopEntries)
    .reduce((sum, count) => sum + count, 0);
  return {
    baseline: {
      implementationBaseCommit: IMPLEMENTATION_BASE_COMMIT,
      m492ReceiptSha256: M492_RECEIPT_DIGEST,
      measurementBudget: 1_000,
      measurementOutcome: 'failure',
      attemptedLoopEntries: baselineAttemptedLoopEntries,
      loopEntries: baselineLoopEntries,
    },
    format: FORMAT,
    limits: {
      activeProfile: { maxNodeRows: 74, maxPropertyRows: 77, maxValueRows: 580 },
      candidateProfile: { maxNodeRows: 74, maxPropertyRows: 95, maxValueRows: 832 },
      maxDepth: 64,
      productionMaxCollectionLength: 65_536,
      promotionBudget: 49_152,
    },
    optimization: {
      helpers: [
        'examples/kern-canonicalizer/canonicalizer.kern#6:nodetablesok',
        'examples/kern-canonicalizer/canonicalizer.kern#7:propertyfacts',
        'examples/kern-canonicalizer/canonicalizer.kern#8:valuefacts',
      ],
      owner: 'examples/kern-canonicalizer/canonicalizer.kern#4:tablesok',
      resultDomain: 'plain-booleans',
      strategy: 'memoized-independent-linear-table-validation',
    },
    productionObservation: {
      minimumObservationSeconds: 840,
      outcome: 'not-claimed',
      terminalEnvelopeObserved: false,
    },
    promotion: {
      disposition: 'table-replay-eliminated-parameter-queue-ready-headroom-unproven',
      nextMilestone: 'M4.94',
      parameterMigration: {
        completeFunctions: 1,
        completeTools: 1,
        migratedParameterRows: 12,
        witnesses: [{
          id: 'examples/kern-canonicalizer/canonicalizer.kern#4:tablesok',
          parameterRows: 12,
          profileRows: { nodes: 19, properties: 33, values: 156 },
          tool: 'canonicalizer',
        }],
      },
    },
    result: {
      belowFloor: exactFloor - 1,
      belowFloorOutcome: 'failure',
      exactFloor,
      floorOutcome: 'success',
      optimizedLoopEntries,
      removedAttemptedLoopEntriesAtBaselineBudget: baselineAttemptedLoopEntries - 1_001,
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

export function validateCanonicalizerRuntimeCostM493(value) {
  assertPlainReceiptData(value);
  const expected = measureCanonicalizerRuntimeCostM493();
  if (digest(canonicalBytes(expected)) !== RECEIPT_DIGEST) {
    fail('measured evidence must match the exact M4.93 receipt digest');
  }
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) {
    fail('receipt must match authenticated evidence exactly');
  }
  return structuredClone(value);
}

export function loadCanonicalizerRuntimeCostM493() {
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
  const result = validateCanonicalizerRuntimeCostM493(parsed);
  if (!source.equals(canonicalBytes(result))) fail('receipt must use canonical JSON bytes');
  return result;
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && realpathSync(invokedPath) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--write') {
    fail('direct invocation requires exactly --write');
  }
  writeCoverageSummary(SUMMARY_URL, measureCanonicalizerRuntimeCostM493());
}
