import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { runScan } from '../kern-frontend-f1-scan/worker.mjs';
import { runBatchWithScan } from '../kern-frontend-f2-batch/worker.mjs';
import { decodeDocument, fail, sha256 } from './decoder.mjs';

const POLICY_URL = new URL('./policy.json', import.meta.url);
const RAW_OPENER_TYPES = ['body', 'cleanup', 'doc', 'handler', 'logic', 'render'];
const LIMIT_KEYS = [
  'maxRecords',
  'maxLogicalLines',
  'maxParentEdges',
  'maxDecoratorRuns',
  'maxRawBlocks',
  'maxStructuralDiagnostics',
  'maxWorkSteps',
  'maxEncodedBytes',
];

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} shape`);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} keys`);
}

function positiveLimits(value, keys, label) {
  exactKeys(value, keys, label);
  for (const [key, item] of Object.entries(value)) {
    if (!Number.isSafeInteger(item) || item < 1) fail(`${label} ${key}`);
  }
}

export function validatePolicy(policy) {
  exactKeys(policy, [
    'format', 'resultFormat', 'sourcePath', 'sourceSha256', 'helperPath', 'helperSha256', 'rawOpenerTypes',
    'profileLimits', 'scalingWalls', 'runtimeLimits', 'scheduler',
  ], 'policy');
  if (policy.format !== 'kern.frontend.f3-line-tree-policy.1' || policy.resultFormat !== 'kern.frontend.f3-line-tree.1') {
    fail('policy format');
  }
  if (policy.sourcePath !== 'examples/kern-frontend/f3-line-tree-main.kern' ||
      policy.helperPath !== 'examples/kern-frontend/f3-line-tree-collection-helpers.kern' ||
      !/^[0-9a-f]{64}$/u.test(policy.sourceSha256) || !/^[0-9a-f]{64}$/u.test(policy.helperSha256)) {
    fail('source authority');
  }
  positiveLimits(policy.profileLimits, LIMIT_KEYS, 'profile limits');
  if (!Array.isArray(policy.rawOpenerTypes) ||
      JSON.stringify(policy.rawOpenerTypes) !== JSON.stringify(RAW_OPENER_TYPES)) {
    fail('raw opener registry');
  }
  exactKeys(policy.scalingWalls, [
    'densityCounts', 'fullDensityLines', 'maxAdjacentByteRatio', 'maxAdjacentTimeRatio',
    'maxElapsedMs', 'maxPeakRssBytes', 'timeSlackMs',
  ], 'scaling walls');
  if (!Array.isArray(policy.scalingWalls.densityCounts) || policy.scalingWalls.densityCounts.length !== 4 ||
      policy.scalingWalls.densityCounts.some((value, index, values) =>
        !Number.isSafeInteger(value) || value < 1 || (index > 0 && value !== values[index - 1] * 2))) {
    fail('scaling density counts');
  }
  for (const key of [
    'fullDensityLines', 'maxAdjacentByteRatio', 'maxAdjacentTimeRatio', 'maxElapsedMs',
    'maxPeakRssBytes', 'timeSlackMs',
  ]) {
    if (!Number.isSafeInteger(policy.scalingWalls[key]) || policy.scalingWalls[key] < 1) {
      fail(`scaling wall ${key}`);
    }
  }
  positiveLimits(policy.runtimeLimits,
    ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxIterations', 'maxStringBytes'],
    'runtime limits');
  positiveLimits(policy.scheduler, ['timeoutMs'], 'scheduler');
  if (policy.profileLimits.maxParentEdges > policy.profileLimits.maxLogicalLines ||
      policy.profileLimits.maxDecoratorRuns > policy.profileLimits.maxLogicalLines ||
      policy.profileLimits.maxRawBlocks > policy.profileLimits.maxLogicalLines ||
      policy.scalingWalls.fullDensityLines > policy.profileLimits.maxLogicalLines ||
      policy.runtimeLimits.maxBytes !== policy.profileLimits.maxEncodedBytes ||
      policy.runtimeLimits.maxStringBytes !== policy.profileLimits.maxEncodedBytes) {
    fail('limit relationship');
  }
  return policy;
}

export function loadPolicy() {
  const bytes = readFileSync(POLICY_URL, 'utf8');
  const policy = validatePolicy(JSON.parse(bytes));
  return { bytes, policy, sha256: sha256(bytes) };
}

function effectiveLimits(base, overrides) {
  if (overrides === undefined) return { ...base };
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) fail('profile limit override shape');
  for (const [key, value] of Object.entries(overrides)) {
    if (!LIMIT_KEYS.includes(key) || !Number.isSafeInteger(value) || value < 1 || value > base[key]) {
      fail(`profile limit override ${key}`);
    }
  }
  return { ...base, ...overrides };
}

function loadF3Composition(policyState) {
  const f3Source = readFileSync(new URL(`../../${policyState.policy.sourcePath}`, import.meta.url), 'utf8');
  const helperSource = readFileSync(new URL(`../../${policyState.policy.helperPath}`, import.meta.url), 'utf8');
  if (sha256(f3Source) !== policyState.policy.sourceSha256) fail('f3 source digest');
  if (sha256(helperSource) !== policyState.policy.helperSha256) fail('f3 helper digest');
  const composition = `${helperSource}\n${f3Source}`;
  if (/(?:parseExpression|projectExpressionText|typescript|kern\.frontend\..*-shadow)/u.test(composition)) {
    fail('forbidden f3 authority');
  }
  if ((composition.match(/export=true/gu) ?? []).length !== 1 ||
      !/fn name=structuref3document returns="string\[\]" export=true/u.test(f3Source)) fail('f3 export closure');
  return { composition, f3Source, helperSource };
}

function prepareBase(source, options) {
  if (typeof source !== 'string') fail('source type');
  const policyState = loadPolicy();
  const limits = effectiveLimits(policyState.policy.profileLimits, options.profileLimits);
  return { limits, policyState };
}

function prepareAvailableDocument(source, options, base, scan, batch) {
  const { limits, policyState } = base;
  const loaded = loadF3Composition(policyState);
  const records = scan.decoded.records;
  const segments = batch.receipt.segments;

  const request = {
    records,
    segments,
    sourceScalars: scan.decoded.sourceScalars,
  };

  const context = {
    f3PolicySha256: policyState.sha256,
    f1ReceiptSha256: sha256(scan.fields),
    f2bReceiptSha256: sha256(batch.fields),
    allowForcedLateFailure: options.forceLateFailure === true,
    limits,
    resultFormat: policyState.policy.resultFormat,
    rawOpenerTypes: policyState.policy.rawOpenerTypes,
  };

  return { context, limits, loaded, policyState, request, scan, batch };
}

function collectPrerequisites(source, options = {}, observe = undefined) {
  const base = prepareBase(source, options);
  observe?.('f1');
  const scan = runScan(source);
  if (scan.decoded.status !== 'scanned') {
    return { prerequisiteStates: ['failed', 'not-attempted', 'not-attempted'], scan };
  }
  observe?.('f2b');
  const batch = runBatchWithScan(source, scan);
  if (batch.receipt.status !== 'batched') {
    return { prerequisiteStates: ['available', 'failed', 'not-attempted'], scan, batch };
  }
  return {
    prerequisiteStates: ['available', 'available', 'not-attempted'],
    prepared: prepareAvailableDocument(source, options, base, scan, batch),
    scan,
    batch,
  };
}

function prepareDocument(source, options = {}, observe = undefined) {
  const outcome = collectPrerequisites(source, options, observe);
  if (outcome.prerequisiteStates[0] === 'failed') {
    fail(`F1 rejected source: ${outcome.scan.decoded.diagnostic.code}`);
  }
  if (outcome.prerequisiteStates[1] === 'failed') {
    fail(`F2B rejected source: ${outcome.batch.receipt.diagnostic.code}`);
  }
  return outcome.prepared;
}

function executePreparedFields(source, prepared, options) {
  const { context, limits, loaded, policyState, request, scan } = prepared;
  const runtimeLimits = {
    ...policyState.policy.runtimeLimits,
    maxBytes: Math.min(policyState.policy.runtimeLimits.maxBytes, limits.maxEncodedBytes),
    maxStringBytes: Math.min(policyState.policy.runtimeLimits.maxStringBytes, limits.maxEncodedBytes),
  };

  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      source,
      request.records.map((r) => r.kindId),
      request.records.map((r) => r.flags),
      request.records.map((r) => r.startScalar),
      request.records.map((r) => r.endScalar),
      scan.fields[7],
      request.segments.map((s) => s.firstRecordOrdinal),
      request.segments.map((s) => s.lastRecordOrdinal),
      request.segments.map((s) => s.outerStartScalar),
      request.segments.map((s) => s.outerEndScalar),
      request.segments.map((s) => s.bodyStartScalar),
      request.segments.map((s) => s.bodyEndScalar),
      policyState.policy.rawOpenerTypes,
      limits.maxRecords,
      limits.maxLogicalLines,
      limits.maxParentEdges,
      limits.maxDecoratorRuns,
      limits.maxRawBlocks,
      limits.maxStructuralDiagnostics,
      limits.maxWorkSteps,
      options.forceLateFailure === true,
    ],
    identity: { handlerName: 'structuref3document', sourcePath: policyState.policy.sourcePath },
    source: loaded.composition,
  }, { enabled: true, limits: runtimeLimits, scheduler: policyState.policy.scheduler });

  if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
      envelope.result.presence !== 'value' || envelope.result.value.tag !== 'list' || envelope.events.length !== 0) {
    fail(`runtime envelope ${JSON.stringify(envelope)}`);
  }
  return materialize(envelope.result.value);
}

function executePreparedDocument(source, prepared, options, observe = undefined) {
  observe?.('f3');
  const fields = executePreparedFields(source, prepared, options);
  const { batch, context, request, scan } = prepared;
  const decoded = decodeDocument(fields, source, request, context);
  return { ...decoded, batch, fields, runtimeInvocations: 1, scan };
}

function collectDocumentOutcome(source, options = {}, observe = undefined) {
  const outcome = collectPrerequisites(source, options, observe);
  if (outcome.prepared === undefined) return outcome;
  const { batch, prepared, scan } = outcome;
  const document = executePreparedDocument(source, prepared, options, observe);
  const prerequisiteStates = document.receipt.status === 'structured'
    ? ['available', 'available', 'available']
    : ['available', 'available', 'failed'];
  return { prerequisiteStates, scan, batch, document };
}

export function runDocumentOutcome(source, options = {}) {
  return collectDocumentOutcome(source, options);
}

export function runDocument(source, options = {}) {
  return executePreparedDocument(source, prepareDocument(source, options), options);
}

export function verifyDocumentFields(source, fields, options = {}) {
  const prepared = prepareDocument(source, options);
  const decoded = decodeDocument(fields, source, prepared.request, prepared.context);
  const expectedFields = executePreparedFields(source, prepared, options);
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)) fail('receipt replay mismatch');
  return decoded;
}

function runWithRequestMutation(source, mutate) {
  const options = {};
  const prepared = prepareDocument(source, options);
  mutate(prepared.request, prepared);
  return executePreparedDocument(source, prepared, options);
}

export const __test = {
  runWithRequestMutation,
  runDocumentOutcomeWithObserver(source, options, observe) {
    if (typeof observe !== 'function') fail('observer');
    return collectDocumentOutcome(source, options, observe);
  },
  runDocumentWithObserver(source, options, observe) {
    if (typeof observe !== 'function') fail('observer');
    return executePreparedDocument(source, prepareDocument(source, options, observe), options, observe);
  },
};
