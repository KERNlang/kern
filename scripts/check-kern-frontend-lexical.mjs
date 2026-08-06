#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import { executeFrontendStitcher, loadStitcherSource } from './check-kern-frontend-stitcher.mjs';
import { corpusDocuments } from './kern-frontend-stitcher/corpus.mjs';
import { rawProfileArgument } from './kern-frontend-stitcher/policy.mjs';
import { LEXICAL_FIXTURES } from './kern-frontend-lexical/fixtures.mjs';
import { normalizeLexicalOracle } from './kern-frontend-lexical/oracle.mjs';
import { loadFrontendLexicalPolicy } from './kern-frontend-lexical/policy.mjs';

const LEXICAL_SOURCE_URL = new URL('../examples/kern-frontend/lexical-checkpoints.kern', import.meta.url);
const QUOTES = new Set(['double', 'none', 'single']);
const STOPS = new Set(['eligible-marker', 'record-end']);
const FAILURE_CODES = new Set([
  'CHECKPOINT_LIMIT', 'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'ENVELOPE_RECORD_LIMIT',
  'GROUP_LIMIT', 'GROUP_RECORD_LIMIT', 'INVALID_LIMITS', 'LEXICAL_DEPTH_LIMIT',
  'PHYSICAL_RECORD_CODE_POINTS_LIMIT', 'PHYSICAL_RECORD_LIMIT', 'RAW_OPENER_LIMIT',
  'RECORD_LIMIT', 'STITCH_DEPTH_LIMIT', 'TOKEN_LIMIT', 'UNSUPPORTED_LINE_ENDING',
  'UNSUPPORTED_UNKNOWN',
]);

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

export function validateNativeLexicalSource(source) {
  for (const forbidden of [
    'executeKernRuntimeHandler', 'normalizeLexicalOracle', 'normalizeStitchOracle',
    'parseDocument', 'physicalOracle', 'stripInlineComment', 'tokenizeLineInternal',
  ]) {
    if (source.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  if (!source.includes('stitchdocument(source, rawProfile,')) {
    fail('composition rejection', 'lexical handler must compose stitchdocument in KERN');
  }
  return source;
}

export function loadLexicalSource() {
  return validateNativeLexicalSource(`${loadStitcherSource()}\n\n${readRegularSource(LEXICAL_SOURCE_URL)}`);
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

export function parseLexicalEnvelope(source, value, policy = loadFrontendLexicalPolicy()) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  const fields = value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
  if (fields[0] !== policy.lexicalFormat || (fields.length - 1) % 12 !== 0) {
    fail('record rejection', 'invalid lexical envelope');
  }
  const stitchResult = executeFrontendStitcher(source, policy);
  const expectedResult = normalizeLexicalOracle(source, policy.rawOpenerTypes, policy, stitchResult);
  if (fields[1] === 'failure') {
    if (fields.length !== 13 || !FAILURE_CODES.has(fields[2]) || fields.slice(4).some(Boolean)) {
      fail('record rejection', 'invalid failure envelope');
    }
    const actualFailure = failure(fields[2], fields[3]);
    if (!('status' in expectedResult)) {
      fail('record rejection', 'failure envelope contradicts oracle success');
    }
    if (actualFailure.code !== expectedResult.code || actualFailure.detail !== expectedResult.detail) {
      fail('record rejection', 'failure envelope drift');
    }
    return actualFailure;
  }

  if ('status' in expectedResult) fail('record rejection', 'success envelope contradicts oracle failure');
  const checkpoints = [];
  let sealed = false;
  for (let offset = 1; offset < fields.length; offset += 12) {
    const record = fields.slice(offset, offset + 12);
    if (record[0] === 'seal') {
      if (sealed || offset !== fields.length - 12 || record[1] !== source || record.slice(2).some(Boolean)) {
        fail('record rejection', 'invalid terminal seal');
      }
      sealed = true;
      continue;
    }
    if (sealed || record[0] !== 'checkpoint') fail('record rejection', `unknown or post-seal record ${record[0]}`);
    if (checkpoints.length >= policy.maxCheckpoints) fail('record rejection', 'checkpoint limit exceeded');
    const checkpoint = {
      checkpointIndex: integer(record[1], 'checkpoint index'),
      groupIndex: integer(record[2], 'group index'),
      groupRecordIndex: integer(record[3], 'group record index'),
      physicalIndex: integer(record[4], 'physical index'),
      content: record[5],
      quote: record[6],
      escapePending: booleanField(record[7], 'escape pending'),
      expressionDepth: integer(record[8], 'expression depth'),
      styleDepth: integer(record[9], 'style depth'),
      stop: record[10],
      markerOffset: record[11] === 'none' ? null : integer(record[11], 'marker offset'),
    };
    if (!QUOTES.has(checkpoint.quote) || !STOPS.has(checkpoint.stop)) {
      fail('record rejection', 'unknown quote or stop state');
    }
    if ((checkpoint.stop === 'record-end') !== (checkpoint.markerOffset === null)) {
      fail('record rejection', 'marker stop and offset disagree');
    }
    const expected = expectedResult.checkpoints[checkpoints.length];
    if (!expected || !Object.keys(expected).every((key) => checkpoint[key] === expected[key])) {
      fail('record rejection', 'checkpoint identity or state drift');
    }
    checkpoints.push(checkpoint);
  }
  if (!sealed) fail('record rejection', 'missing terminal seal');
  if (checkpoints.length !== expectedResult.checkpoints.length) fail('record rejection', 'checkpoint coverage drift');
  return { checkpoints, format: policy.lexicalFormat };
}

export function executeFrontendLexical(
  source,
  policy = loadFrontendLexicalPolicy(),
  kernSource = loadLexicalSource(),
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
      limits.maxRawOpeners, policy.maxCheckpoints, policy.maxLexicalDepth,
    ],
    identity: { handlerName: 'observelexical', sourcePath: 'examples/kern-frontend/lexical-checkpoints.kern' },
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
  return parseLexicalEnvelope(source, envelope.result.value, policy);
}

export function runKernFrontendLexicalCheck() {
  const policy = loadFrontendLexicalPolicy();
  const fixtures = [...LEXICAL_FIXTURES, ...corpusDocuments(policy)];
  for (const fixture of fixtures) {
    assert.deepEqual(
      executeFrontendLexical(fixture.source, policy),
      normalizeLexicalOracle(fixture.source, policy.rawOpenerTypes, policy),
      fixture.id,
    );
  }
  return { fixtures: fixtures.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendLexicalCheck();
  process.stdout.write(`KERN frontend lexical checkpoint shadow: ${result.fixtures} parity cases passed.\n`);
}
