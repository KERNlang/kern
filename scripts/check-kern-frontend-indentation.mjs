#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { executeKernRuntimeHandlerSync, KERN_RUNTIME_HANDLER_ABI } from '../packages/core/dist/runtime-handler.js';
import { loadStitcherSource } from './check-kern-frontend-stitcher.mjs';
import { INDENTATION_FIXTURES } from './kern-frontend-indentation/fixtures.mjs';
import { normalizeIndentationOracle } from './kern-frontend-indentation/oracle.mjs';
import { loadFrontendIndentationPolicy } from './kern-frontend-indentation/policy.mjs';
import { corpusDocuments } from './kern-frontend-stitcher/corpus.mjs';
import { normalizeStitchOracle } from './kern-frontend-stitcher/oracle.mjs';
import { rawProfileArgument } from './kern-frontend-stitcher/policy.mjs';

const INDENTATION_SOURCE_URL = new URL('../examples/kern-frontend/indentation.kern', import.meta.url);
const RELATIONS = new Set(['deeper', 'initial', 'same', 'shallower']);
const FAILURE_CODES = new Set([
  'CODE_POINTS_LIMIT', 'DIAGNOSTIC_LIMIT', 'ENVELOPE_RECORD_LIMIT', 'GROUP_LIMIT',
  'GROUP_RECORD_LIMIT', 'INVALID_LIMITS', 'OBSERVATION_LIMIT', 'PHYSICAL_RECORD_CODE_POINTS_LIMIT',
  'PHYSICAL_RECORD_LIMIT', 'RAW_OPENER_LIMIT', 'RECORD_LIMIT', 'STITCH_DEPTH_LIMIT',
  'TOKEN_LIMIT', 'UNSUPPORTED_LINE_ENDING', 'UNSUPPORTED_UNKNOWN',
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

export function validateNativeIndentationSource(source) {
  for (const forbidden of [
    'executeFrontendStitcher', 'executeKernRuntimeHandler', 'normalizeStitchOracle',
    'parseDocument', 'physicalOracle', 'tokenizeLineInternal',
  ]) {
    if (source.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlers = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (handlers.length === 0 || handlers.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  if (!source.includes('stitchdocument(source, rawProfile,')) {
    fail('composition rejection', 'indentation handler must compose stitchdocument in KERN');
  }
  return source;
}

export function loadIndentationSource() {
  return validateNativeIndentationSource(`${loadStitcherSource()}\n\n${readRegularSource(INDENTATION_SOURCE_URL)}`);
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

export function parseIndentationEnvelope(source, value, policy = loadFrontendIndentationPolicy()) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  const fields = value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
  if (fields[0] !== policy.indentationFormat || (fields.length - 1) % 8 !== 0) {
    fail('record rejection', 'invalid indentation envelope');
  }
  if (fields[1] === 'failure') {
    if (fields.length !== 9 || !FAILURE_CODES.has(fields[2]) || fields.slice(4).some(Boolean)) {
      fail('record rejection', 'invalid failure envelope');
    }
    return failure(fields[2], fields[3]);
  }

  const stitch = normalizeStitchOracle(source, policy.rawOpenerTypes);
  const physicalStartCodeUnits = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n' && index + 1 < source.length) {
      physicalStartCodeUnits.push(index + 1);
    }
  }
  const expectedGroups = stitch.groups
    .map((group, groupIndex) => ({ group, groupIndex }))
    .filter(({ group }) => group.termination === 'complete');
  const observations = [];
  let sealed = false;
  let previousIndentLength;
  for (let offset = 1; offset < fields.length; offset += 8) {
    const record = fields.slice(offset, offset + 8);
    const [tag] = record;
    if (tag === 'seal') {
      if (sealed || offset !== fields.length - 8 || record[1] !== source || record.slice(2).some(Boolean)) {
        fail('record rejection', 'invalid terminal seal');
      }
      sealed = true;
      continue;
    }
    if (sealed || tag !== 'observation') fail('record rejection', `unknown or post-seal record ${tag}`);
    if (observations.length >= policy.maxObservations) fail('record rejection', 'observation limit exceeded');
    const [, rawIndex, rawGroupIndex, rawPhysicalIndex, indentBytes, relation, content, reserved] = record;
    const index = integer(rawIndex, 'observation index');
    const groupIndex = integer(rawGroupIndex, 'group index');
    const firstPhysicalIndex = integer(rawPhysicalIndex, 'physical index');
    if (index !== observations.length || reserved !== '' || !RELATIONS.has(relation)) {
      fail('record rejection', 'invalid observation shape or order');
    }
    const expected = expectedGroups[index];
    if (!expected || groupIndex !== expected.groupIndex || firstPhysicalIndex !== expected.group.physicalIndexes[0]) {
      fail('record rejection', 'observation group or physical identity drift');
    }
    const first = stitch.physical[firstPhysicalIndex];
    const exactIndent = /^[\t ]*/u.exec(first.content)?.[0] ?? '';
    const expectedRelation = previousIndentLength === undefined
      ? 'initial'
      : exactIndent.length === previousIndentLength ? 'same'
        : exactIndent.length > previousIndentLength ? 'deeper' : 'shallower';
    if (indentBytes !== exactIndent || content !== first.content) {
      fail('record rejection', 'indentation or first-record content witness drift');
    }
    if (relation !== expectedRelation) fail('record rejection', 'indentation relation drift');
    observations.push({
      contentEndByte: first.contentEndByte,
      firstContentByte: first.startByte + Buffer.byteLength(indentBytes),
      firstContentCodeUnit: physicalStartCodeUnits[firstPhysicalIndex] + indentBytes.length,
      firstPhysicalIndex,
      firstRecordContent: content,
      groupIndex,
      indentBytes,
      physicalIndexes: [...expected.group.physicalIndexes],
      relation,
      startByte: first.startByte,
    });
    previousIndentLength = exactIndent.length;
  }
  if (!sealed) fail('record rejection', 'missing terminal seal');
  if (observations.length !== expectedGroups.length) fail('record rejection', 'completed group observation coverage drift');
  return { format: policy.indentationFormat, observations };
}

export function executeFrontendIndentation(
  source,
  policy = loadFrontendIndentationPolicy(),
  kernSource = loadIndentationSource(),
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
      limits.maxRawOpeners, policy.maxObservations,
    ],
    identity: { handlerName: 'observeindentation', sourcePath: 'examples/kern-frontend/indentation.kern' },
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
  return parseIndentationEnvelope(source, envelope.result.value, policy);
}

export function runKernFrontendIndentationCheck() {
  const policy = loadFrontendIndentationPolicy();
  const fixtures = [...INDENTATION_FIXTURES, ...corpusDocuments(policy)];
  for (const fixture of fixtures) {
    assert.deepEqual(
      executeFrontendIndentation(fixture.source, policy),
      normalizeIndentationOracle(fixture.source, policy.rawOpenerTypes),
      fixture.id,
    );
  }
  return { fixtures: fixtures.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendIndentationCheck();
  process.stdout.write(`KERN frontend indentation shadow: ${result.fixtures} parity cases passed.\n`);
}
