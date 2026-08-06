#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import { executeFrontendLexical, loadLexicalSource } from './check-kern-frontend-lexical.mjs';
import { corpusDocuments } from './kern-frontend-stitcher/corpus.mjs';
import { rawProfileArgument } from './kern-frontend-stitcher/policy.mjs';
import { COMMENT_BOUNDARY_FIXTURES } from './kern-frontend-comment-boundary/fixtures.mjs';
import { normalizeCommentBoundaryOracle } from './kern-frontend-comment-boundary/oracle.mjs';
import { loadFrontendCommentBoundaryPolicy } from './kern-frontend-comment-boundary/policy.mjs';
import { LEXICAL_FIXTURES } from './kern-frontend-lexical/fixtures.mjs';

const COMMENT_BOUNDARY_SOURCE_URL = new URL('../examples/kern-frontend/comment-boundaries.kern', import.meta.url);
const FAILURE_CODES = new Set([
  'CHECKPOINT_LIMIT', 'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'ENVELOPE_RECORD_LIMIT',
  'GROUP_LIMIT', 'GROUP_RECORD_LIMIT', 'INVALID_LIMITS', 'LEXICAL_DEPTH_LIMIT',
  'PARTITION_INVALID', 'PARTITION_LIMIT', 'PHYSICAL_RECORD_CODE_POINTS_LIMIT',
  'PHYSICAL_RECORD_LIMIT', 'RAW_OPENER_LIMIT', 'RECORD_LIMIT', 'STITCH_DEPTH_LIMIT',
  'TOKEN_LIMIT', 'UNSUPPORTED_LINE_ENDING', 'UNSUPPORTED_UNKNOWN',
]);
const MARKER_KINDS = new Set(['hash', 'none', 'slash-slash']);
const QUOTES = new Set(['double', 'none', 'single']);
const STOPS = new Set(['eligible-marker', 'record-end']);
const RECORD_WIDTH = 16;

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

export function validateNativeCommentBoundarySource(source) {
  for (const forbidden of [
    'executeKernRuntimeHandler', 'normalizeCommentBoundaryOracle', 'normalizeLexicalOracle',
    'parseDocument', 'stripInlineComment', 'tokenizeLineInternal',
  ]) {
    if (source.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  if (!source.includes('observelexical(source, rawProfile,')) {
    fail('composition rejection', 'comment boundary handler must compose observelexical in KERN');
  }
  return source;
}

export function loadCommentBoundarySource() {
  return validateNativeCommentBoundarySource(
    `${loadLexicalSource()}\n\n${readRegularSource(COMMENT_BOUNDARY_SOURCE_URL)}`,
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

export function parseCommentBoundaryEnvelope(source, value, policy = loadFrontendCommentBoundaryPolicy()) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  const fields = value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
  if (fields[0] !== policy.commentBoundaryFormat || (fields.length - 1) % RECORD_WIDTH !== 0) {
    fail('record rejection', 'invalid comment boundary envelope');
  }
  const lexical = executeFrontendLexical(source, policy);
  const expectedResult = normalizeCommentBoundaryOracle(source, policy.rawOpenerTypes, policy, lexical);
  if (fields[1] === 'failure') {
    if (fields.length !== RECORD_WIDTH + 1 || !FAILURE_CODES.has(fields[2]) || fields.slice(4).some(Boolean)) {
      fail('record rejection', 'invalid failure envelope');
    }
    const actualFailure = failure(fields[2], fields[3]);
    if (!('status' in expectedResult)) fail('record rejection', 'failure envelope contradicts oracle success');
    if (actualFailure.code !== expectedResult.code || actualFailure.detail !== expectedResult.detail) {
      fail('record rejection', 'failure envelope drift');
    }
    return actualFailure;
  }

  if ('status' in expectedResult) fail('record rejection', 'success envelope contradicts oracle failure');
  const partitions = [];
  let sealed = false;
  for (let offset = 1; offset < fields.length; offset += RECORD_WIDTH) {
    const record = fields.slice(offset, offset + RECORD_WIDTH);
    if (record[0] === 'seal') {
      if (sealed || offset !== fields.length - RECORD_WIDTH || record[1] !== source || record.slice(2).some(Boolean)) {
        fail('record rejection', 'invalid terminal seal');
      }
      sealed = true;
      continue;
    }
    if (sealed || record[0] !== 'partition') fail('record rejection', `unknown or post-seal record ${record[0]}`);
    if (partitions.length >= policy.maxPartitions) fail('record rejection', 'partition limit exceeded');
    const partition = {
      partitionIndex: integer(record[1], 'partition index'),
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
    };
    if (!QUOTES.has(partition.quote) || !STOPS.has(partition.stop) || !MARKER_KINDS.has(partition.markerKind)) {
      fail('record rejection', 'unknown quote, stop, or marker kind');
    }
    const scalars = [...partition.content];
    if (partition.markerOffset === null) {
      if (
        partition.stop !== 'record-end' || partition.markerKind !== 'none' ||
        partition.markerText !== '' || partition.rawPayload !== ''
      ) {
        fail('record rejection', 'record-end partition contains marker data');
      }
    } else {
      const expectedMarker = partition.markerKind === 'hash' ? '#' : '//';
      const previous = scalars[partition.markerOffset - 1] ?? '';
      if (
        partition.stop !== 'eligible-marker' || partition.markerKind === 'none' ||
        partition.markerText !== expectedMarker || partition.markerOffset === 0 ||
        (previous !== ' ' && previous !== '\t')
      ) {
        fail('record rejection', 'eligible partition marker is inconsistent');
      }
      const prefix = scalars.slice(0, partition.markerOffset).join('');
      if (prefix + partition.markerText + partition.rawPayload !== partition.content) {
        fail('record rejection', 'partition reconstruction drift');
      }
    }
    const expected = expectedResult.partitions[partitions.length];
    if (!expected || !Object.keys(expected).every((key) => partition[key] === expected[key])) {
      fail('record rejection', 'partition identity, state, marker, or payload drift');
    }
    partitions.push(partition);
  }
  if (!sealed) fail('record rejection', 'missing terminal seal');
  if (partitions.length !== expectedResult.partitions.length) fail('record rejection', 'partition coverage drift');
  return { format: policy.commentBoundaryFormat, partitions };
}

export function executeFrontendCommentBoundaries(
  source,
  policy = loadFrontendCommentBoundaryPolicy(),
  kernSource = loadCommentBoundarySource(),
) {
  if (!wellFormedUtf16(source)) return failure('MALFORMED_UTF16');
  if (Buffer.byteLength(source) > policy.profileLimits.maxSourceBytes) return failure('SOURCE_BYTES_LIMIT');
  for (const record of source.split('\n')) {
    if (Buffer.byteLength(record) > policy.profileLimits.maxPhysicalRecordBytes) {
      return failure('PHYSICAL_RECORD_BYTES_LIMIT');
    }
  }
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync({
    abi: KERN_RUNTIME_HANDLER_ABI,
    arguments: [
      source, rawProfileArgument(policy), limits.maxCodePoints, limits.maxPhysicalRecords,
      limits.maxPhysicalRecordCodePoints, limits.maxGroups, limits.maxGroupRecords,
      limits.maxStitchDepth, limits.maxTokens, limits.maxDiagnostics, limits.maxEnvelopeRecords,
      limits.maxRawOpeners, policy.maxCheckpoints, policy.maxLexicalDepth, policy.maxPartitions,
    ],
    identity: {
      handlerName: 'observecommentboundaries',
      sourcePath: 'examples/kern-frontend/comment-boundaries.kern',
    },
    source: kernSource,
  }, { enabled: true, limits: policy.runtimeLimits });
  if (Buffer.byteLength(`${JSON.stringify(envelope)}\n`) > limits.maxOutputJsonBytes) {
    fail('runtime rejection', 'OUTPUT_JSON_BYTES_LIMIT');
  }
  if (
    envelope.outcome !== 'success' || envelope.completion.kind !== 'return' ||
    envelope.events.length !== 0 || envelope.result.presence !== 'value'
  ) {
    fail('runtime rejection', JSON.stringify(envelope.diagnostics));
  }
  return parseCommentBoundaryEnvelope(source, envelope.result.value, policy);
}

export function runKernFrontendCommentBoundaryCheck() {
  const policy = loadFrontendCommentBoundaryPolicy();
  const fixtures = [...COMMENT_BOUNDARY_FIXTURES, ...LEXICAL_FIXTURES, ...corpusDocuments(policy)];
  for (const fixture of fixtures) {
    const lexical = executeFrontendLexical(fixture.source, policy);
    assert.deepEqual(
      executeFrontendCommentBoundaries(fixture.source, policy),
      normalizeCommentBoundaryOracle(fixture.source, policy.rawOpenerTypes, policy, lexical),
      fixture.id,
    );
  }
  return { fixtures: fixtures.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendCommentBoundaryCheck();
  process.stdout.write(`KERN frontend comment boundary shadow: ${result.fixtures} parity cases passed.\n`);
}
