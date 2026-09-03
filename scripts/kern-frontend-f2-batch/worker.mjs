import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { decodeScan, loadPolicy as loadF1Policy } from '../kern-frontend-f1-scan/decoder.mjs';
import { loadComposition as loadF1Composition, runScan } from '../kern-frontend-f1-scan/worker.mjs';
import { loadPolicy as loadF2Policy } from '../kern-frontend-f2-expression/decoder.mjs';
import { loadComposition as loadF2Composition } from '../kern-frontend-f2-expression/worker.mjs';
import { decodeBatch } from './decoder.mjs';

const POLICY_URL = new URL('./policy.json', import.meta.url);
const LIMIT_KEYS = [
  'maxAbsoluteSpans', 'maxAggregateBodyScalars', 'maxAggregateNodes', 'maxEncodedBytes',
  'maxRecords', 'maxSegments', 'maxWorkSteps',
];

function fail(message) {
  throw new Error(`F2 batch contract: ${message}`);
}

function sha256(value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value);
  return createHash('sha256').update(bytes).digest('hex');
}

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

export function loadPolicy() {
  const bytes = readFileSync(POLICY_URL, 'utf8');
  const policy = JSON.parse(bytes);
  exactKeys(policy, [
    'format', 'resultFormat', 'sourcePath', 'sourceSha256', 'profileLimits', 'scalingWalls',
    'runtimeLimits', 'scheduler',
  ], 'policy');
  if (policy.format !== 'kern.frontend.f2-batch-policy.1' || policy.resultFormat !== 'kern.frontend.f2-batch.1') {
    fail('policy format');
  }
  if (policy.sourcePath !== 'examples/kern-frontend/f2-batch-main.kern' || !/^[0-9a-f]{64}$/u.test(policy.sourceSha256)) {
    fail('source authority');
  }
  positiveLimits(policy.profileLimits, LIMIT_KEYS, 'profile limits');
  exactKeys(policy.scalingWalls, [
    'densityCounts', 'fullDensitySegments', 'maxAdjacentByteRatio', 'maxAdjacentTimeRatio',
    'maxElapsedMs', 'maxPeakRssBytes', 'timeSlackMs',
  ], 'scaling walls');
  if (!Array.isArray(policy.scalingWalls.densityCounts) || policy.scalingWalls.densityCounts.length !== 4 ||
      policy.scalingWalls.densityCounts.some((value, index, values) =>
        !Number.isSafeInteger(value) || value < 1 || (index > 0 && value !== values[index - 1] * 2))) {
    fail('scaling density counts');
  }
  for (const key of [
    'fullDensitySegments', 'maxAdjacentByteRatio', 'maxAdjacentTimeRatio', 'maxElapsedMs',
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
  if (policy.profileLimits.maxAbsoluteSpans < policy.profileLimits.maxAggregateNodes ||
      policy.scalingWalls.fullDensitySegments !== policy.profileLimits.maxSegments ||
      policy.runtimeLimits.maxBytes !== policy.profileLimits.maxEncodedBytes ||
      policy.runtimeLimits.maxStringBytes !== policy.profileLimits.maxEncodedBytes) fail('limit relationship');
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

function moduleDigest(modules) {
  return sha256(Object.entries(modules).sort(([left], [right]) => left.localeCompare(right)));
}

function discoverSegments(source, records, maxRecords) {
  if (records.length > maxRecords) fail('F1 record request limit');
  const sourcePoints = Array.from(source);
  const segments = [];
  let open = null;
  for (const record of records) {
    const opener = record.kind === 'expr' && (record.flags & 1) !== 0;
    const closer = record.kind === 'expr' && (record.flags & 2) !== 0;
    if (opener) {
      if (open !== null) fail('nested F1 expression opener');
      open = [record];
    } else if (open !== null) {
      if (record.kind !== 'expr' && record.kind !== 'newline' && !(record.kind === 'unknown' && record.raw === '\r')) {
        fail('invalid F1 expression continuation');
      }
      open.push(record);
    }
    if (closer) {
      if (open === null) fail('orphan F1 expression closer');
      const first = open[0];
      const raw = open.map((item) => item.raw).join('');
      const outer = sourcePoints.slice(first.startScalar, record.endScalar).join('');
      if (raw !== outer || !raw.startsWith('{{') || !raw.endsWith('}}')) fail('F1 expression source drift');
      const bodyStartScalar = first.startScalar + 2;
      const bodyEndScalar = record.endScalar - 2;
      const body = sourcePoints.slice(bodyStartScalar, bodyEndScalar).join('');
      segments.push({
        body,
        bodyEndScalar,
        bodySha256: sha256(body),
        bodyStartScalar,
        firstRecordOrdinal: first.ordinal,
        lastRecordOrdinal: record.ordinal,
        outerEndScalar: record.endScalar,
        outerStartScalar: first.startScalar,
        recordSha256: sha256(open),
      });
      open = null;
    }
  }
  if (open !== null) fail('unclosed F1 expression segment');
  return { segments, sourceScalars: sourcePoints.length };
}

function loadBatchComposition(policyState, f2Policy) {
  const f2 = loadF2Composition(f2Policy);
  const batchSource = readFileSync(new URL(`../../${policyState.policy.sourcePath}`, import.meta.url), 'utf8');
  if (sha256(batchSource) !== policyState.policy.sourceSha256) fail('batch source digest');
  if (/(?:parseExpression|projectExpressionText|typescript|kern\.frontend\..*-shadow)/u.test(batchSource)) {
    fail('forbidden batch authority');
  }
  const composition = `${f2.composition}\n${batchSource}`;
  if ((composition.match(/export=true/gu) ?? []).length !== 2 ||
      !/fn name=parsef2batch returns="string\[\]" export=true/u.test(batchSource)) fail('batch export closure');
  return { batchSource, composition, f2 };
}

function authenticatedScan(source, supplied) {
  if (supplied === undefined) return runScan(source);
  if (!supplied || typeof supplied !== 'object' || !Array.isArray(supplied.fields)) {
    fail('authenticated F1 scan shape');
  }
  const f1Policy = loadF1Policy();
  const decoded = decodeScan(supplied.fields, source, f1Policy);
  if (decoded.status !== 'scanned') fail(`F1 rejected batch source: ${decoded.diagnostic.code}`);
  const loaded = loadF1Composition(f1Policy);
  return {
    ...supplied,
    decoded,
    moduleSha256: Object.fromEntries(loaded.modules.map((module) => [module.path, module.sha256])),
  };
}

function prepareBatch(source, options = {}, suppliedScan) {
  if (typeof source !== 'string') fail('source type');
  const policyState = loadPolicy();
  const limits = effectiveLimits(policyState.policy.profileLimits, options.profileLimits);
  const scan = authenticatedScan(source, suppliedScan);
  if (scan.decoded.status !== 'scanned') fail(`F1 rejected batch source: ${scan.decoded.diagnostic.code}`);
  const request = discoverSegments(source, scan.decoded.records, limits.maxRecords);
  const f2Policy = loadF2Policy();
  const loaded = loadBatchComposition(policyState, f2Policy);
  const context = {
    batchPolicySha256: policyState.sha256,
    f1ModulesSha256: moduleDigest(scan.moduleSha256),
    f1ReceiptSha256: sha256(scan.fields),
    f2ModulesSha256: moduleDigest(Object.fromEntries(
      [...loaded.f2.modules, ...loaded.f2.parserFragments].map((item) => [item.path, item.sha256]),
    )),
    f2Policy,
    allowForcedLateFailure: options.forceLateFailure === true,
    limits,
    resultFormat: policyState.policy.resultFormat,
  };
  return { context, f2Policy, loaded, limits, policyState, request, scan };
}

export function verifyBatchFields(source, fields, options = {}) {
  const prepared = prepareBatch(source, options);
  const decoded = decodeBatch(fields, source, prepared.request, prepared.context);
  const expectedFields = executePreparedFields(source, prepared, options);
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)) fail('receipt replay');
  return decoded;
}

function executePreparedFields(source, prepared, options) {
  const { f2Policy, loaded, limits, policyState, request } = prepared;
  const f2Limits = f2Policy.profileLimits;
  const runtimeLimits = {
    ...policyState.policy.runtimeLimits,
    maxBytes: Math.min(policyState.policy.runtimeLimits.maxBytes, limits.maxEncodedBytes),
    maxStringBytes: Math.min(policyState.policy.runtimeLimits.maxStringBytes, limits.maxEncodedBytes),
  };
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      source,
      request.segments.map((item) => item.body),
      request.segments.map((item) => item.firstRecordOrdinal),
      request.segments.map((item) => item.lastRecordOrdinal),
      request.segments.map((item) => item.outerStartScalar),
      request.segments.map((item) => item.outerEndScalar),
      request.segments.map((item) => item.bodyStartScalar),
      request.segments.map((item) => item.bodyEndScalar),
      request.segments.map((item) => item.bodySha256),
      request.segments.map((item) => item.recordSha256),
      limits.maxSegments,
      limits.maxAggregateBodyScalars,
      limits.maxAggregateNodes,
      limits.maxAbsoluteSpans,
      limits.maxWorkSteps,
      f2Limits.maxSourceScalars,
      f2Limits.maxTokens,
      f2Limits.maxNodes,
      f2Limits.nodesPerChunk,
      f2Limits.maxChunks,
      f2Limits.maxTapeScalars,
      f2Limits.maxNestingDepth,
      f2Limits.maxWorkSteps,
      options.forceLateFailure === true,
    ],
    identity: { handlerName: 'parsef2batch', sourcePath: policyState.policy.sourcePath },
    source: loaded.composition,
  }, { enabled: true, limits: runtimeLimits, scheduler: policyState.policy.scheduler });
  if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
      envelope.result.presence !== 'value' || envelope.result.value.tag !== 'list' || envelope.events.length !== 0) {
    fail(`runtime envelope ${JSON.stringify(envelope)}`);
  }
  const fields = materialize(envelope.result.value);
  return fields;
}

function executePreparedBatch(source, prepared, options) {
  const fields = executePreparedFields(source, prepared, options);
  const { context, request } = prepared;
  const decoded = decodeBatch(fields, source, request, context);
  return { ...decoded, fields, f1ReceiptSha256: prepared.context.f1ReceiptSha256, runtimeInvocations: 1 };
}

export function runBatch(source, options = {}) {
  return executePreparedBatch(source, prepareBatch(source, options), options);
}

export function runBatchWithScan(source, scan, options = {}) {
  return executePreparedBatch(source, prepareBatch(source, options, scan), options);
}

function runWithBodySubstitution(source, segmentOrdinal, body) {
  const options = {};
  const prepared = prepareBatch(source, options);
  if (!Number.isSafeInteger(segmentOrdinal) || !prepared.request.segments[segmentOrdinal] || typeof body !== 'string') {
    fail('test body substitution');
  }
  prepared.request.segments[segmentOrdinal].body = body;
  return executePreparedBatch(source, prepared, options);
}

export const __test = { runWithBodySubstitution };
