#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import { corpusDocuments } from './kern-frontend-stitcher/corpus.mjs';
import { PARITY_FIXTURES, REJECTION_FIXTURES } from './kern-frontend-stitcher/fixtures.mjs';
import { normalizeStitchOracle } from './kern-frontend-stitcher/oracle.mjs';
import { loadFrontendStitcherPolicy, rawProfileArgument } from './kern-frontend-stitcher/policy.mjs';

const SOURCE_URLS = [
  new URL('../examples/kern-frontend/tokenizer-helpers.kern', import.meta.url),
  new URL('../examples/kern-frontend/tokenizer.kern', import.meta.url),
  new URL('../examples/kern-frontend/stitcher-helpers.kern', import.meta.url),
  new URL('../examples/kern-frontend/stitcher.kern', import.meta.url),
];
const FAILURE_CODES = new Set([
  'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'ENVELOPE_RECORD_LIMIT', 'GROUP_LIMIT',
  'GROUP_RECORD_LIMIT', 'INVALID_LIMITS', 'PHYSICAL_RECORD_CODE_POINTS_LIMIT',
  'PHYSICAL_RECORD_LIMIT', 'RAW_OPENER_LIMIT', 'RECORD_LIMIT', 'STITCH_DEPTH_LIMIT',
  'TOKEN_LIMIT', 'UNSUPPORTED_LINE_ENDING', 'UNSUPPORTED_UNKNOWN',
]);
const PHYSICAL_CLASSES = new Set(['blank', 'file-comment-candidate', 'ordinary', 'raw-opener-candidate']);
const TERMINATIONS = new Set(['comment-boundary', 'complete', 'eof-unclosed', 'raw-opener-boundary']);

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

export function validateNativeStitcherSource(source) {
  for (const forbidden of [
    'tokenizeLineInternal', 'parseDocument', 'executeKernRuntimeHandler', 'scanLineState',
  ]) {
    if (source.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  return source;
}

export function loadStitcherSource() {
  return validateNativeStitcherSource(SOURCE_URLS.map(readRegularSource).join('\n\n'));
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

function decodeTokenizer(source, fields) {
  if (fields[0] !== 'kern.frontend.tokenizer-shadow.2' || (fields.length - 1) % 4 !== 0) {
    fail('token rejection', 'invalid composed tokenizer envelope');
  }
  const tokens = [];
  const diagnostics = [];
  let cursor = 0;
  let startByte = 0;
  let sealed = false;
  for (let index = 1; index < fields.length; index += 4) {
    const [tag, first, second, third] = fields.slice(index, index + 4);
    if (tag === 'seal') {
      if (index !== fields.length - 4 || second !== '' || third !== '' || source.slice(cursor) !== first) {
        fail('token rejection', 'invalid tokenizer seal');
      }
      sealed = true;
      cursor = source.length;
      continue;
    }
    const delta = tag === 'token' ? third : second;
    if (!source.startsWith(delta, cursor)) fail('token rejection', 'token delta drift');
    cursor += delta.length;
    startByte += Buffer.byteLength(delta);
    if (tag === 'token') tokens.push({ kind: first, startByte, value: second });
    else if (tag === 'diagnostic') {
      if (!source.startsWith(third, cursor)) fail('token rejection', 'diagnostic end drift');
      diagnostics.push({ code: first, colByte: startByte + 1, endColByte: startByte + Buffer.byteLength(third) + 1 });
    } else fail('token rejection', `unknown tokenizer record ${tag}`);
  }
  if (!sealed) fail('token rejection', 'composed tokenizer envelope is unsealed');
  return { diagnostics, tokens };
}

export function parseEnvelope(source, value, policy) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  const fields = value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
  if (fields[0] !== policy.format || (fields.length - 1) % 8 !== 0) fail('record rejection', 'invalid envelope');
  if (fields[1] === 'failure') {
    if (fields.length !== 9 || !FAILURE_CODES.has(fields[2]) || fields.slice(4).some(Boolean)) {
      fail('record rejection', 'invalid failure envelope');
    }
    return failure(fields[2], fields[3]);
  }
  const physical = [];
  const groups = [];
  const tokenFields = new Map();
  let sealCount = 0;
  let reconstructed = '';
  let phase = 'physical';
  let parsedRecords = 0;
  let rawOpeners = 0;
  for (let offset = 1; offset < fields.length; offset += 8) {
    parsedRecords += 1;
    if (parsedRecords > policy.profileLimits.maxEnvelopeRecords) fail('record rejection', 'envelope record limit exceeded');
    const record = fields.slice(offset, offset + 8);
    const [tag] = record;
    if (tag === 'physical') {
      if (phase !== 'physical') fail('record rejection', 'physical records must form the first phase');
      const [, rawIndex, content, indent, rawHasLf, recordClass, extent, reserved] = record;
      const index = integer(rawIndex, 'physical index');
      if (index !== physical.length || reserved !== '' || (rawHasLf !== '0' && rawHasLf !== '1')) {
        fail('record rejection', 'invalid physical record shape or order');
      }
      if (index >= policy.profileLimits.maxPhysicalRecords) {
        fail('record rejection', 'physical record limit exceeded');
      }
      const hasLf = rawHasLf === '1';
      if (!PHYSICAL_CLASSES.has(recordClass)) fail('record rejection', `unknown physical class ${recordClass}`);
      if (recordClass === 'raw-opener-candidate') {
        rawOpeners += 1;
        if (rawOpeners > policy.profileLimits.maxRawOpeners) {
          fail('record rejection', 'raw opener limit exceeded');
        }
      }
      if (extent !== content + (hasLf ? '\n' : '') || !content.startsWith(indent) || /[^\t ]/u.test(indent)) {
        fail('record rejection', 'physical tape drift');
      }
      const startByte = Buffer.byteLength(reconstructed);
      reconstructed += extent;
      physical.push({
        class: recordClass,
        content,
        contentEndByte: startByte + Buffer.byteLength(content),
        hasLf,
        indent,
        index,
        recordEndByte: Buffer.byteLength(reconstructed),
        startByte,
      });
    } else if (tag === 'group') {
      if (phase === 'seal') fail('record rejection', 'group follows seal');
      phase = 'group';
      const [, rawIndex, rawStart, rawEnd, termination, rawQuote, rawDepth, reserved] = record;
      const index = integer(rawIndex, 'group index');
      const start = integer(rawStart, 'group start');
      const end = integer(rawEnd, 'group end');
      const exprDepth = integer(rawDepth, 'expression depth');
      const rangeLength = end - start + 1;
      if (
        index !== groups.length || reserved !== '' || !['0', '1'].includes(rawQuote) ||
        !TERMINATIONS.has(termination) || end < start || end >= physical.length ||
        rangeLength > policy.profileLimits.maxGroupRecords ||
        index >= policy.profileLimits.maxGroups || exprDepth > policy.profileLimits.maxStitchDepth
      ) {
        fail('record rejection', 'invalid group record');
      }
      groups.push({
        exprDepth,
        inQuote: rawQuote === '1',
        physicalIndexes: Array.from({ length: rangeLength }, (_, delta) => start + delta),
        termination,
      });
    } else if (tag === 'token-field') {
      if (phase !== 'group' && phase !== 'token') {
        fail('record rejection', 'token fields must follow their group');
      }
      const [, rawGroup, rawOrdinal, field, ...reserved] = record;
      if (reserved.some(Boolean)) fail('record rejection', 'token field reserved slots must be empty');
      const groupIndex = integer(rawGroup, 'token group');
      const ordinal = integer(rawOrdinal, 'token ordinal');
      if (groupIndex !== groups.length - 1) {
        fail('record rejection', 'token fields must follow their group');
      }
      phase = 'token';
      const list = tokenFields.get(groupIndex) ?? [];
      if (ordinal !== list.length) fail('record rejection', 'token field ordinal drift');
      list.push(field);
      tokenFields.set(groupIndex, list);
    } else if (tag === 'seal') {
      phase = 'seal';
      if (record[1] !== source || record.slice(2).some(Boolean) || offset !== fields.length - 8) {
        fail('record rejection', 'invalid terminal seal');
      }
      sealCount += 1;
    } else fail('record rejection', `unknown record ${tag}`);
  }
  if (sealCount !== 1 || reconstructed !== source) fail('record rejection', 'source reconstruction mismatch');
  const coveredOrdinary = new Set();
  let priorGroupEnd = -1;
  let totalDiagnostics = 0;
  let totalTokens = 0;
  for (const [index, group] of groups.entries()) {
    const start = group.physicalIndexes[0];
    const end = group.physicalIndexes.at(-1);
    if (
      start === undefined || end === undefined || start <= priorGroupEnd || end >= physical.length ||
      physical[start]?.class !== 'ordinary'
    ) {
      fail('record rejection', `group ${index} range is invalid`);
    }
    priorGroupEnd = end;
    for (const physicalIndex of group.physicalIndexes) {
      const recordClass = physical[physicalIndex]?.class;
      if (recordClass === undefined || recordClass === 'file-comment-candidate' || recordClass === 'raw-opener-candidate') {
        fail('record rejection', `group ${index} swallowed a structural boundary`);
      }
      if (recordClass === 'ordinary') {
        if (coveredOrdinary.has(physicalIndex)) fail('record rejection', 'ordinary record belongs to multiple groups');
        coveredOrdinary.add(physicalIndex);
      }
    }
    if (group.termination === 'complete' && (group.inQuote || group.exprDepth !== 0)) {
      fail('record rejection', `complete group ${index} discloses open state`);
    }
    if (group.termination === 'comment-boundary' && physical[end + 1]?.class !== 'file-comment-candidate') {
      fail('record rejection', `group ${index} lacks its comment boundary`);
    }
    if (group.termination === 'raw-opener-boundary' && physical[end + 1]?.class !== 'raw-opener-candidate') {
      fail('record rejection', `group ${index} lacks its raw boundary`);
    }
    if (group.termination !== 'complete' && !group.inQuote && group.exprDepth === 0) {
      fail('record rejection', `unfinished group ${index} lacks open state`);
    }
    const groupSource = group.physicalIndexes.map((physicalIndex) => physical[physicalIndex]?.content).join('\n');
    const fieldsForGroup = tokenFields.get(index);
    if (group.termination === 'complete') {
      if (fieldsForGroup === undefined) fail('token rejection', `group ${index} lacks token composition`);
      group.tokenizer = decodeTokenizer(groupSource, fieldsForGroup);
      const documentBase = physical[start].startByte;
      group.tokenizer.tokens = group.tokenizer.tokens.map((token) => ({
        ...token,
        documentStartByte: documentBase + token.startByte,
      }));
      group.tokenizer.diagnostics = group.tokenizer.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        documentEndByte: documentBase + diagnostic.endColByte - 1,
        documentStartByte: documentBase + diagnostic.colByte - 1,
      }));
      totalTokens += group.tokenizer.tokens.length;
      totalDiagnostics += group.tokenizer.diagnostics.length;
    } else if (fieldsForGroup !== undefined) fail('token rejection', `unfinished group ${index} has token output`);
  }
  if (totalTokens > policy.profileLimits.maxTokens) fail('token rejection', 'aggregate token limit exceeded');
  if (totalDiagnostics > policy.profileLimits.maxDiagnostics) {
    fail('token rejection', 'aggregate diagnostic limit exceeded');
  }
  for (const record of physical) {
    if (record.class === 'ordinary' && !coveredOrdinary.has(record.index)) {
      fail('record rejection', `ordinary record ${record.index} is ungrouped`);
    }
  }
  if ([...tokenFields.keys()].some((index) => index >= groups.length)) fail('token rejection', 'orphan token fields');
  return { format: policy.format, groups, physical };
}

export function executeFrontendStitcher(
  source,
  policy = loadFrontendStitcherPolicy(),
  kernSource = loadStitcherSource(),
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
      limits.maxRawOpeners,
    ],
    identity: { handlerName: 'stitchdocument', sourcePath: 'examples/kern-frontend/stitcher.kern' },
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
  return parseEnvelope(source, envelope.result.value, policy);
}

export function runKernFrontendStitcherCheck() {
  const policy = loadFrontendStitcherPolicy();
  const fixtures = [...PARITY_FIXTURES, ...corpusDocuments(policy)];
  for (const fixture of fixtures) {
    assert.deepEqual(
      executeFrontendStitcher(fixture.source, policy),
      normalizeStitchOracle(fixture.source, policy.rawOpenerTypes),
      fixture.id,
    );
  }
  for (const fixture of REJECTION_FIXTURES) {
    assert.deepEqual(executeFrontendStitcher(fixture.source, policy), failure(fixture.code), fixture.id);
  }
  return { fixtures: fixtures.length, rejections: REJECTION_FIXTURES.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendStitcherCheck();
  process.stdout.write(`KERN frontend stitch shadow: ${result.fixtures} parity and ${result.rejections} rejection cases passed.\n`);
}
