#!/usr/bin/env node
import assert from 'node:assert/strict';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createParseState } from '../packages/core/dist/parser-diagnostics.js';
import { tokenizeLineInternal } from '../packages/core/dist/parser-tokenizer.js';
import {
  executeKernRuntimeHandlerSync,
  KERN_RUNTIME_HANDLER_ABI,
} from '../packages/core/dist/runtime-handler.js';
import {
  EXCLUDED_FIXTURES,
  generatedParitySources,
  PARITY_FIXTURES,
} from './kern-frontend-tokenizer/fixtures.mjs';
import {
  loadFrontendTokenizerPolicy,
  resolveFrontendTokenizerCorpusPath,
} from './kern-frontend-tokenizer/policy.mjs';

const SOURCE_URLS = [
  new URL('../examples/kern-frontend/tokenizer-helpers.kern', import.meta.url),
  new URL('../examples/kern-frontend/tokenizer.kern', import.meta.url),
];
const TOKENIZER_DIAGNOSTICS = new Set([
  'INVALID_BIGINT',
  'UNCLOSED_EXPR',
  'UNCLOSED_STRING',
  'UNCLOSED_STYLE',
]);
const TOKEN_KINDS = new Set([
  'comma',
  'equals',
  'expr',
  'identifier',
  'number',
  'quoted',
  'slash',
  'style',
  'themeRef',
  'unknown',
  'whitespace',
]);
const FAILURE_CODES = new Set([
  'CODE_POINTS_LIMIT',
  'DIAGNOSTIC_LIMIT',
  'INVALID_LIMITS',
  'RECORD_LIMIT',
  'TOKEN_LIMIT',
  'UNSUPPORTED_UNKNOWN',
]);

function fail(category, detail) {
  throw new Error(`${category}: ${detail}`);
}

function readRegularSource(url) {
  const path = typeof url === 'string' ? url : fileURLToPath(url);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail('source containment', `${path} must be a regular file`);
  const source = readFileSync(path, 'utf8');
  if (source.includes('\r')) fail('source containment', `${path} must use LF line endings`);
  return source;
}

export function corpusLines(policy, repositoryRoot) {
  const lines = [];
  for (const entry of policy.corpus) {
    const path = resolveFrontendTokenizerCorpusPath(entry.path, repositoryRoot);
    const maxFileBytes = entry.maxLines * (policy.profileLimits.maxSourceBytes + 1);
    if (!Number.isSafeInteger(maxFileBytes) || lstatSync(path).size > maxFileBytes) {
      fail('corpus rejection', `${entry.path} exceeds its derived file byte ceiling`);
    }
    const source = readRegularSource(path);
    const available = source.split('\n');
    if (available.length < entry.maxLines) {
      fail('corpus rejection', `${entry.path} supplies fewer than ${entry.maxLines} lines`);
    }
    const selected = available.slice(0, entry.maxLines);
    for (const rawLine of selected) {
      const line = rawLine.replace(/^[\t ]+/u, '');
      if (byteOffset(line) > policy.profileLimits.maxSourceBytes) {
        fail('corpus rejection', `${entry.path} contains a selected line above maxSourceBytes`);
      }
      lines.push(line);
    }
  }
  return lines;
}

export function validateNativeTokenizerSource(source) {
  for (const forbidden of ['tokenizeLineInternal', 'parseDocument', 'executeKernRuntimeHandler', 'capability']) {
    if (source.includes(forbidden)) fail('delegation rejection', `KERN source contains ${forbidden}`);
  }
  const handlerDeclarations = [...source.matchAll(/^[\t ]*handler\b([^\r\n]*)$/gmu)];
  if (
    handlerDeclarations.length === 0 ||
    handlerDeclarations.some((match) => !/^[\t ]+lang="kern"[\t ]*$/u.test(match[1]))
  ) {
    fail('delegation rejection', 'every source handler must be native KERN');
  }
  return source;
}

export function loadTokenizerSource() {
  return validateNativeTokenizerSource(SOURCE_URLS.map(readRegularSource).join('\n\n'));
}

function wellFormedUtf16(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function byteOffset(prefix) {
  return Buffer.byteLength(prefix, 'utf8');
}

export function normalizeBootstrap(source) {
  const state = createParseState();
  const tokens = tokenizeLineInternal(source, state, 'line').map((token) => ({
    kind: token.kind,
    startByte: byteOffset(source.slice(0, token.pos)),
    value: token.value,
  }));
  const diagnostics = state.diagnostics
    .filter((diagnostic) => TOKENIZER_DIAGNOSTICS.has(diagnostic.code))
    .map((diagnostic) => ({
      code: diagnostic.code,
      colByte: byteOffset(source.slice(0, diagnostic.col - 1)) + 1,
      endColByte: byteOffset(source.slice(0, diagnostic.endCol - 1)) + 1,
    }));
  return { diagnostics, tokens };
}

function isScalarSafeParityLine(source) {
  return normalizeBootstrap(source).tokens.every((token) => (
    wellFormedUtf16(token.value) &&
    (token.kind !== 'unknown' || [...token.value].every((character) => character.codePointAt(0) <= 0x7f))
  ));
}

export function validateScalarSafeCorpus(lines) {
  const rejected = lines.filter((line) => !isScalarSafeParityLine(line));
  if (rejected.length > 0) {
    fail('corpus rejection', rejected.length + ' policy-selected lines are outside the scalar-safe profile');
  }
  return lines;
}

function hasMalformedBootstrapTokenSlice(source) {
  return normalizeBootstrap(source).tokens.some(
    (token) => token.kind !== 'unknown' && !wellFormedUtf16(token.value),
  );
}

function failure(code, detail = '') {
  return { code, detail, status: 'failure' };
}

function parseFlatResult(source, value, policy, metrics) {
  if (value.tag !== 'list') fail('runtime rejection', 'handler result must be a list');
  const fields = value.value.map((entry, index) => {
    if (entry.tag !== 'text') fail('runtime rejection', `result field ${index} must be text`);
    return entry.value;
  });
  if (fields[0] !== policy.format || (fields.length - 1) % 4 !== 0) {
    fail('record rejection', 'invalid flat envelope');
  }

  const tokens = [];
  const diagnostics = [];
  let parsedFailure;
  let startCursor = 0;
  let startByte = 0;
  let sealed = false;
  for (let index = 1; index < fields.length; index += 4) {
    const [tag, first, second, third] = fields.slice(index, index + 4);
    if (tag === 'failure') {
      if (fields.length !== 5) fail('record rejection', 'failure must be the only record');
      if (!FAILURE_CODES.has(first) || third !== '') fail('record rejection', 'invalid failure record');
      parsedFailure = failure(first, second);
      continue;
    }
    if (sealed) fail('record rejection', 'records cannot follow the terminal seal');
    if (tag === 'seal') {
      if (index !== fields.length - 4 || second !== '' || third !== '') {
        fail('record rejection', 'seal must be unique and terminal');
      }
      if (!source.startsWith(first, startCursor) || startCursor + first.length !== source.length) {
        fail('record rejection', 'seal does not cover the remaining source');
      }
      startCursor = source.length;
      startByte += byteOffset(first);
      sealed = true;
      continue;
    }
    const startDelta = tag === 'token' ? third : second;
    if (!source.startsWith(startDelta, startCursor)) {
      fail('record rejection', 'record start delta does not match the source cursor');
    }
    startCursor += startDelta.length;
    startByte += byteOffset(startDelta);
    if (tag === 'token') {
      if (!TOKEN_KINDS.has(first)) fail('record rejection', `unknown token kind ${first}`);
      tokens.push({ kind: first, value: second, startByte });
      continue;
    }
    if (tag === 'diagnostic') {
      if (!TOKENIZER_DIAGNOSTICS.has(first)) fail('record rejection', `unknown diagnostic code ${first}`);
      if (!source.startsWith(third, startCursor)) fail('record rejection', 'diagnostic end span does not match');
      diagnostics.push({ code: first, colByte: startByte + 1, endColByte: startByte + byteOffset(third) + 1 });
      continue;
    }
    fail('record rejection', `unknown record ${tag}`);
  }
  if (parsedFailure === undefined && !sealed) fail('record rejection', 'successful result requires a terminal seal');
  if (tokens.length > policy.profileLimits.maxTokens) fail('record rejection', 'token count exceeds policy');
  if (diagnostics.length > policy.profileLimits.maxDiagnostics) fail('record rejection', 'diagnostic count exceeds policy');
  if (tokens.length + diagnostics.length > policy.profileLimits.maxRecords) {
    fail('record rejection', 'record count exceeds policy');
  }
  if (metrics !== undefined) metrics.coveredSourceBytes = startByte;
  return parsedFailure ?? { diagnostics, status: 'success', tokens };
}

export function executeTokenizer(
  source,
  policy = loadFrontendTokenizerPolicy(),
  kernSource = loadTokenizerSource(),
  metrics,
) {
  if (!wellFormedUtf16(source)) return failure('MALFORMED_UTF16');
  if (byteOffset(source) > policy.profileLimits.maxSourceBytes) return failure('SOURCE_BYTES_LIMIT');
  if (hasMalformedBootstrapTokenSlice(source)) return failure('UNSUPPORTED_UTF16_SLICE');
  const limits = policy.profileLimits;
  const envelope = executeKernRuntimeHandlerSync(
    {
      abi: KERN_RUNTIME_HANDLER_ABI,
      arguments: [
        source,
        limits.maxCodePoints,
        limits.maxTokens,
        limits.maxDiagnostics,
        limits.maxRecords,
      ],
      identity: { handlerName: 'tokenizeline', sourcePath: 'examples/kern-frontend/tokenizer.kern' },
      source: kernSource,
    },
    { enabled: true, limits: policy.runtimeLimits },
  );
  const outputJsonBytes = byteOffset(`${JSON.stringify(envelope)}\n`);
  if (metrics !== undefined) metrics.outputJsonBytes = outputJsonBytes;
  if (outputJsonBytes > policy.profileLimits.maxOutputJsonBytes) {
    fail('runtime rejection', 'OUTPUT_JSON_BYTES_LIMIT');
  }
  if (
    envelope.outcome !== 'success' ||
    envelope.completion.kind !== 'return' ||
    envelope.events.length !== 0 ||
    envelope.result.presence !== 'value'
  ) {
    const detail = envelope.diagnostics[0]?.code ?? envelope.outcome;
    fail('runtime rejection', `${detail} ${JSON.stringify(envelope.diagnostics)}`);
  }
  return parseFlatResult(source, envelope.result.value, policy, metrics);
}

export function runKernFrontendTokenizerCheck() {
  const policy = loadFrontendTokenizerPolicy();
  const source = loadTokenizerSource();
  const committedCorpus = validateScalarSafeCorpus(corpusLines(policy));
  if (committedCorpus.length === 0) fail('corpus rejection', 'policy selected no scalar-safe committed lines');
  const paritySources = [
    ...PARITY_FIXTURES.map((fixture) => fixture.source),
    ...generatedParitySources(policy.generated.maxCases),
    ...committedCorpus,
  ];
  for (const line of paritySources) {
    const actual = executeTokenizer(line, policy, source);
    assert.equal(actual.status, 'success', JSON.stringify({ actual, line }));
    assert.deepEqual(actual, { ...normalizeBootstrap(line), status: 'success' }, line);
  }
  for (const fixture of EXCLUDED_FIXTURES) {
    assert.deepEqual(executeTokenizer(fixture.source, policy, source), failure(fixture.code), fixture.id);
  }

  const tokenPolicy = structuredClone(policy);
  tokenPolicy.profileLimits.maxTokens = 1;
  assert.equal(executeTokenizer('a', tokenPolicy, source).status, 'success');
  assert.deepEqual(executeTokenizer('a b', tokenPolicy, source), failure('TOKEN_LIMIT'));

  const diagnosticPolicy = structuredClone(policy);
  diagnosticPolicy.profileLimits.maxDiagnostics = 1;
  assert.equal(executeTokenizer('1.2n', diagnosticPolicy, source).status, 'success');
  assert.deepEqual(executeTokenizer('1.2n 2.3n', diagnosticPolicy, source), failure('DIAGNOSTIC_LIMIT'));

  const recordPolicy = structuredClone(policy);
  recordPolicy.profileLimits.maxRecords = 1;
  assert.equal(executeTokenizer('a', recordPolicy, source).status, 'success');
  assert.deepEqual(executeTokenizer('a b', recordPolicy, source), failure('RECORD_LIMIT'));

  const exactCodePoints = 'a'.repeat(policy.profileLimits.maxCodePoints);
  assert.equal(executeTokenizer(exactCodePoints, policy, source).status, 'success');
  assert.deepEqual(
    executeTokenizer(`${exactCodePoints}a`, policy, source),
    failure('CODE_POINTS_LIMIT'),
  );
  const exactBytes = '😀'.repeat((policy.profileLimits.maxSourceBytes - 4) / 4);
  assert.equal(executeTokenizer(`"${exactBytes}aa"`, policy, source).status, 'success');
  assert.deepEqual(executeTokenizer(`"${exactBytes}aa😀"`, policy, source), failure('SOURCE_BYTES_LIMIT'));

  return { bounds: 8, excluded: EXCLUDED_FIXTURES.length, parity: paritySources.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runKernFrontendTokenizerCheck();
  process.stdout.write(
    `KERN frontend tokenizer: ${result.parity} parity, ${result.excluded} fail-closed, and ${result.bounds} boundary cases passed.\n`,
  );
}
