#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { loadLexicalScanSource } from './check-kern-frontend-lexical.mjs';
import { loadTokenizerSource } from './check-kern-frontend-tokenizer.mjs';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../packages/core/dist/runtime-handler.js';
import { WHITESPACE_TRIM_FIXTURES } from './kern-frontend-whitespace-trim/fixtures.mjs';
import {
  ECMASCRIPT_TRIM_CODE_POINTS,
  normalizeWhitespaceTrimOracle,
} from './kern-frontend-whitespace-trim/oracle.mjs';
import { loadFrontendWhitespaceTrimPolicy } from './kern-frontend-whitespace-trim/policy.mjs';

const WHITESPACE_TRIM_SOURCE_URL = new URL('../examples/kern-frontend/whitespace-trim.kern', import.meta.url);
const FAILURE_CODES = new Set([
  'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'INVALID_LIMITS', 'LEXICAL_DEPTH_LIMIT',
  'RECORD_LIMIT', 'TOKEN_LIMIT', 'TRIM_INVALID', 'UNSUPPORTED_UNKNOWN',
]);
const MARKER_KINDS = new Set(['hash', 'none', 'slash-slash']);
const QUOTES = new Set(['double', 'none', 'single']);
const STOPS = new Set(['eligible-marker', 'record-end']);
const RECORD_WIDTH = 18;

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function readRegularSource(url) {
  const path = fileURLToPath(url);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  return source;
}

export function validateNativeWhitespaceTrimSource(source) {
  for (const forbidden of [
    'executeKernRuntimeHandler', 'normalizeWhitespaceTrimOracle', 'parseDocument',
    'stripInlineComment', 'tokenizeLineInternal', '.trim(', '.trimEnd(', '\\s', 'isspace',
  ]) {
    if (source.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  if ((source.match(/fn name=scanlexicalcontent\b/gu) ?? []).length !== 1) {
    fail('composition rejection', 'source must contain exactly one shared lexical scanner');
  }
  if (!source.includes('scanlexicalcontent(content, 0, 0, 0, maxLexicalDepth)')) {
    fail('composition rejection', 'whitespace trim handler must call the shared lexical scanner');
  }
  if (!source.includes('tokenizeline(retainedCode, maxCodePoints,')) {
    fail('composition rejection', 'whitespace trim handler must tokenize only retainedCode');
  }
  return source;
}

export function loadWhitespaceTrimSource() {
  return validateNativeWhitespaceTrimSource(
    `${loadTokenizerSource()}\n\n${loadLexicalScanSource()}\n\n${readRegularSource(WHITESPACE_TRIM_SOURCE_URL)}`,
  );
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

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function integer(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail('record rejection', `${label} must be canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail('record rejection', `${label} exceeds safe integer`);
  return value;
}

function booleanField(field, label) {
  if (field !== '0' && field !== '1') fail('record rejection', `${label} must be 0 or 1`);
  return field === '1';
}

export function parseWhitespaceTrimEnvelope(content, value, policy = loadFrontendWhitespaceTrimPolicy()) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  const fields = value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
  if (fields[0] !== policy.whitespaceTrimFormat || (fields.length - 1) % RECORD_WIDTH !== 0) {
    fail('record rejection', 'invalid whitespace trim envelope');
  }
  const expected = normalizeWhitespaceTrimOracle(content, policy);
  if (fields[1] === 'failure') {
    if (fields.length !== RECORD_WIDTH + 1 || !FAILURE_CODES.has(fields[2]) || fields.slice(4).some(Boolean)) {
      fail('record rejection', 'invalid failure envelope');
    }
    const actualFailure = failure(fields[2], fields[3]);
    if (!('status' in expected) || actualFailure.code !== expected.code || actualFailure.detail !== expected.detail) {
      fail('record rejection', 'failure envelope drift');
    }
    return actualFailure;
  }
  if ('status' in expected) fail('record rejection', 'success envelope contradicts oracle failure');
  if (fields.length !== 1 + 2 * RECORD_WIDTH) fail('record rejection', 'success requires trim plus seal');
  const record = fields.slice(1, 1 + RECORD_WIDTH);
  const seal = fields.slice(1 + RECORD_WIDTH);
  if (record[0] !== 'trim' || record.slice(1, 6).some((field) => field !== '0')) {
    fail('record rejection', 'trim identity drift');
  }
  const trim = {
    trimIndex: integer(record[1], 'trim index'),
    checkpointIndex: integer(record[2], 'checkpoint index'),
    groupIndex: integer(record[3], 'group index'),
    groupRecordIndex: integer(record[4], 'group record index'),
    physicalIndex: integer(record[5], 'physical index'),
    content: record[6],
    quote: record[7],
    escapePending: booleanField(record[8], 'escape pending'),
    expressionDepth: integer(record[9], 'expression depth'),
    styleDepth: integer(record[10], 'style depth'),
    stop: record[11],
    markerOffset: record[12] === 'none' ? null : integer(record[12], 'marker offset'),
    markerKind: record[13],
    markerText: record[14],
    rawPayload: record[15],
    codeEndOffset: integer(record[16], 'code end offset'),
    triviaEndOffset: integer(record[17], 'trivia end offset'),
  };
  if (!QUOTES.has(trim.quote) || !STOPS.has(trim.stop) || !MARKER_KINDS.has(trim.markerKind)) {
    fail('record rejection', 'unknown quote, stop, or marker kind');
  }
  const scalars = [...trim.content];
  if (trim.content !== content || trim.codeEndOffset > trim.triviaEndOffset || trim.triviaEndOffset > scalars.length) {
    fail('record rejection', 'content or trim offset bounds drift');
  }
  if (trim.markerOffset === null) {
    if (
      trim.stop !== 'record-end' || trim.markerKind !== 'none' || trim.markerText !== '' || trim.rawPayload !== '' ||
      trim.codeEndOffset !== scalars.length || trim.triviaEndOffset !== scalars.length
    ) {
      fail('record rejection', 'record-end trim drift');
    }
  } else {
    const expectedMarker = trim.markerKind === 'hash' ? '#' : '//';
    const previous = scalars[trim.markerOffset - 1] ?? '';
    const removed = scalars.slice(trim.codeEndOffset, trim.triviaEndOffset);
    if (
      trim.stop !== 'eligible-marker' || trim.markerKind === 'none' || trim.markerText !== expectedMarker ||
      trim.triviaEndOffset !== trim.markerOffset || trim.codeEndOffset >= trim.triviaEndOffset ||
      (previous !== ' ' && previous !== '\t') || removed.some((scalar) => !ECMASCRIPT_TRIM_CODE_POINTS.includes(scalar.codePointAt(0))) ||
      (trim.codeEndOffset > 0 && ECMASCRIPT_TRIM_CODE_POINTS.includes(scalars[trim.codeEndOffset - 1].codePointAt(0)))
    ) {
      fail('record rejection', 'eligible trim membership or maximality drift');
    }
    if (
      scalars.slice(0, trim.codeEndOffset).join('') + removed.join('') + trim.markerText + trim.rawPayload !== content
    ) {
      fail('record rejection', 'trim reconstruction drift');
    }
  }
  if (!Object.keys(expected.trim).every((key) => trim[key] === expected.trim[key])) {
    fail('record rejection', 'trim identity, state, marker, payload, or offset drift');
  }
  if (seal[0] !== 'seal' || seal[1] !== content || seal.slice(2).some(Boolean)) {
    fail('record rejection', 'invalid terminal seal');
  }
  return { format: policy.whitespaceTrimFormat, sourceProfile: policy.whitespaceTrimSourceProfile, trim };
}

function executeHandler(handlerName, arguments_, policy, kernSource) {
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: arguments_,
    identity: { handlerName, sourcePath: 'examples/kern-frontend/whitespace-trim.kern' },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
    envelope.events.length !== 0 || envelope.result.presence !== 'value'
  ) {
    fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  }
  return envelope.result.value;
}

export function executeFrontendTrimPredicate(
  scalar,
  policy = loadFrontendWhitespaceTrimPolicy(),
  kernSource = loadWhitespaceTrimSource(),
) {
  const value = executeHandler('frontendtrimspace', [scalar], policy, kernSource);
  if (value.tag !== 'boolean') fail('runtime rejection', 'trim predicate must return boolean');
  return value.value;
}

export function executeFrontendWhitespaceTrim(
  content,
  policy = loadFrontendWhitespaceTrimPolicy(),
  kernSource = loadWhitespaceTrimSource(),
) {
  if (!wellFormedUtf16(content)) return failure('MALFORMED_UTF16');
  if (Buffer.byteLength(content) > policy.profileLimits.maxSourceBytes) return failure('SOURCE_BYTES_LIMIT');
  if ([...content].length > policy.profileLimits.maxCodePoints) return failure('CODE_POINTS_LIMIT');
  if (content.includes('\n') || content.includes('\r')) return failure('UNSUPPORTED_LINE_ENDING');
  const limits = policy.profileLimits;
  const value = executeHandler('observewhitespacetrim', [
    content, limits.maxCodePoints, limits.maxTokens, limits.maxDiagnostics,
    policy.tokenizerMaxRecords, policy.maxLexicalDepth,
  ], policy, kernSource);
  if (Buffer.byteLength(`${JSON.stringify(value)}\n`) > limits.maxOutputJsonBytes) {
    fail('runtime rejection', 'OUTPUT_JSON_BYTES_LIMIT');
  }
  return parseWhitespaceTrimEnvelope(content, value, policy);
}

export function runKernFrontendWhitespaceTrimCheck() {
  const policy = loadFrontendWhitespaceTrimPolicy();
  const kernSource = loadWhitespaceTrimSource();
  const integratedScalars = ECMASCRIPT_TRIM_CODE_POINTS.filter((codePoint) => codePoint !== 0x0a && codePoint !== 0x0d);
  const fixtures = [
    ...WHITESPACE_TRIM_FIXTURES,
    ...integratedScalars.flatMap((codePoint) => {
      const scalar = String.fromCodePoint(codePoint);
      const label = codePoint.toString(16).padStart(4, '0');
      return [
        { id: `hash-u+${label}`, source: `text value=ok${scalar} # note` },
        { id: `slash-u+${label}`, source: `text value=ok${scalar}\t// note` },
      ];
    }),
  ];
  for (const fixture of fixtures) {
    assert.deepEqual(
      executeFrontendWhitespaceTrim(fixture.source, policy, kernSource),
      normalizeWhitespaceTrimOracle(fixture.source, policy),
      fixture.id,
    );
  }
  for (const codePoint of ECMASCRIPT_TRIM_CODE_POINTS) {
    assert.equal(executeFrontendTrimPredicate(String.fromCodePoint(codePoint), policy, kernSource), true);
  }
  for (const codePoint of [0x0085, 0x180e]) {
    assert.equal(executeFrontendTrimPredicate(String.fromCodePoint(codePoint), policy, kernSource), false);
  }
  return { fixtures: fixtures.length, predicateCases: ECMASCRIPT_TRIM_CODE_POINTS.length + 2 };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendWhitespaceTrimCheck();
  process.stdout.write(
    `KERN frontend whitespace trim shadow: ${result.fixtures} differential and ${result.predicateCases} predicate cases passed.\n`,
  );
}
