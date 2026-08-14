import { readFileSync } from 'node:fs';

const UINT = /^(?:0|[1-9][0-9]*)$/u;
export const RESULT_FORMAT = 'kern.frontend.f1-transport-probe.2';
export const RESULT_LENGTH = 9;

export function fail(detail) {
  throw new Error(`F1 transport rejection: ${detail}`);
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be a record`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys changed`);
  }
}

function positiveSafe(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive safe integer`);
}

function canonicalUnsigned(value, label) {
  if (typeof value !== 'string' || !UINT.test(value)) fail(`${label} is not canonical`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) fail(`${label} is unsafe`);
  return parsed;
}

function reserveFloor(value) {
  return Math.floor((value * 6 + 4) / 5);
}

export function calculateWorstGeometry(records, recordsPerChunk) {
  positiveSafe(records, 'geometry records');
  positiveSafe(recordsPerChunk, 'geometry recordsPerChunk');
  let priorChunkBytes = 0;
  let jsonContentBytes = 0;
  let maxChunkScalars = 0;
  let maxInnerRetainedBytes = 0;
  let tapeScalars = 0;
  let tapeUtf8Bytes = 0;
  const chunks = Math.ceil(records / recordsPerChunk);
  for (let chunk = 0; chunk < chunks; chunk += 1) {
    const first = chunk * recordsPerChunk;
    const end = Math.min(records, first + recordsPerChunk);
    let payloadJsonBytes = 0;
    let payloadScalars = 0;
    let payloadUtf8Bytes = 0;
    for (let ordinal = first; ordinal < end; ordinal += 1) {
      const digits = String(ordinal).length;
      const endDigits = String(ordinal + 1).length;
      payloadScalars += 27 + 2 * digits + endDigits;
      payloadUtf8Bytes += 30 + 2 * digits + endDigits;
      payloadJsonBytes += 32 + 2 * digits + endDigits;
    }
    const count = end - first;
    const frame =
      6 +
      2 * String(chunk).length +
      String(first).length +
      String(count).length +
      String(payloadScalars).length;
    const chunkScalars = frame + payloadScalars;
    const chunkUtf8Bytes = frame + payloadUtf8Bytes;
    maxChunkScalars = Math.max(maxChunkScalars, chunkScalars);
    maxInnerRetainedBytes = Math.max(maxInnerRetainedBytes, priorChunkBytes + 9 * payloadUtf8Bytes);
    priorChunkBytes += chunkUtf8Bytes;
    tapeScalars += chunkScalars;
    tapeUtf8Bytes += chunkUtf8Bytes;
    jsonContentBytes += frame + payloadJsonBytes;
  }
  return {
    chunks,
    jsonContentBytes,
    maxChunkScalars,
    maxInnerRetainedBytes,
    records,
    retainedBytes: 9 * tapeUtf8Bytes,
    tapeScalars,
    tapeUtf8Bytes,
  };
}

export function loadPolicy() {
  const policy = JSON.parse(readFileSync(new URL('./transport-policy.json', import.meta.url), 'utf8'));
  exactKeys(policy, ['format', 'geometry', 'profileLimits', 'runtimeLimits', 'scheduler'], 'policy');
  if (policy.format !== 'kern.frontend.f1-transport-policy.2') fail('policy format');
  if (!Array.isArray(policy.geometry) || policy.geometry.length !== 3) fail('geometry rows');
  exactKeys(
    policy.profileLimits,
    [
      'encodedEnvelopeOverheadBytes',
      'expectedEvents',
      'maxChunkScalars',
      'maxChunks',
      'maxElapsedMs',
      'maxEncodedBytes',
      'maxJsonContentBytes',
      'maxPeakRssBytes',
      'maxRetainedTransportBytes',
      'maxSourceScalars',
      'maxTapeScalars',
      'maxTapeUtf8Bytes',
      'recordsPerChunk',
      'scalingMultiplier',
      'scalingSlackMs',
    ],
    'profileLimits',
  );
  exactKeys(
    policy.runtimeLimits,
    ['maxBytes', 'maxCollectionLength', 'maxDepth', 'maxDiagnostics', 'maxEvents', 'maxStringBytes'],
    'runtimeLimits',
  );
  exactKeys(policy.scheduler, ['timeoutMs'], 'scheduler');
  for (const [key, value] of Object.entries(policy.profileLimits)) {
    if (key === 'expectedEvents') {
      if (value !== 0) fail('expectedEvents must be zero');
    } else positiveSafe(value, `profileLimits.${key}`);
  }
  for (const [key, value] of Object.entries(policy.runtimeLimits)) positiveSafe(value, `runtimeLimits.${key}`);
  positiveSafe(policy.scheduler.timeoutMs, 'scheduler.timeoutMs');
  const limits = policy.profileLimits;
  if (limits.recordsPerChunk > 256 || limits.maxChunks > 256) fail('chunk geometry');
  if (limits.recordsPerChunk * limits.maxChunks !== limits.maxSourceScalars) fail('source geometry');
  const expected = [16_384, 32_768, 65_536].map((records) =>
    calculateWorstGeometry(records, limits.recordsPerChunk),
  );
  for (let index = 0; index < expected.length; index += 1) {
    exactKeys(policy.geometry[index], Object.keys(expected[index]), `geometry[${index}]`);
    for (const [key, value] of Object.entries(expected[index])) {
      if (policy.geometry[index][key] !== value) fail(`geometry[${index}].${key}`);
    }
  }
  const maximum = expected.at(-1);
  if (
    limits.maxTapeScalars < reserveFloor(maximum.tapeScalars) ||
    limits.maxTapeUtf8Bytes < reserveFloor(maximum.tapeUtf8Bytes) ||
    limits.maxJsonContentBytes < reserveFloor(maximum.jsonContentBytes) ||
    limits.maxChunkScalars < reserveFloor(maximum.maxChunkScalars) ||
    limits.maxRetainedTransportBytes < reserveFloor(maximum.retainedBytes)
  ) {
    fail('reserve floor');
  }
  if (limits.encodedEnvelopeOverheadBytes !== 497) fail('encoded envelope overhead');
  if (limits.maxEncodedBytes < reserveFloor(maximum.jsonContentBytes + limits.encodedEnvelopeOverheadBytes)) {
    fail('encoded reserve floor');
  }
  if (
    policy.runtimeLimits.maxBytes !== limits.maxEncodedBytes ||
    policy.runtimeLimits.maxStringBytes !== limits.maxTapeUtf8Bytes ||
    policy.runtimeLimits.maxEvents < 1
  ) {
    fail('runtime/profile limits disagree');
  }
  return policy;
}

export function materialize(value) {
  if (value.tag === 'null') return null;
  if (value.tag === 'boolean' || value.tag === 'text') return value.value;
  if (value.tag === 'integer') return Number(value.value);
  if (value.tag === 'list') return value.value.map(materialize);
  if (value.tag === 'record') return Object.fromEntries(value.value.map((entry) => [entry.key, materialize(entry.value)]));
  fail(`unsupported runtime value ${value.tag}`);
}

function takeUnsigned(points, state, terminal, label) {
  let raw = '';
  while (state.cursor < points.length && points[state.cursor] !== terminal) {
    raw += points[state.cursor];
    state.cursor += 1;
  }
  if (points[state.cursor] !== terminal) fail(`${label} boundary`);
  state.cursor += 1;
  return canonicalUnsigned(raw, label);
}

function takeText(points, state, terminal, label) {
  let value = '';
  while (state.cursor < points.length && points[state.cursor] !== terminal) {
    value += points[state.cursor];
    state.cursor += 1;
  }
  if (points[state.cursor] !== terminal || value.length === 0) fail(`${label} boundary`);
  state.cursor += 1;
  return value;
}

function parseRecord(points, state) {
  if (points[state.cursor] !== 'r') fail('record marker');
  state.cursor += 1;
  const ordinal = takeUnsigned(points, state, ',', 'record ordinal');
  const className = takeText(points, state, ',', 'record class');
  const kind = takeText(points, state, ',', 'record kind');
  const startScalar = takeUnsigned(points, state, ',', 'record start');
  const endScalar = takeUnsigned(points, state, ',', 'record end');
  const rawLength = takeUnsigned(points, state, ':', 'record raw length');
  if (rawLength <= 0 || state.cursor + rawLength > points.length) fail('record raw boundary');
  const raw = points.slice(state.cursor, state.cursor + rawLength).join('');
  state.cursor += rawLength;
  return { className, endScalar, kind, ordinal, raw, startScalar };
}

export function parseTape(tape) {
  const points = Array.from(tape);
  const state = { cursor: 0 };
  const chunks = [];
  while (state.cursor < points.length) {
    if (points[state.cursor] !== 'c') fail('chunk marker');
    state.cursor += 1;
    const ordinal = takeUnsigned(points, state, ',', 'chunk ordinal');
    const firstRecord = takeUnsigned(points, state, ',', 'chunk first record');
    const count = takeUnsigned(points, state, ',', 'chunk count');
    const payloadLength = takeUnsigned(points, state, ':', 'chunk payload length');
    if (payloadLength <= 0 || state.cursor + payloadLength > points.length) fail('chunk payload boundary');
    const payload = points.slice(state.cursor, state.cursor + payloadLength);
    state.cursor += payloadLength;
    if (points[state.cursor] !== 's') fail('chunk seal marker');
    state.cursor += 1;
    const seal = Array.from(String(ordinal));
    if (seal.some((point, index) => points[state.cursor + index] !== point)) fail('chunk seal ordinal');
    state.cursor += seal.length;
    if (state.cursor < points.length && points[state.cursor] !== 'c') fail('chunk terminal boundary');
    const payloadState = { cursor: 0 };
    const records = [];
    while (payloadState.cursor < payload.length) records.push(parseRecord(payload, payloadState));
    if (records.length !== count) fail('chunk record count');
    chunks.push({ count, firstRecord, ordinal, records });
  }
  return chunks;
}

export function encodeRecord(record) {
  return `r${record.ordinal},${record.className},${record.kind},${record.startScalar},${record.endScalar},${Array.from(record.raw).length}:${record.raw}`;
}

export function encodeChunk(chunk) {
  const payload = chunk.records.map(encodeRecord).join('');
  return `c${chunk.ordinal},${chunk.firstRecord},${chunk.records.length},${Array.from(payload).length}:${payload}s${chunk.ordinal}`;
}

export function decodeResult(fields, source, shape, limits) {
  if (!Array.isArray(fields) || fields.length !== RESULT_LENGTH || fields.some((field) => typeof field !== 'string')) {
    fail('result must be exactly nine strings');
  }
  const [format, status, code, sourceText, recordText, chunkText, maxListText, tape, seal] = fields;
  if (format !== RESULT_FORMAT) fail('result format');
  const sourceScalars = canonicalUnsigned(sourceText, 'sourceScalars');
  const recordCount = canonicalUnsigned(recordText, 'recordCount');
  const chunkCount = canonicalUnsigned(chunkText, 'chunkCount');
  const maxGuestListLength = canonicalUnsigned(maxListText, 'maxGuestListLength');
  if (status === 'failure') {
    if (!['FORCED_LATE_FAILURE', 'INVALID_LIMITS', 'SOURCE_LIMIT', 'TRANSPORT_LIMIT'].includes(code)) fail('failure code');
    if (recordCount !== 0 || chunkCount !== 0 || maxGuestListLength !== 0 || tape !== '' || seal !== 'failure') {
      fail('failure must be atomic');
    }
    return { chunks: [], fields, reconstructed: '', records: [], tape, values: { chunkCount, code, maxGuestListLength, recordCount, sourceScalars, status } };
  }
  if (status !== 'scanned' || code !== '') fail('result status');
  const sourcePoints = Array.from(source);
  if (sourcePoints.length !== sourceScalars || sourcePoints.length > limits.maxSourceScalars) fail('source count');
  if (recordCount !== sourcePoints.length) fail('record/source count');
  if (maxGuestListLength > Math.max(limits.recordsPerChunk, limits.maxChunks)) fail('guest list limit');
  const chunks = parseTape(tape);
  if (chunkCount !== chunks.length || chunkCount > limits.maxChunks) fail('chunk/result count');
  const records = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (chunk.ordinal !== index || chunk.firstRecord !== records.length || chunk.count <= 0 || chunk.count > limits.recordsPerChunk) {
      fail('chunk ordering');
    }
    records.push(...chunk.records);
  }
  if (records.length !== recordCount) fail('global record count');
  const raw = [];
  const actualShape = shape === 'mutation-suite' ? 'alternating' : shape;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.ordinal !== index || record.startScalar !== index || record.endScalar !== index + 1) fail('record span');
    const expectedClass = actualShape === 'trivia' || (actualShape === 'alternating' && index % 2 === 1) ? 'trivia' : 'token';
    const expectedKind = expectedClass === 'trivia' ? 'probe-trivia' : 'probe-token';
    if (record.className !== expectedClass || record.kind !== expectedKind) fail('record classification');
    if (record.raw !== sourcePoints[index]) fail('record raw');
    raw.push(record.raw);
  }
  const reconstructed = raw.join('');
  if (reconstructed !== source) fail('source reconstruction');
  if (seal !== `eof:${sourcePoints.length}:${records.length}:${chunks.length}:closed`) fail('result seal');
  const tapeScalars = Array.from(tape).length;
  const tapeUtf8Bytes = Buffer.byteLength(tape);
  const jsonContentBytes = Buffer.byteLength(JSON.stringify(tape)) - 2;
  if (
    tapeScalars > limits.maxTapeScalars ||
    tapeUtf8Bytes > limits.maxTapeUtf8Bytes ||
    jsonContentBytes > limits.maxJsonContentBytes ||
    9 * tapeUtf8Bytes > limits.maxRetainedTransportBytes
  ) {
    fail('logical transport wall');
  }
  return {
    chunks,
    fields,
    reconstructed,
    records,
    tape,
    values: { chunkCount, code, jsonContentBytes, maxGuestListLength, recordCount, sourceScalars, status, tapeScalars, tapeUtf8Bytes },
  };
}

export function buildSource(shape, size) {
  if (shape === 'ill-formed') return '\ud800';
  const patterns = {
    alternating: 'a ',
    astral: '😀',
    comment: '# note\n',
    escape: '\\"',
    fence: '<<<raw>>>\n',
    token: 'a',
    trivia: ' ',
  };
  const points = Array.from(patterns[shape] ?? patterns.alternating);
  return Array.from({ length: size }, (_, index) => points[index % points.length]).join('');
}

export function envelopeForFields(fields) {
  return {
    completion: { kind: 'return' },
    diagnostics: [],
    events: [],
    format: 'kern.runtime.handler.v1',
    outcome: 'success',
    result: { presence: 'value', value: { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) } },
  };
}

export function buildWorstFields(raw) {
  const records = 65_536;
  const perChunk = 256;
  const chunks = [];
  for (let chunk = 0; chunk < records / perChunk; chunk += 1) {
    const firstRecord = chunk * perChunk;
    const items = Array.from({ length: perChunk }, (_, index) => ({
      className: 'trivia',
      endScalar: firstRecord + index + 1,
      kind: 'probe-trivia',
      ordinal: firstRecord + index,
      raw,
      startScalar: firstRecord + index,
    }));
    chunks.push(encodeChunk({ firstRecord, ordinal: chunk, records: items }));
  }
  const tape = chunks.join('');
  return [RESULT_FORMAT, 'scanned', '', String(records), String(records), String(chunks.length), String(perChunk), tape, `eof:${records}:${records}:${chunks.length}:closed`];
}
