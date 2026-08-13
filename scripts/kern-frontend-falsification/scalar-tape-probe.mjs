import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { encodeCanonicalValue } from '../../packages/core/dist/canonical-value/canonical.js';
import { projectExpressionText } from '../../packages/core/dist/kir-structural/expression.js';
import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { decodeInstructionStream } from './instruction-decoder.mjs';

const canonicalLimits = {
  maxBytes: 262144, maxCollectionLength: 1024, maxDecimalChars: 128,
  maxDepth: 64, maxFractionDigits: 64, maxIntegerDigits: 512,
  maxMapEntries: 1024, maxNodes: 4096, maxRecordFields: 1024, maxStringBytes: 65536,
};
const runtimeLimits = {
  maxBytes: 1048576, maxCollectionLength: 200000, maxDepth: 128,
  maxDiagnostics: 16, maxEvents: 16, maxStringBytes: 262144,
};
const helper = readFileSync(new URL('../../examples/kern-frontend/expression-probe-helpers.kern', import.meta.url), 'utf8');
const probe = readFileSync(new URL('../../examples/kern-frontend/scalar-tape-probe.kern', import.meta.url), 'utf8');
const kernSource = `${helper}\n${probe}`;

function run(source) {
  const started = performance.now();
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [source, 512, 65_536],
    identity: { handlerName: 'probescalartape', sourcePath: 'examples/kern-frontend/scalar-tape-probe.kern' },
    source: kernSource,
  }, { enabled: true, limits: runtimeLimits, scheduler: { timeoutMs: 2000 } });
  const elapsedMs = performance.now() - started;
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope.diagnostics));
  assert.equal(envelope.result.presence, 'value');
  assert.equal(envelope.result.value.tag, 'list');
  const fields = envelope.result.value.value.map((item) => item.value);
  assert.deepEqual(fields.slice(0, 2), ['kern.frontend.scalar-tape-probe.1', 'ok']);
  assert.deepEqual(fields.slice(3), ['seal', source]);
  const actual = encodeCanonicalValue(decodeInstructionStream(fields[2]), canonicalLimits);
  const expected = encodeCanonicalValue(projectExpressionText(source, '$.expression'), canonicalLimits);
  assert.deepEqual(actual, expected);
  return elapsedMs;
}

const sizes = [8, 32, 128];
const timings = sizes.map((size) => {
  const source = `${'a'.repeat(size)} + ${'b'.repeat(size)} * 2`;
  return { elapsedMs: run(source), sourceCodePoints: [...source].length };
});
assert.ok(timings[2].elapsedMs < 2000);
assert.ok(timings[2].elapsedMs < timings[0].elapsedMs * 16);
console.log(JSON.stringify({ status: 'pass', timings }));
