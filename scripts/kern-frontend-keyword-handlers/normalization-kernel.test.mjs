import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../../packages/core/dist/runtime-handler.js';
import { loadKeywordHandlerSource } from '../check-kern-frontend-keyword-handlers.mjs';
import { normalizeRetainedTokenStreamOracle } from '../kern-frontend-retained-token-stream/oracle.mjs';
import { loadKeywordHandlerMemberSource } from './source.mjs';
import { loadFrontendKeywordHandlerPolicy } from './policy.mjs';
import {
  KEYWORD_HANDLER_EDGE_FIXTURES,
  KEYWORD_HANDLER_FALLBACK_FIXTURES,
  KEYWORD_HANDLER_FIXTURES,
  KEYWORD_HANDLER_NUMERIC_FIXTURES,
} from './fixtures.mjs';

const KERNEL_URL = new URL('../../examples/kern-frontend/keyword-handler-normalization.kern', import.meta.url);
const SIMPLE_URL = new URL('../../examples/kern-frontend/keyword-handlers-simple.kern', import.meta.url);
const policy = loadFrontendKeywordHandlerPolicy();

function count(source, needle) {
  return source.split(needle).length - 1;
}

function assertKernelStructure(kernel, simple) {
  assert.match(kernel, /fn name=normalizekeywordhandlerwrites returns="string\[\]"/u);
  assert.match(simple, /normalizekeywordhandlerwrites\(/u);
  assert.equal(count(simple, 'normalizekeywordhandlerwrites('), 1);
  assert.doesNotMatch(simple, /let name=bareName|let name=complexWrites/u);
  assert.match(kernel, /assign target=cursor value="initialCursor"/u);
  for (const field of ['writeNames', 'writeKinds', 'writeValues']) {
    assert.match(kernel, new RegExp(`out\\.push\\(${field}\\[writeIndex\\]\\)`, 'u'));
  }
  for (const field of ['writeStarts', 'writeEnds']) {
    assert.match(kernel, new RegExp(`out\\.push\\(String\\(${field}\\[writeIndex\\]\\)\\)`, 'u'));
  }
  assert.doesNotMatch(
    kernel,
    /observeretainedtokenstream|observekeyword|kern\.frontend\..*-shadow|parseDocument|parseLine|bootstrap|executeKernRuntimeHandler/u,
  );
}

function textFields(value) {
  assert.equal(value.tag, 'list');
  return value.value.map((entry) => {
    assert.equal(entry.tag, 'text');
    return entry.value;
  });
}

function runKernel(content, maxWrites = policy.maxKeywordHandlerWrites) {
  const stream = normalizeRetainedTokenStreamOracle(content, policy);
  assert.ok(!('status' in stream), content);
  const kinds = stream.tokens.map(({ kind }) => kind);
  const values = stream.tokens.map(({ value }) => value);
  const starts = stream.tokens.map(({ startScalar }) => startScalar);
  const ends = stream.tokens.map((token, index) => stream.tokens[index + 1]?.startScalar ?? stream.boundary.codeEndOffset);
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [content, '', 0, kinds, values, starts, ends, maxWrites],
    identity: {
      handlerName: 'normalizekeywordhandlerwrites',
      sourcePath: 'examples/kern-frontend/keyword-handler-normalization.kern',
    },
    source: loadKeywordHandlerMemberSource(),
  }, { enabled: true, limits: policy.runtimeLimits });
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope.diagnostics));
  assert.equal(envelope.completion.kind, 'return');
  assert.equal(envelope.events.length, 0);
  assert.equal(envelope.result.presence, 'value');
  return textFields(envelope.result.value);
}

function runLocalFields(content) {
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      content, '', 0, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics, policy.maxStreamRecords,
      policy.maxLexicalDepth, policy.keywordHandlerFormat, policy.retainedTokenStreamFormat,
      policy.maxKeywordHandlerWrites, policy.maxKeywordHandlerEnvelopeFields,
      policy.maxKeywordHandlerEnvelopeBytes,
    ],
    identity: {
      handlerName: 'observekeywordhandlers',
      sourcePath: 'examples/kern-frontend/keyword-handlers-simple.kern',
    },
    source: loadKeywordHandlerSource(),
  }, { enabled: true, limits: policy.runtimeLimits });
  assert.equal(envelope.outcome, 'success', JSON.stringify(envelope.diagnostics));
  assert.equal(envelope.result.presence, 'value');
  return textFields(envelope.result.value);
}

function decodedKernel(fields) {
  if (fields.length === 0) return { writes: [] };
  assert.ok(fields.length >= 4 && (fields.length - 4) % 5 === 0);
  const writes = [];
  for (let cursor = 4; cursor < fields.length; cursor += 5) {
    writes.push({
      name: fields[cursor],
      kind: fields[cursor + 1],
      value: fields[cursor + 2],
      startScalar: Number(fields[cursor + 3]),
      endScalar: Number(fields[cursor + 4]),
    });
  }
  assert.equal(writes.length, Number(fields[3]));
  return { type: fields[0], initialCursor: Number(fields[1]), finalCursor: Number(fields[2]), writes };
}

test('source-form normalization is owned by one receipt-neutral KERN kernel', () => {
  assertKernelStructure(readFileSync(KERNEL_URL, 'utf8'), readFileSync(SIMPLE_URL, 'utf8'));
});

test('neutral kernel preserves simple, raw, structured, collection, range, and fallback decisions', () => {
  const route = decodedKernel(runKernel('route GET /users name=listUsers'));
  assert.equal(route.type, 'route');
  assert.deepEqual(route.writes, [
    { name: 'method', kind: 'text', value: 'get', startScalar: 6, endScalar: 9 },
    { name: 'path', kind: 'text', value: '/users', startScalar: 10, endScalar: 16 },
  ]);
  assert.ok(route.finalCursor < normalizeRetainedTokenStreamOracle('route GET /users name=listUsers', policy).tokens.length);

  assert.deepEqual(decodedKernel(runKernel('return first +\n  second')).writes, [
    { name: 'value', kind: 'text', value: 'first +\n  second', startScalar: 7, endScalar: 23 },
  ]);
  assert.deepEqual(decodedKernel(runKernel('doc "hello 🚀"')).writes, [
    { name: 'text', kind: 'text', value: 'hello 🚀', startScalar: 4, endScalar: 13 },
  ]);

  const fn = decodedKernel(runKernel('fn greet(name: string): Result<string> async=true'));
  assert.deepEqual(fn.writes.map(({ name, kind }) => [name, kind]), [
    ['name', 'text'], ['params', 'text'], ['returns', 'text'], ['async', 'boolean'],
    ['__firstClassSyntax', 'boolean'],
  ]);
  const params = decodedKernel(runKernel('params page:number=1, limit:number=20'));
  assert.deepEqual(params.writes.map(({ name, kind }) => [name, kind]), [['items', 'params-items-v1']]);

  const fallback = decodedKernel(runKernel('fn name=legacy returns=void'));
  assert.deepEqual(fallback.writes, []);
  assert.equal(fallback.finalCursor, fallback.initialCursor);
  assert.deepEqual(runKernel('route GET /users', 1), []);
});

test('all 52 authored local receipts retain the exact pre-extraction byte digest', () => {
  const fixtures = [
    ...KEYWORD_HANDLER_FIXTURES,
    ...KEYWORD_HANDLER_FALLBACK_FIXTURES,
    ...KEYWORD_HANDLER_EDGE_FIXTURES,
    ...KEYWORD_HANDLER_NUMERIC_FIXTURES,
  ];
  const receipts = fixtures.map(({ id, source }) => [id, runLocalFields(source)]);
  const digest = createHash('sha256').update(JSON.stringify(receipts)).digest('hex');
  // Captured from exact baseline cf761495 by executing observekeywordhandlers
  // against the five HEAD member sources, then independently matched against
  // this extracted composition for the same ordered 52-fixture corpus.
  assert.equal(digest, 'e9e0bb42cbd47fe3563421fcb0a7e89a3e0b98edcc7f758d9e6ddd73859c5eb0');
});

test('source guard rejects bypass, cursor-decision drift, and shadow dependencies', () => {
  const kernel = readFileSync(KERNEL_URL, 'utf8');
  const simple = readFileSync(SIMPLE_URL, 'utf8');
  assert.throws(
    () => assertKernelStructure(kernel, simple.replace('normalizekeywordhandlerwrites(', 'bypasskeywordhandlerwrites(')),
  );
  assert.throws(
    () => assertKernelStructure(kernel.replace('assign target=cursor value="initialCursor"', ''), simple),
  );
  assert.throws(
    () => assertKernelStructure(`${kernel}\nfn name=leak\n  handler lang="kern"\n    return value="observeretainedtokenstream()"`, simple),
  );
});
