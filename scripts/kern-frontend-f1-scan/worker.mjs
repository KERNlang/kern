import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { isWellFormedText } from '../../packages/core/dist/index.js';
import { encodeInternalRuntimeEnvelope } from '../../packages/core/dist/runtime-envelope/normalize.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../../packages/core/dist/runtime-handler.js';

import { materialize } from '../kern-frontend-f1/transport-contract.mjs';
import { decodeScan, fail, loadPolicy } from './decoder.mjs';

const FORBIDDEN = /(?:\bcapability\b|parser-|parseInternal|parseDocument|parseExpression|tokenizeLineInternal|projectExpressionText|ReferenceRunner|typescript|kern\.frontend\..*-shadow)/u;

function sourceUrl(path) {
  return new URL(`../../${path}`, import.meta.url);
}

export function assertProductionSource(source, path) {
  if (FORBIDDEN.test(source)) fail(`forbidden production authority in ${path}`);
}

export function loadComposition(policy = loadPolicy()) {
  if (JSON.stringify(policy.modules) !== JSON.stringify(Object.keys(policy.moduleSha256))) {
    fail('production module order');
  }
  const modules = policy.modules.map((path) => {
    const source = readFileSync(sourceUrl(path), 'utf8');
    assertProductionSource(source, path);
    const sha256 = createHash('sha256').update(source).digest('hex');
    if (sha256 !== policy.moduleSha256[path]) fail(`module digest mismatch in ${path}`);
    return { path, sha256, source };
  });
  const composition = modules.map((module) => module.source).join('\n');
  if ((composition.match(/export=true/gu) ?? []).length !== 1) fail('production export count');
  if (!/fn name=scanf1records returns="string\[\]" export=true/u.test(composition)) fail('production entry');
  return { composition, modules };
}

export function runScan(source, options = {}) {
  const policy = loadPolicy();
  if (!isWellFormedText(source)) fail('worker received ill-formed source');
  const loaded = loadComposition(policy);
  const limits = policy.profileLimits;
  const started = performance.now();
  const envelope = executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        source,
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
        options.forceLateFailure === true,
      ],
      identity: {
        handlerName: 'scanf1records',
        sourcePath: 'examples/kern-frontend/f1-scan-main.kern',
      },
      source: loaded.composition,
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
  const decoded = decodeScan(fields, source, policy, { allowForcedLateFailure: options.forceLateFailure === true });
  const encoded = encodeInternalRuntimeEnvelope(envelope, policy.runtimeLimits);
  const encodedResult = JSON.parse(Buffer.from(encoded).toString('utf8'));
  if (encodedResult.outcome !== 'success') fail('encoded envelope substituted result');
  return {
    decoded,
    elapsedMs,
    encodedBytes: encoded.length,
    fields,
    moduleSha256: Object.fromEntries(loaded.modules.map((module) => [module.path, module.sha256])),
  };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const source = Buffer.from(process.argv[2] ?? '', 'base64').toString('utf8');
  const result = runScan(source, { forceLateFailure: process.argv[3] === 'late-failure' });
  process.stdout.write(`${JSON.stringify({
    elapsedMs: result.elapsedMs,
    encodedBytes: result.encodedBytes,
    recordCount: result.decoded.records.length,
    status: result.decoded.status,
  })}\n`);
}
