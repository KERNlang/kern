#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../packages/core/dist/runtime-handler.js';
import { loadWhitespaceTrimSource } from './check-kern-frontend-whitespace-trim.mjs';
import { EMPTY_RETAINED_FIXTURES, RETAINED_TOKEN_STREAM_FIXTURES } from './kern-frontend-retained-token-stream/fixtures.mjs';
import { normalizeRetainedTokenStreamOracle } from './kern-frontend-retained-token-stream/oracle.mjs';
import { loadFrontendRetainedTokenStreamPolicy } from './kern-frontend-retained-token-stream/policy.mjs';

const SOURCE_URL = new URL('../examples/kern-frontend/retained-token-stream.kern', import.meta.url);
const RECORD_WIDTH = 10;
const TOKEN_KINDS = new Set([
  'comma', 'equals', 'expr', 'identifier', 'number', 'quoted', 'slash', 'style',
  'themeRef', 'unknown', 'whitespace',
]);
const DIAGNOSTIC_CODES = new Set(['INVALID_BIGINT', 'UNCLOSED_EXPR', 'UNCLOSED_STRING', 'UNCLOSED_STYLE']);
const FAILURE_CODES = new Set([
  'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'EMPTY_RETAINED_CODE', 'INVALID_LIMITS',
  'LEXICAL_DEPTH_LIMIT', 'RECORD_LIMIT', 'STREAM_INVALID', 'TOKEN_LIMIT',
  'TRIM_INVALID', 'UNSUPPORTED_UNKNOWN',
]);
const MARKER_KINDS = new Set(['hash', 'none', 'slash-slash']);

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function readRegularSource(url) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  return source;
}

export function validateNativeRetainedTokenStreamSource(source) {
  for (const forbidden of [
    'tokenizeLineInternal', 'TokenStream', 'tryIdent', 'parseDocument',
    'normalizeRetainedTokenStreamOracle', 'executeKernRuntimeHandler', 'capability',
  ]) {
    if (source.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  for (const [name, expected] of [
    ['tokenizeline', 1],
    ['scanlexicalcontent', 1],
    ['observewhitespacetrim', 1],
    ['observeretainedtokenstream', 1],
  ]) {
    if ((source.match(new RegExp(`fn name=${name}\\b`, 'gu')) ?? []).length !== expected) {
      fail('composition rejection', `source must contain exactly one ${name}`);
    }
  }
  if (!source.includes('observewhitespacetrim(content, maxCodePoints,')) {
    fail('composition rejection', 'retained stream must compose M4.158');
  }
  if (!source.includes('tokenizeline(retainedCode, maxCodePoints,')) {
    fail('composition rejection', 'retained stream must tokenize only retainedCode');
  }
  return source;
}

export function loadRetainedTokenStreamSource() {
  return validateNativeRetainedTokenStreamSource(`${loadWhitespaceTrimSource()}\n\n${readRegularSource(SOURCE_URL)}`);
}

function wellFormedUtf16(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail('record rejection', `${label} must be canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail('record rejection', `${label} exceeds safe integer`);
  return value;
}

function textFields(value) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  return value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
}

export function parseRetainedTokenStreamEnvelope(content, value, policy = loadFrontendRetainedTokenStreamPolicy()) {
  const fields = textFields(value);
  if (fields[0] !== policy.retainedTokenStreamFormat || (fields.length - 1) % RECORD_WIDTH !== 0) {
    fail('record rejection', 'invalid retained token stream envelope');
  }
  const expected = normalizeRetainedTokenStreamOracle(content, policy);
  if (fields[1] === 'failure') {
    if (
      fields.length !== RECORD_WIDTH + 1 || !FAILURE_CODES.has(fields[2]) ||
      fields.slice(4).some(Boolean)
    ) {
      fail('record rejection', 'invalid failure envelope');
    }
    const actualFailure = failure(fields[2], fields[3]);
    if (!('status' in expected) || actualFailure.code !== expected.code || actualFailure.detail !== expected.detail) {
      fail('record rejection', 'failure envelope drift');
    }
    return actualFailure;
  }
  if ('status' in expected) fail('record rejection', 'success envelope contradicts oracle failure');
  if (fields.length < 1 + 3 * RECORD_WIDTH) fail('record rejection', 'success requires stream, token, and seal');

  const header = fields.slice(1, 1 + RECORD_WIDTH);
  if (header[0] !== 'stream' || header[1] !== '0') fail('record rejection', 'invalid stream header');
  const boundary = {
    codeEndOffset: uint(header[3], 'code end offset'),
    content: header[2],
    markerKind: header[6],
    markerOffset: header[5] === 'none' ? null : uint(header[5], 'marker offset'),
    markerText: header[7],
    rawPayload: header[8],
    retainedLength: uint(header[9], 'retained length'),
    triviaEndOffset: uint(header[4], 'trivia end offset'),
  };
  if (!MARKER_KINDS.has(boundary.markerKind) || boundary.content !== content) {
    fail('record rejection', 'boundary identity drift');
  }
  const contentScalars = [...content];
  if (
    boundary.retainedLength !== boundary.codeEndOffset ||
    boundary.codeEndOffset > boundary.triviaEndOffset ||
    boundary.triviaEndOffset > contentScalars.length
  ) {
    fail('record rejection', 'boundary offset drift');
  }
  const retainedCode = contentScalars.slice(0, boundary.codeEndOffset).join('');

  const tokens = [];
  const diagnostics = [];
  let phase = 'token';
  let seal;
  let tokenPrefix = '';
  let diagnosticPrefix = '';
  for (let cursor = 1 + RECORD_WIDTH; cursor < fields.length; cursor += RECORD_WIDTH) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (record[0] === 'token') {
      if (phase !== 'token' || record.slice(7).some(Boolean)) fail('record rejection', 'invalid token phase or padding');
      const index = uint(record[1], 'token index');
      if (index !== tokens.length || !TOKEN_KINDS.has(record[2])) fail('record rejection', 'token order or kind drift');
      tokenPrefix += record[4];
      if (!retainedCode.startsWith(tokenPrefix)) fail('record rejection', 'token delta leaves retained source');
      const token = {
        index,
        kind: record[2],
        startByte: uint(record[6], 'token start byte'),
        startDelta: record[4],
        startScalar: uint(record[5], 'token start scalar'),
        value: record[3],
      };
      if (
        token.startScalar !== [...tokenPrefix].length ||
        token.startByte !== Buffer.byteLength(tokenPrefix, 'utf8')
      ) {
        fail('record rejection', 'token scalar or byte start drift');
      }
      tokens.push(token);
      continue;
    }
    if (record[0] === 'diagnostic') {
      phase = 'diagnostic';
      if (record[9] !== '') fail('record rejection', 'invalid diagnostic padding');
      const index = uint(record[1], 'diagnostic index');
      if (index !== diagnostics.length || !DIAGNOSTIC_CODES.has(record[2])) {
        fail('record rejection', 'diagnostic order or code drift');
      }
      diagnosticPrefix += record[3];
      if (!retainedCode.startsWith(diagnosticPrefix)) fail('record rejection', 'diagnostic delta leaves retained source');
      const diagnostic = {
        code: record[2],
        endByte: uint(record[8], 'diagnostic end byte'),
        endScalar: uint(record[6], 'diagnostic end scalar'),
        index,
        span: record[4],
        startByte: uint(record[7], 'diagnostic start byte'),
        startDelta: record[3],
        startScalar: uint(record[5], 'diagnostic start scalar'),
      };
      if (
        diagnostic.startScalar !== [...diagnosticPrefix].length ||
        diagnostic.startByte !== Buffer.byteLength(diagnosticPrefix, 'utf8') ||
        diagnostic.endScalar !== diagnostic.startScalar + [...diagnostic.span].length ||
        diagnostic.endByte !== diagnostic.startByte + Buffer.byteLength(diagnostic.span, 'utf8') ||
        retainedCode.slice(diagnosticPrefix.length, diagnosticPrefix.length + diagnostic.span.length) !== diagnostic.span
      ) {
        fail('record rejection', 'diagnostic scalar, byte, or span drift');
      }
      diagnostics.push(diagnostic);
      continue;
    }
    if (record[0] === 'seal') {
      if (cursor !== fields.length - RECORD_WIDTH) fail('record rejection', 'seal must be terminal');
      phase = 'seal';
      seal = {
        content: record[7],
        diagnosticCount: uint(record[2], 'diagnostic count'),
        diagnosticTail: record[4],
        retainedByteLength: uint(record[6], 'retained byte length'),
        retainedScalarLength: uint(record[5], 'retained scalar length'),
        tokenCount: uint(record[1], 'token count'),
        tokenTail: record[3],
      };
      if (
        seal.content !== content || record[8] !== header[3] || record[9] !== header[4] ||
        seal.tokenCount !== tokens.length || seal.diagnosticCount !== diagnostics.length ||
        tokenPrefix + seal.tokenTail !== retainedCode || diagnosticPrefix + seal.diagnosticTail !== retainedCode ||
        seal.retainedScalarLength !== [...retainedCode].length ||
        seal.retainedByteLength !== Buffer.byteLength(retainedCode, 'utf8')
      ) {
        fail('record rejection', 'terminal counts, tails, lengths, source, or offsets drift');
      }
      continue;
    }
    fail('record rejection', `unknown stream record ${record[0]}`);
  }
  if (phase !== 'seal' || seal === undefined || tokens.length === 0) {
    fail('record rejection', 'successful stream requires tokens and terminal seal');
  }
  const actual = {
    boundary,
    diagnostics,
    format: policy.retainedTokenStreamFormat,
    seal,
    sourceProfile: policy.retainedTokenStreamSourceProfile,
    tokens,
  };
  try {
    assert.deepEqual(actual, expected, 'retained token stream oracle drift');
  } catch {
    fail('record rejection', 'retained token stream oracle drift');
  }
  return actual;
}

function executeHandler(content, policy, kernSource) {
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      content,
      limits.maxCodePoints,
      limits.maxTokens,
      limits.maxDiagnostics,
      policy.maxStreamRecords,
      policy.maxLexicalDepth,
    ],
    identity: {
      handlerName: 'observeretainedtokenstream',
      sourcePath: 'examples/kern-frontend/retained-token-stream.kern',
    },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (Buffer.byteLength(`${JSON.stringify(envelope)}\n`, 'utf8') > limits.maxOutputJsonBytes) {
    fail('runtime rejection', 'OUTPUT_JSON_BYTES_LIMIT');
  }
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
    envelope.events.length !== 0 || envelope.result.presence !== 'value'
  ) {
    fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  }
  return envelope.result.value;
}

export function executeFrontendRetainedTokenStream(
  content,
  policy = loadFrontendRetainedTokenStreamPolicy(),
  kernSource = loadRetainedTokenStreamSource(),
) {
  if (!wellFormedUtf16(content)) return failure('MALFORMED_UTF16');
  if (Buffer.byteLength(content, 'utf8') > policy.profileLimits.maxSourceBytes) return failure('SOURCE_BYTES_LIMIT');
  if ([...content].length > policy.profileLimits.maxCodePoints) return failure('CODE_POINTS_LIMIT');
  if (content.includes('\n') || content.includes('\r')) return failure('UNSUPPORTED_LINE_ENDING');
  return parseRetainedTokenStreamEnvelope(content, executeHandler(content, policy, kernSource), policy);
}

export function runKernFrontendRetainedTokenStreamCheck() {
  const policy = loadFrontendRetainedTokenStreamPolicy();
  const source = loadRetainedTokenStreamSource();
  for (const fixture of RETAINED_TOKEN_STREAM_FIXTURES) {
    assert.deepEqual(
      executeFrontendRetainedTokenStream(fixture.source, policy, source),
      normalizeRetainedTokenStreamOracle(fixture.source, policy),
      fixture.id,
    );
  }
  for (const fixture of EMPTY_RETAINED_FIXTURES) {
    assert.deepEqual(executeFrontendRetainedTokenStream(fixture.source, policy, source), failure('EMPTY_RETAINED_CODE'));
  }
  return { differential: RETAINED_TOKEN_STREAM_FIXTURES.length, empty: EMPTY_RETAINED_FIXTURES.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendRetainedTokenStreamCheck();
  process.stdout.write(
    `KERN frontend retained token stream: ${result.differential} differential and ${result.empty} empty-boundary cases passed.\n`,
  );
}
