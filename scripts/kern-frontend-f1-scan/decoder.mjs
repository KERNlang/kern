import { readFileSync } from 'node:fs';

import { parseTape } from '../kern-frontend-f1/transport-contract.mjs';

const UINT = /^(?:0|[1-9][0-9]*)$/u;
const FAILURE_CODES = new Set([
  'FORCED_LATE_FAILURE',
  'ILL_FORMED_SOURCE',
  'SOURCE_LIMIT',
  'TRANSPORT_LIMIT',
  'UNCLOSED_EXPR',
  'UNCLOSED_STRING',
  'UNCLOSED_STYLE',
  'UNEXPECTED_TOKEN',
]);

export function fail(message) {
  throw new Error(`F1 scan contract: ${message}`);
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) fail(`${label} keys`);
}

function positiveSafe(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(label);
}

function canonicalUnsigned(value, label) {
  if (!UINT.test(value)) fail(label);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(label);
  return parsed;
}

export function loadPolicy() {
  const policy = JSON.parse(readFileSync(new URL('./policy.json', import.meta.url), 'utf8'));
  exactKeys(
    policy,
    ['format', 'resultFormat', 'modules', 'moduleSha256', 'kindIds', 'flags', 'profileLimits', 'runtimeLimits', 'scheduler'],
    'policy',
  );
  if (policy.format !== 'kern.frontend.f1-scan-policy.1') fail('policy format');
  if (policy.resultFormat !== 'kern.frontend.f1-scan.1') fail('result format');
  if (!Array.isArray(policy.modules) || policy.modules.length !== 4 || new Set(policy.modules).size !== 4) {
    fail('module list');
  }
  exactKeys(policy.moduleSha256, policy.modules, 'module digests');
  for (const [path, digest] of Object.entries(policy.moduleSha256)) {
    if (!/^[0-9a-f]{64}$/u.test(digest) || !policy.modules.includes(path)) fail('module digest');
  }
  const kinds = [
    'identifier', 'number', 'equals', 'slash', 'comma', 'quoted', 'expr', 'style',
    'themeRef', 'unknown', 'whitespace', 'newline', 'comment', 'fenceMarker', 'fenceBody',
  ];
  exactKeys(policy.kindIds, kinds, 'kind ids');
  kinds.forEach((kind, index) => {
    if (policy.kindIds[kind] !== index) fail(`kind id ${kind}`);
  });
  exactKeys(policy.flags, ['opener', 'closer', 'continuation'], 'flags');
  if (policy.flags.opener !== 1 || policy.flags.closer !== 2 || policy.flags.continuation !== 4) fail('flags');
  exactKeys(
    policy.profileLimits,
    [
      'encodedEnvelopeOverheadBytes', 'expectedEvents', 'maxChunkScalars', 'maxChunks', 'maxElapsedMs',
      'maxEncodedBytes', 'maxJsonContentBytes', 'maxPeakRssBytes', 'maxRetainedTransportBytes',
      'maxSourceScalars', 'maxTapeScalars', 'maxTapeUtf8Bytes', 'recordsPerChunk', 'scalingMultiplier',
      'scalingSlackMs',
    ],
    'profile limits',
  );
  for (const [key, value] of Object.entries(policy.profileLimits)) {
    if (key === 'expectedEvents' || key === 'scalingSlackMs') {
      if (!Number.isSafeInteger(value) || value < 0) fail(`profile limit ${key}`);
    } else positiveSafe(value, `profile limit ${key}`);
  }
  exactKeys(
    policy.runtimeLimits,
    ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes'],
    'runtime limits',
  );
  for (const [key, value] of Object.entries(policy.runtimeLimits)) positiveSafe(value, `runtime limit ${key}`);
  exactKeys(policy.scheduler, ['timeoutMs'], 'scheduler');
  positiveSafe(policy.scheduler.timeoutMs, 'scheduler timeout');
  const limits = policy.profileLimits;
  if (limits.recordsPerChunk * limits.maxChunks !== limits.maxSourceScalars) fail('chunk geometry');
  if (policy.runtimeLimits.maxBytes !== limits.maxEncodedBytes) fail('encoded runtime limit');
  if (policy.runtimeLimits.maxStringBytes !== limits.maxTapeUtf8Bytes) fail('string runtime limit');
  return policy;
}

function takeFrame(payload, state, marker, label) {
  if (payload[state.cursor] !== marker) fail(`${label} marker`);
  state.cursor += 1;
  let digits = '';
  while (state.cursor < payload.length && payload[state.cursor] !== ':') {
    digits += payload[state.cursor];
    state.cursor += 1;
  }
  if (payload[state.cursor] !== ':') fail(`${label} length boundary`);
  state.cursor += 1;
  const length = canonicalUnsigned(digits, `${label} length`);
  const value = Array.from(payload).slice(state.cursor, state.cursor + length).join('');
  if (Array.from(value).length !== length) fail(`${label} payload boundary`);
  state.cursor += length;
  return value;
}

export function decodeFailure(payload) {
  const state = { cursor: 0 };
  const code = takeFrame(payload, state, 'C', 'failure code');
  const start = canonicalUnsigned(takeFrame(payload, state, 'S', 'failure start'), 'failure start');
  const end = canonicalUnsigned(takeFrame(payload, state, 'E', 'failure end'), 'failure end');
  if (state.cursor !== Array.from(payload).length) fail('failure trailing payload');
  if (!FAILURE_CODES.has(code) || end < start) fail('failure disposition');
  return { code, endScalar: end, startScalar: start };
}

function validateRole(record, policy, state) {
  const kindCode = canonicalUnsigned(record.kind, 'record kind code');
  const kindId = Math.floor(kindCode / 8);
  const flags = kindCode % 8;
  const kind = Object.keys(policy.kindIds)[kindId];
  if (kind === undefined || flags < 0 || flags > 7) fail('record kind code');
  const expectedClass = kindId <= policy.kindIds.unknown ? 'token' : 'trivia';
  if (record.className !== expectedClass) fail('record class/kind disagreement');
  const ordinary = !['quoted', 'expr', 'style', 'fenceMarker', 'fenceBody'].includes(kind);
  if (ordinary && flags !== 0) fail('ordinary record flags');
  if (kind === 'style' && flags !== 3) fail('style flags');
  if (kind === 'fenceBody' && flags !== 4) fail('fence body flags');
  if (kind === 'fenceMarker') {
    if (flags === 1) {
      if (state.mode !== null) fail('nested fence opener');
      state.mode = 'fence';
    } else if (flags === 2) {
      if (state.mode !== 'fence') fail('orphan fence closer');
      state.mode = null;
    } else fail('fence marker flags');
  }
  if (kind === 'quoted' || kind === 'expr') {
    if (flags === 3) {
      if (state.mode !== null) fail('closed composite inside open mode');
    } else if (flags === 1) {
      if (state.mode !== null) fail('nested composite opener');
      state.mode = kind;
    } else if (flags === 4) {
      if (state.mode !== kind) fail('orphan continuation');
    } else if (flags === 6) {
      if (state.mode !== kind) fail('orphan closer');
      state.mode = null;
    } else fail('composite flags');
  }
  if (state.mode === 'fence' && !['fenceMarker', 'fenceBody', 'newline', 'whitespace'].includes(kind)) {
    fail('non-fence record inside fence');
  }
  if (kind === 'newline' && record.raw !== '\n' && record.raw !== '\r\n') fail('newline raw');
  return { ...record, flags, kind, kindCode, kindId };
}

export function decodeScan(fields, source, policy = loadPolicy()) {
  if (!Array.isArray(fields) || fields.length !== 9 || fields.some((field) => typeof field !== 'string')) {
    fail('result shape');
  }
  if (fields[0] !== policy.resultFormat) fail('result format');
  const sourceScalars = Array.from(source).length;
  if (canonicalUnsigned(fields[3], 'source count') !== sourceScalars) fail('source count');
  if (fields[1] === 'failure') {
    if (fields[4] !== '0' || fields[5] !== '0' || fields[6] !== '0' || fields[7] !== '' || fields[8] !== 'failure') {
      fail('failure atomicity');
    }
    return { diagnostic: decodeFailure(fields[2]), records: [], sourceScalars, status: 'failure' };
  }
  if (fields[1] !== 'scanned' || fields[2] !== '') fail('success status');
  const expectedRecords = canonicalUnsigned(fields[4], 'record count');
  const expectedChunks = canonicalUnsigned(fields[5], 'chunk count');
  const maxGuestListLength = canonicalUnsigned(fields[6], 'list length');
  const chunks = parseTape(fields[7]);
  if (chunks.length !== expectedChunks || maxGuestListLength > policy.profileLimits.recordsPerChunk) fail('chunk result');
  const rawRecords = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (chunk.ordinal !== chunkIndex || chunk.firstRecord !== rawRecords.length || chunk.count !== chunk.records.length) {
      fail('chunk order');
    }
    rawRecords.push(...chunk.records);
  }
  if (rawRecords.length !== expectedRecords) fail('record count');
  const roleState = { mode: null };
  const records = rawRecords.map((record, index) => {
    if (record.ordinal !== index || record.startScalar !== (index === 0 ? 0 : rawRecords[index - 1].endScalar)) {
      fail('record order/span');
    }
    if (record.endScalar <= record.startScalar) fail('record width');
    const expectedRaw = Array.from(source).slice(record.startScalar, record.endScalar).join('');
    if (record.raw !== expectedRaw) fail('record source slice');
    return validateRole(record, policy, roleState);
  });
  if (roleState.mode !== null) fail('open terminal lexical state');
  if ((records.at(-1)?.endScalar ?? 0) !== sourceScalars) fail('source partition');
  if (records.map((record) => record.raw).join('') !== source) fail('source reconstruction');
  if (fields[8] !== `eof:${sourceScalars}:${records.length}:${chunks.length}:closed`) fail('success seal');
  return { chunks, maxGuestListLength, records, sourceScalars, status: 'scanned' };
}
