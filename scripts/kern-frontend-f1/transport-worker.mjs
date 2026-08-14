import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { isWellFormedText } from '../../packages/core/dist/index.js';
import { encodeInternalRuntimeEnvelope } from '../../packages/core/dist/runtime-envelope/normalize.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';

import {
  buildSource,
  buildWorstFields,
  decodeResult,
  envelopeForFields,
  fail,
  loadPolicy,
  materialize,
} from './transport-contract.mjs';
import { mutationSuite } from './transport-mutations.mjs';

const probeSource = readFileSync(
  new URL('../../examples/kern-frontend/f1-output-transport-probe.kern', import.meta.url),
  'utf8',
);
const UINT = /^(?:0|[1-9][0-9]*)$/u;

function encodeAndDecode(envelope, runtimeLimits) {
  const encoded = encodeInternalRuntimeEnvelope(envelope, runtimeLimits);
  const decoded = JSON.parse(Buffer.from(encoded).toString('utf8'));
  return { decoded, encoded, encodedBytes: encoded.length };
}

function assertEncodedSuccess(encoded, fields) {
  if (
    encoded.decoded.outcome !== 'success' ||
    encoded.decoded.result?.presence !== 'value' ||
    encoded.decoded.result.value?.tag !== 'list'
  ) {
    fail('direct encoder substituted or rejected success');
  }
  const roundTrip = materialize(encoded.decoded.result.value);
  if (JSON.stringify(roundTrip) !== JSON.stringify(fields)) fail('direct encoder changed result');
  return true;
}

function runEncoderWall(policy) {
  const astral = buildWorstFields('😀');
  const control = buildWorstFields('\u0000');
  const astralEncoded = encodeAndDecode(envelopeForFields(astral), policy.runtimeLimits);
  const controlEncoded = encodeAndDecode(envelopeForFields(control), policy.runtimeLimits);
  assertEncodedSuccess(astralEncoded, astral);
  assertEncodedSuccess(controlEncoded, control);
  return {
    astralEncodedBytes: astralEncoded.encodedBytes,
    astralTapeUtf8Bytes: Buffer.byteLength(astral[7]),
    controlEncodedBytes: controlEncoded.encodedBytes,
    controlJsonContentBytes: Buffer.byteLength(JSON.stringify(control[7])) - 2,
    status: 'encoder-wall-passed',
  };
}

function runProbe(shape, size, forceLateFailure, policy) {
  const source = buildSource(shape, size);
  if (!isWellFormedText(source)) {
    return {
      chunkCount: 0,
      code: 'ILL_FORMED_SOURCE',
      events: 0,
      invoked: false,
      maxGuestListLength: 0,
      recordCount: 0,
      source,
      sourceScalars: 0,
      status: 'failure',
      tapeScalars: 0,
    };
  }
  const limits = policy.profileLimits;
  const started = performance.now();
  const envelope = executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        source,
        shape === 'mutation-suite' ? 'alternating' : shape,
        limits.maxSourceScalars,
        limits.recordsPerChunk,
        limits.maxChunks,
        limits.maxTapeScalars,
        limits.maxTapeUtf8Bytes,
        limits.maxJsonContentBytes,
        limits.maxEncodedBytes,
        limits.encodedEnvelopeOverheadBytes,
        limits.maxRetainedTransportBytes,
        limits.maxChunkScalars,
        forceLateFailure,
      ],
      identity: {
        handlerName: 'probef1transport',
        sourcePath: 'examples/kern-frontend/f1-output-transport-probe.kern',
      },
      source: probeSource,
    },
    { enabled: true, limits: policy.runtimeLimits, scheduler: policy.scheduler },
  );
  const elapsedMs = performance.now() - started;
  if (envelope.outcome !== 'success' || envelope.completion.kind !== 'return' || envelope.result.presence !== 'value') {
    fail(`runtime envelope ${JSON.stringify(envelope)}`);
  }
  if (envelope.events.length !== limits.expectedEvents || envelope.result.value.tag !== 'list') {
    fail('runtime result shape');
  }
  const fields = materialize(envelope.result.value);
  const decoded = decodeResult(fields, source, shape, limits, { forceLateFailure });
  const direct = encodeAndDecode(envelope, policy.runtimeLimits);
  const directEncoderRoundTrip = assertEncodedSuccess(direct, fields);
  if (elapsedMs > limits.maxElapsedMs) fail('elapsed wall');
  if (direct.encodedBytes > limits.maxEncodedBytes) fail('encoded byte wall');
  const rssBytes = process.memoryUsage().rss;
  const values = decoded.values;
  return {
    chunkCount: values.chunkCount,
    code: values.code,
    decoded,
    directEncoderRoundTrip,
    elapsedMs,
    encodedBytes: direct.encodedBytes,
    encodedOutcome: direct.decoded.outcome,
    envelope,
    events: envelope.events.length,
    invoked: true,
    jsonContentBytes: values.jsonContentBytes ?? 0,
    maxGuestListLength: values.maxGuestListLength,
    peakRssWithinDiagnosticWall: rssBytes <= limits.maxPeakRssBytes,
    reconstructed: values.status === 'scanned' ? decoded.reconstructed === source : false,
    recordCount: values.recordCount,
    retainedTransportBytes: 9 * (values.tapeUtf8Bytes ?? 0),
    rssBytes,
    source,
    sourceScalars: values.sourceScalars,
    status: values.status,
    tapeScalars: values.tapeScalars ?? 0,
    tapeUtf8Bytes: values.tapeUtf8Bytes ?? 0,
    withinLogicalWalls: true,
  };
}

const [shape = 'alternating', sizeText = '0', mode = 'scan'] = process.argv.slice(2);
if (!UINT.test(sizeText)) fail('size argument');
const size = Number(sizeText);
if (!Number.isSafeInteger(size)) fail('size argument');
const policy = loadPolicy();
if (shape === 'encoder-wall') {
  process.stdout.write(`${JSON.stringify(runEncoderWall(policy))}\n`);
} else {
  const run = runProbe(shape, size, mode === 'late-failure', policy);
  if (shape === 'mutation-suite') {
    process.stdout.write(`${JSON.stringify({ rejected: mutationSuite(run, policy), status: 'mutations-rejected' })}\n`);
  } else {
    const { decoded: _decoded, envelope: _envelope, source: _source, ...measurement } = run;
    process.stdout.write(`${JSON.stringify(measurement)}\n`);
  }
}
