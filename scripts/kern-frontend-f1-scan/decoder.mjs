import { readFileSync } from 'node:fs';
import { parseTape } from '../kern-frontend-f1/transport-contract.mjs';

import { validateFailureDisposition, validateSuccessGeometry, validateSuccessSource, validateTapePreflight } from './receipt-validator.mjs';

const UINT = /^(?:0|[1-9][0-9]*)$/u;
const IDENTIFIER = /^(?:[A-Za-z_][A-Za-z0-9_-]*|evolved:[A-Za-z_][A-Za-z0-9_-]*)$/u;
const NUMBER = /^(?:(?:0[xX][0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*)n?|(?:[0-9](?:_?[0-9])*(?:\.[0-9](?:_?[0-9])*)?|\.[0-9](?:_?[0-9])*)n?)$/u;
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

function identifierStart(point) {
  return /^[A-Za-z_]$/u.test(point);
}

function identifierPart(point) {
  return /^[A-Za-z0-9_-]$/u.test(point);
}

function numericDigit(point, mode) {
  if (mode === 1) return /^[0-9A-Fa-f]$/u.test(point);
  if (mode === 2) return point === '0' || point === '1';
  if (mode === 3) return /^[0-7]$/u.test(point);
  return /^[0-9]$/u.test(point);
}

function consumeNumericDigits(points, start, mode) {
  let cursor = start;
  let started = false;
  let lastUnderscore = false;
  while (cursor < points.length) {
    if (numericDigit(points[cursor], mode)) {
      started = true;
      lastUnderscore = false;
      cursor += 1;
      continue;
    }
    if (
      points[cursor] === '_' &&
      started &&
      !lastUnderscore &&
      numericDigit(points[cursor + 1] ?? '', mode)
    ) {
      lastUnderscore = true;
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

function numericEnd(points, start) {
  let cursor = start;
  if (points[cursor] === '0' && cursor + 2 < points.length) {
    const mode = points[cursor + 1] === 'x' || points[cursor + 1] === 'X'
      ? 1
      : points[cursor + 1] === 'b' || points[cursor + 1] === 'B'
        ? 2
        : points[cursor + 1] === 'o' || points[cursor + 1] === 'O'
          ? 3
          : 0;
    if (mode > 0) {
      const baseEnd = consumeNumericDigits(points, cursor + 2, mode);
      if (baseEnd > cursor + 2) return points[baseEnd] === 'n' ? baseEnd + 1 : baseEnd;
    }
  }
  if (points[cursor] === '.') cursor += 1;
  cursor = consumeNumericDigits(points, cursor, 0);
  if (points[cursor] === '.' && numericDigit(points[cursor + 1] ?? '', 0)) {
    cursor = consumeNumericDigits(points, cursor + 1, 0);
  }
  return points[cursor] === 'n' ? cursor + 1 : cursor;
}

function validateQuotedRaw(record, flags, state) {
  const points = Array.from(record.raw);
  let cursor = 0;
  let quoteChar = state.quoteChar;
  if ((flags & 1) !== 0) {
    quoteChar = points[0];
    if (quoteChar !== '"' && quoteChar !== "'") fail('quoted opener raw');
    cursor = 1;
  }
  if (quoteChar !== '"' && quoteChar !== "'") fail('quoted state');
  let closed = false;
  while (cursor < points.length) {
    const point = points[cursor];
    if (point === '\\' && cursor + 1 < points.length) {
      cursor += 2;
      continue;
    }
    if (point === quoteChar) {
      if (cursor !== points.length - 1) fail('quoted trailing raw');
      closed = true;
    }
    cursor += 1;
  }
  if (closed !== ((flags & 2) !== 0)) fail('quoted closer raw');
  state.quoteChar = closed ? null : quoteChar;
}

function validateExpressionRaw(record, flags, state) {
  const points = Array.from(record.raw);
  let cursor = 0;
  let depth = state.exprDepth;
  let quote = state.exprQuote;
  if ((flags & 1) !== 0) {
    if (points[0] !== '{' || points[1] !== '{') fail('expression opener raw');
    depth = 1;
    quote = null;
    cursor = 2;
  }
  if (!Number.isSafeInteger(depth) || depth <= 0) fail('expression state');
  let closed = false;
  while (cursor < points.length) {
    const point = points[cursor];
    const next = points[cursor + 1];
    if (quote !== null) {
      if (point === '\\' && cursor + 1 < points.length) {
        cursor += 2;
        continue;
      }
      if (point === quote) quote = null;
      cursor += 1;
      continue;
    }
    if (point === '"' || point === "'") {
      quote = point;
      cursor += 1;
      continue;
    }
    if (point === '{' && next === '{') {
      depth += 1;
      cursor += 2;
      continue;
    }
    if (point === '}' && next === '}') {
      depth -= 1;
      cursor += 2;
      if (depth === 0) {
        if (cursor !== points.length) fail('expression trailing raw');
        closed = true;
      }
      continue;
    }
    cursor += 1;
  }
  if (closed !== ((flags & 2) !== 0) || (!closed && depth <= 0)) fail('expression closer raw');
  state.exprDepth = closed ? 0 : depth;
  state.exprQuote = closed ? null : quote;
}

function validateStyleRaw(raw) {
  const points = Array.from(raw);
  if (raw.startsWith('{{')) fail('style/expression precedence');
  if (points[0] !== '{' || points.at(-1) !== '}') fail('style boundary raw');
  let quoted = false;
  for (let cursor = 1; cursor < points.length; cursor += 1) {
    const point = points[cursor];
    if (point === '\\' && quoted && cursor + 1 < points.length) {
      cursor += 1;
      continue;
    }
    if (point === '"') quoted = !quoted;
    if (point === '}' && !quoted && cursor !== points.length - 1) fail('style trailing raw');
  }
  if (quoted) fail('style quote raw');
}

function validateSimpleRaw(record, kind, flags, state, sourcePoints) {
  const { raw } = record;
  const previous = sourcePoints[record.startScalar - 1] ?? '';
  const next = sourcePoints[record.endScalar] ?? '';
  if (kind === 'identifier') {
    if (!IDENTIFIER.test(raw) || identifierPart(next)) fail('identifier raw');
    if (raw === 'evolved' && next === ':' && identifierStart(sourcePoints[record.endScalar + 1] ?? '')) {
      fail('evolved identifier raw');
    }
  } else if (kind === 'number') {
    if (!NUMBER.test(raw) || numericEnd(sourcePoints, record.startScalar) !== record.endScalar) fail('number raw');
  } else if (kind === 'equals') {
    if (raw !== '=') fail('equals raw');
  } else if (kind === 'slash') {
    const gated = record.startScalar === 0 || previous === ' ' || previous === '\t' || previous === '\n';
    if (
      !/^\/[^\t \r\n{$]*$/u.test(raw) ||
      (next !== '' && !/^[\t \r\n{$]$/u.test(next)) ||
      (raw.startsWith('//') && gated)
    ) fail('slash raw');
  } else if (kind === 'comma') {
    if (raw !== ',') fail('comma raw');
  } else if (kind === 'quoted') {
    validateQuotedRaw(record, flags, state);
  } else if (kind === 'expr') {
    validateExpressionRaw(record, flags, state);
  } else if (kind === 'style') {
    validateStyleRaw(raw);
  } else if (kind === 'themeRef') {
    if (!/^\$[A-Za-z_][A-Za-z0-9_-]*$/u.test(raw) || identifierPart(next)) fail('theme reference raw');
  } else if (kind === 'unknown') {
    const points = Array.from(raw);
    const nextTwo = `${next}${sourcePoints[record.endScalar + 1] ?? ''}`;
    if (points.length !== 1) fail('unknown raw width');
    const point = points[0];
    const previousGatesComment = record.startScalar === 0 || previous === ' ' || previous === '\t' || previous === '\n';
    if (
      point === '\n' || (point === '\r' && next === '\n') || identifierStart(point) || /^[0-9]$/u.test(point) || point === ' ' || point === '\t' ||
      point === '"' || point === "'" || point === '{' || point === '=' || point === ',' || point === '/' ||
      (point === '.' && /^[0-9]$/u.test(next)) || (point === '$' && identifierStart(next)) ||
      (point === '<' && nextTwo === '<<') || (point === '>' && nextTwo === '>>') ||
      (point === '#' && previousGatesComment)
    ) fail('unknown raw');
  } else if (kind === 'whitespace') {
    if (!/^[ \t]+$/u.test(raw) || next === ' ' || next === '\t') fail('whitespace raw');
  } else if (kind === 'comment') {
    const gated = record.startScalar === 0 || previous === ' ' || previous === '\t' || previous === '\n';
    if ((!raw.startsWith('#') && !raw.startsWith('//')) || !gated || (next !== '' && next !== '\r' && next !== '\n')) {
      fail('comment raw');
    }
  } else if (kind === 'fenceMarker') {
    if ((flags === 1 && raw !== '<<<') || (flags === 2 && raw !== '>>>')) fail('fence marker raw');
  } else if (kind === 'fenceBody') {
    const nextThree = sourcePoints.slice(record.endScalar, record.endScalar + 3).join('');
    if (
      raw.length === 0 ||
      (state.fenceInline && raw.includes('>>>')) ||
      (!state.fenceInline && state.lineStart && /^[ \t]*>>>/u.test(raw)) ||
      (next !== '' && next !== '\r' && next !== '\n' && !(state.fenceInline && nextThree === '>>>'))
    ) {
      fail('fence body raw');
    }
  }
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
    ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxIterations', 'maxStringBytes'],
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

function validateRole(record, policy, state, sourcePoints) {
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
  const modeBefore = state.mode;
  if (kind === 'fenceBody' && modeBefore !== 'fence') fail('orphan fence body');
  if (modeBefore === 'quoted') {
    const admitted =
      (kind === 'quoted' && (flags === 4 || flags === 6)) ||
      kind === 'newline' ||
      (kind === 'unknown' && record.raw === '\r');
    if (!admitted) fail('non-quote record inside quote');
  } else if (modeBefore === 'expr') {
    const admitted =
      (kind === 'expr' && (flags === 4 || flags === 6)) ||
      kind === 'newline' ||
      (kind === 'unknown' && record.raw === '\r');
    if (!admitted) fail('non-expression record inside expression');
  } else if (modeBefore === 'fence') {
    const admitted =
      (kind === 'fenceMarker' && flags === 2) ||
      kind === 'fenceBody' ||
      kind === 'newline' ||
      kind === 'whitespace' ||
      (kind === 'unknown' && record.raw === '\r');
    if (!admitted) fail('non-fence record inside fence');
    if (
      kind === 'whitespace' &&
      (state.fenceInline || !state.lineStart || sourcePoints.slice(record.endScalar, record.endScalar + 3).join('') !== '>>>')
    ) fail('fence indentation raw');
  }
  if (kind === 'fenceMarker') {
    if (flags === 1) {
      if (modeBefore !== null) fail('nested fence opener');
    } else if (flags === 2) {
      if (modeBefore !== null && modeBefore !== 'fence') fail('fence closer state');
      if (modeBefore === 'fence' && !state.fenceInline && !state.lineStart) fail('fence closer placement');
    } else fail('fence marker flags');
  }
  if (kind === 'quoted' || kind === 'expr') {
    if (flags === 3) {
      if (modeBefore !== null) fail('closed composite inside open mode');
    } else if (flags === 1) {
      if (modeBefore !== null) fail('nested composite opener');
    } else if (flags === 4) {
      if (modeBefore !== kind) fail('orphan continuation');
    } else if (flags === 6) {
      if (modeBefore !== kind) fail('orphan closer');
    } else fail('composite flags');
  }
  if (kind === 'newline') {
    if (record.raw !== '\n' && record.raw !== '\r\n') fail('newline raw');
  } else if (record.raw.includes('\n')) {
    fail('non-newline raw contains physical terminator');
  } else if (record.raw.includes('\r') && (kind !== 'unknown' || record.raw !== '\r')) {
    fail('lone CR disposition');
  }
  if (kind === 'quoted' || kind === 'expr') {
    if ((flags === 1 || flags === 4) && !['\r', '\n'].includes(sourcePoints[record.endScalar] ?? '')) {
      fail('composite segment boundary');
    }
    if (flags === 4 || flags === 6) {
      const previousIsBoundary =
        state.previousRecord?.kind === 'newline' ||
        (state.previousRecord?.kind === 'unknown' && state.previousRecord.raw === '\r');
      if (!previousIsBoundary) fail('composite continuation boundary');
    }
  }
  validateSimpleRaw(record, kind, flags, state, sourcePoints);
  if (kind === 'fenceMarker' && flags === 1) {
    state.mode = 'fence';
    state.fenceInline = true;
  } else if (kind === 'fenceMarker' && flags === 2 && modeBefore === 'fence') {
    state.mode = null;
    state.fenceInline = false;
  } else if ((kind === 'quoted' || kind === 'expr') && flags === 1) {
    state.mode = kind;
  } else if ((kind === 'quoted' || kind === 'expr') && flags === 6) {
    state.mode = null;
  }
  if (kind === 'newline') {
    state.lineStart = true;
    if (state.mode === 'fence') state.fenceInline = false;
  } else if (!(kind === 'whitespace' && state.lineStart)) {
    state.lineStart = false;
  }
  const decoded = { ...record, flags, kind, kindCode, kindId };
  state.previousRecord = decoded;
  return decoded;
}

export function decodeScan(fields, source, policy = loadPolicy(), options = {}) {
  if (!Array.isArray(fields) || fields.length !== 9 || fields.some((field) => typeof field !== 'string')) {
    fail('result shape');
  }
  if (fields[0] !== policy.resultFormat) fail('result format');
  const sourceCodePoints = Array.from(source);
  const sourceScalars = sourceCodePoints.length;
  if (canonicalUnsigned(fields[3], 'source count') !== sourceScalars) fail('source count');
  if (fields[1] === 'failure') {
    if (fields[4] !== '0' || fields[5] !== '0' || fields[6] !== '0' || fields[7] !== '' || fields[8] !== 'failure') {
      fail('failure atomicity');
    }
    const diagnostic = decodeFailure(fields[2]);
    validateFailureDisposition(diagnostic, source, sourceScalars, policy, options, fail);
    return { diagnostic, records: [], sourceScalars, status: 'failure' };
  }
  if (fields[1] !== 'scanned' || fields[2] !== '') fail('success status');
  validateSuccessSource(source, sourceScalars, policy, fail);
  const expectedRecords = canonicalUnsigned(fields[4], 'record count');
  const expectedChunks = canonicalUnsigned(fields[5], 'chunk count');
  const maxGuestListLength = canonicalUnsigned(fields[6], 'list length');
  validateTapePreflight(fields[7], policy, fail);
  const chunks = parseTape(fields[7]);
  validateSuccessGeometry({ chunks, expectedChunks, expectedRecords, maxGuestListLength }, policy, fail);
  const rawRecords = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (chunk.ordinal !== chunkIndex || chunk.firstRecord !== rawRecords.length || chunk.count !== chunk.records.length) {
      fail('chunk order');
    }
    rawRecords.push(...chunk.records);
  }
  if (rawRecords.length !== expectedRecords) fail('record count');
  const roleState = {
    exprDepth: 0,
    exprQuote: null,
    fenceInline: false,
    lineStart: true,
    mode: null,
    previousRecord: null,
    quoteChar: null,
  };
  const records = rawRecords.map((record, index) => {
    if (record.ordinal !== index || record.startScalar !== (index === 0 ? 0 : rawRecords[index - 1].endScalar)) {
      fail('record order/span');
    }
    if (record.endScalar <= record.startScalar) fail('record width');
    const expectedRaw = sourceCodePoints.slice(record.startScalar, record.endScalar).join('');
    if (record.raw !== expectedRaw) fail('record source slice');
    return validateRole(record, policy, roleState, sourceCodePoints);
  });
  if (roleState.mode !== null) fail('open terminal lexical state');
  if ((records.at(-1)?.endScalar ?? 0) !== sourceScalars) fail('source partition');
  if (records.map((record) => record.raw).join('') !== source) fail('source reconstruction');
  if (fields[8] !== `eof:${sourceScalars}:${records.length}:${chunks.length}:closed`) fail('success seal');
  return { chunks, maxGuestListLength, records, sourceScalars, status: 'scanned' };
}
