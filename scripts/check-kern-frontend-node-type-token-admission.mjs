#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import { loadRetainedTokenStreamSource } from './check-kern-frontend-retained-token-stream.mjs';
import {
  INHERITED_ADMISSION_FAILURE_FIXTURES,
  NODE_TYPE_TOKEN_ADMISSION_FIXTURES,
} from './kern-frontend-node-type-token-admission/fixtures.mjs';
import {
  normalizeInheritedRetainedStreamFields,
  normalizeNodeTypeTokenAdmissionOracle,
} from './kern-frontend-node-type-token-admission/oracle.mjs';
import { loadFrontendNodeTypeTokenAdmissionPolicy } from './kern-frontend-node-type-token-admission/policy.mjs';

const SOURCE_URL = new URL('../examples/kern-frontend/node-type-token-admission.kern', import.meta.url);
const RECORD_WIDTH = 16;
const FAILURE_CODES = new Set([
  'ADMISSION_INVALID', 'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'EMPTY_RETAINED_CODE', 'INVALID_LIMITS',
  'LEXICAL_DEPTH_LIMIT', 'RECORD_LIMIT', 'STREAM_INVALID', 'TOKEN_LIMIT', 'TRIM_INVALID', 'UNSUPPORTED_UNKNOWN',
]);
const TOKEN_KINDS = new Set([
  'comma', 'equals', 'expr', 'identifier', 'number', 'quoted', 'slash', 'style',
  'themeRef', 'unknown', 'whitespace',
]);

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

export function validateNativeNodeTypeTokenAdmissionSource(source) {
  for (const forbidden of [
    'TokenStream', 'tryIdent', 'isKnownNodeType', 'UNKNOWN_NODE_TYPE', 'parseDocument',
    'normalizeNodeTypeTokenAdmissionOracle', 'executeKernRuntimeHandler', 'capability',
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
    ['observenodetypetokenadmission', 1],
  ]) {
    if ((source.match(new RegExp(`fn name=${name}\\b`, 'gu')) ?? []).length !== expected) {
      fail('composition rejection', `source must contain exactly one ${name}`);
    }
  }
  if (!source.includes('observeretainedtokenstream(content, maxCodePoints,')) {
    fail('composition rejection', 'node-type-token admission must compose M4.159');
  }
  return source;
}

export function loadNodeTypeTokenAdmissionSource() {
  return validateNativeNodeTypeTokenAdmissionSource(`${loadRetainedTokenStreamSource()}\n\n${readRegularSource(SOURCE_URL)}`);
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

function optionalUint(field, label) {
  return field === 'none' ? null : uint(field, label);
}

function textFields(value) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  return value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
}

export function parseNodeTypeTokenAdmissionEnvelope(
  content,
  value,
  policy = loadFrontendNodeTypeTokenAdmissionPolicy(),
) {
  const fields = textFields(value);
  if (fields[0] !== policy.nodeTypeTokenAdmissionFormat || (fields.length - 1) % RECORD_WIDTH !== 0) {
    fail('record rejection', 'invalid node-type-token admission envelope');
  }
  const expected = normalizeNodeTypeTokenAdmissionOracle(content, policy);
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
  const decisionRecord = fields.slice(1, 1 + RECORD_WIDTH);
  if (
    decisionRecord[0] !== 'decision' || !['admitted', 'dropped'].includes(decisionRecord[1]) ||
    decisionRecord[3] !== '0' || !TOKEN_KINDS.has(decisionRecord[6]) || decisionRecord[12] !== policy.retainedTokenStreamFormat
  ) {
    fail('record rejection', 'invalid decision record');
  }
  const decision = {
    admittedType: decisionRecord[11],
    codeEndOffset: uint(decisionRecord[13], 'decision code-end offset'),
    cursorAfter: uint(decisionRecord[4], 'cursor after'),
    cursorBefore: 0,
    firstNonWhitespaceIndex: optionalUint(decisionRecord[9], 'first nonwhitespace index'),
    firstNonWhitespaceStartScalar: optionalUint(decisionRecord[10], 'first nonwhitespace start'),
    inheritedStreamFieldCount: uint(decisionRecord[15], 'inherited stream field count'),
    retainedSource: decisionRecord[2],
    retainedTokenStreamFormat: decisionRecord[12],
    status: decisionRecord[1],
    tokenCount: uint(decisionRecord[5], 'token count'),
    tokenZeroKind: decisionRecord[6],
    tokenZeroStartScalar: uint(decisionRecord[8], 'token-zero start'),
    tokenZeroValue: decisionRecord[7],
    triviaEndOffset: uint(decisionRecord[14], 'decision trivia-end offset'),
  };
  if (
    decision.retainedSource !== [...content].slice(0, decision.codeEndOffset).join('') ||
    decision.codeEndOffset > decision.triviaEndOffset || decision.triviaEndOffset > [...content].length ||
    decision.tokenCount <= 0 || decision.tokenZeroStartScalar !== 0 || decision.firstNonWhitespaceIndex === null ||
    (decision.status === 'admitted' && (decision.cursorAfter !== 1 || decision.tokenZeroKind !== 'identifier' || decision.admittedType !== decision.tokenZeroValue)) ||
    (decision.status === 'dropped' && (decision.cursorAfter !== 0 || decision.tokenZeroKind === 'identifier' || decision.admittedType !== ''))
  ) {
    fail('record rejection', 'decision semantics drift');
  }

  let cursor = 1 + RECORD_WIDTH;
  const inheritedStreamFields = [];
  let streamAuthIndex = 0;
  while (inheritedStreamFields.length < decision.inheritedStreamFieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], 'stream-auth field count');
    if (
      record[0] !== 'stream-auth' || uint(record[1], 'stream-auth index') !== streamAuthIndex ||
      uint(record[2], 'stream-auth field start') !== inheritedStreamFields.length ||
      count <= 0 || count > 12 || count > decision.inheritedStreamFieldCount - inheritedStreamFields.length ||
      record.slice(4 + count).some(Boolean)
    ) {
      fail('record rejection', 'invalid inherited stream-auth record');
    }
    inheritedStreamFields.push(...record.slice(4, 4 + count));
    streamAuthIndex += 1;
    cursor += RECORD_WIDTH;
  }
  const expectedInheritedStreamFields = normalizeInheritedRetainedStreamFields(content, policy);
  try {
    assert.deepEqual(inheritedStreamFields, expectedInheritedStreamFields);
  } catch {
    fail('record rejection', 'inherited retained stream semantic drift');
  }
  let diagnostic;
  let error;
  if (decision.status === 'dropped') {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (
      record[0] !== 'diagnostic' || record[1] !== 'DROPPED_LINE' || record[2] !== 'error' ||
      record[3] !== 'Dropped line 1: expected a node type at the start of the line' || record[4] !== '1' ||
      record[7] !== 'Rewrite this line so it starts with a valid KERN node type and move stray symbols into props.' ||
      record[8] !== 'parser' || record.slice(9).some(Boolean)
    ) {
      fail('record rejection', 'invalid diagnostic record');
    }
    diagnostic = {
      category: record[8],
      code: record[1],
      col: uint(record[5], 'diagnostic col'),
      endCol: uint(record[6], 'diagnostic end col'),
      line: 1,
      message: record[3],
      severity: record[2],
      suggestion: record[7],
    };
    cursor += RECORD_WIDTH;
    const errorRecord = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (
      errorRecord[0] !== 'error' || errorRecord[1] !== '__error' || errorRecord[2] !== '0' ||
      errorRecord[4] !== 'Dropped line 1: expected a node type' || errorRecord[5] !== decision.retainedSource ||
      errorRecord[6] !== 'DROPPED_LINE' || errorRecord[7] !== 'absent' ||
      errorRecord.slice(8, 11).some((field) => field !== '0') || errorRecord.slice(11, 14).some((field) => field !== '1') ||
      errorRecord[15] !== ''
    ) {
      fail('record rejection', 'invalid error record');
    }
    error = {
      indent: 0,
      loc: {
        col: 1,
        endCol: uint(errorRecord[14], 'error location end col'),
        endLine: 1,
        line: 1,
      },
      props: { code: errorRecord[6], message: errorRecord[4], raw: errorRecord[5] },
      pseudoStyleCount: 0,
      quotedProps: errorRecord[7],
      rawLength: uint(errorRecord[3], 'error raw length'),
      styleCount: 0,
      themeRefCount: 0,
      type: errorRecord[1],
    };
    cursor += RECORD_WIDTH;
  }

  const sealRecord = fields.slice(cursor, cursor + RECORD_WIDTH);
  if (cursor !== fields.length - RECORD_WIDTH || sealRecord[0] !== 'seal' || sealRecord[1] !== decision.status || sealRecord[15] !== '') {
    fail('record rejection', 'seal must be exact and terminal');
  }
  const seal = {
    admittedType: sealRecord[6],
    codeEndOffset: uint(sealRecord[12], 'seal code-end offset'),
    cursorAfter: uint(sealRecord[4], 'seal cursor after'),
    diagnosticCount: uint(sealRecord[7], 'seal diagnostic count'),
    errorCount: uint(sealRecord[8], 'seal error count'),
    firstNonWhitespaceIndex: optionalUint(sealRecord[5], 'seal first nonwhitespace index'),
    markerKind: sealRecord[14],
    originalContent: sealRecord[11],
    retainedByteLength: uint(sealRecord[10], 'retained byte length'),
    retainedScalarLength: uint(sealRecord[9], 'retained scalar length'),
    retainedSource: sealRecord[2],
    status: sealRecord[1],
    tokenCount: uint(sealRecord[3], 'seal token count'),
    triviaEndOffset: uint(sealRecord[13], 'seal trivia-end offset'),
  };
  if (
    seal.retainedSource !== decision.retainedSource || seal.originalContent !== content ||
    seal.tokenCount !== decision.tokenCount || seal.cursorAfter !== decision.cursorAfter ||
    seal.firstNonWhitespaceIndex !== decision.firstNonWhitespaceIndex || seal.admittedType !== decision.admittedType ||
    seal.retainedScalarLength !== [...decision.retainedSource].length ||
    seal.retainedByteLength !== Buffer.byteLength(decision.retainedSource, 'utf8') ||
    seal.codeEndOffset !== decision.codeEndOffset || seal.triviaEndOffset !== decision.triviaEndOffset ||
    (decision.status === 'admitted' && (seal.diagnosticCount !== 0 || seal.errorCount !== 0)) ||
    (decision.status === 'dropped' && (seal.diagnosticCount !== 1 || seal.errorCount !== 1))
  ) {
    fail('record rejection', 'terminal identity or counts drift');
  }
  const actual = {
    decision,
    format: policy.nodeTypeTokenAdmissionFormat,
    seal,
    sourceProfile: policy.nodeTypeTokenAdmissionSourceProfile,
    ...(diagnostic === undefined ? {} : { diagnostic }),
    ...(error === undefined ? {} : { error }),
  };
  try {
    assert.deepEqual(actual, expected);
  } catch {
    fail('record rejection', 'node-type-token admission oracle drift');
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
      handlerName: 'observenodetypetokenadmission',
      sourcePath: 'examples/kern-frontend/node-type-token-admission.kern',
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

export function executeFrontendNodeTypeTokenAdmission(
  content,
  policy = loadFrontendNodeTypeTokenAdmissionPolicy(),
  kernSource = loadNodeTypeTokenAdmissionSource(),
) {
  if (!wellFormedUtf16(content)) return failure('MALFORMED_UTF16');
  if (Buffer.byteLength(content, 'utf8') > policy.profileLimits.maxSourceBytes) return failure('SOURCE_BYTES_LIMIT');
  if ([...content].length > policy.profileLimits.maxCodePoints) return failure('CODE_POINTS_LIMIT');
  if (content.includes('\n') || content.includes('\r')) return failure('UNSUPPORTED_LINE_ENDING');
  return parseNodeTypeTokenAdmissionEnvelope(content, executeHandler(content, policy, kernSource), policy);
}

export function runKernFrontendNodeTypeTokenAdmissionCheck() {
  const policy = loadFrontendNodeTypeTokenAdmissionPolicy();
  const source = loadNodeTypeTokenAdmissionSource();
  for (const fixture of NODE_TYPE_TOKEN_ADMISSION_FIXTURES) {
    assert.deepEqual(
      executeFrontendNodeTypeTokenAdmission(fixture.source, policy, source),
      normalizeNodeTypeTokenAdmissionOracle(fixture.source, policy),
      fixture.id,
    );
  }
  for (const fixture of INHERITED_ADMISSION_FAILURE_FIXTURES) {
    assert.deepEqual(executeFrontendNodeTypeTokenAdmission(fixture.source, policy, source), failure(fixture.code), fixture.id);
  }
  return { differential: NODE_TYPE_TOKEN_ADMISSION_FIXTURES.length, inheritedFailures: INHERITED_ADMISSION_FAILURE_FIXTURES.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendNodeTypeTokenAdmissionCheck();
  process.stdout.write(`KERN frontend node-type-token admission: ${JSON.stringify(result)}\n`);
}
