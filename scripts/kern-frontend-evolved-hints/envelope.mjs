import assert from 'node:assert/strict';

import { parseRetainedTokenStreamEnvelope } from '../check-kern-frontend-retained-token-stream.mjs';
import { parseGenericPropertyStyleThemeDiagnosticsEnvelope } from '../kern-frontend-generic-property-style-theme-diagnostics/envelope.mjs';
import { normalizeEvolvedHintsOracle } from './oracle.mjs';

const RECORD_WIDTH = 20;

// Closed over every compact failure emitted by the native M4.169 member.
// Adding a new native failure is a protocol change and must update this list.
const EVOLVED_HINT_FAILURE_CODES = Object.freeze([
  'EVOLVED_HINT_BYTES_LIMIT',
  'EVOLVED_HINT_FIELDS_LIMIT',
  'EVOLVED_HINT_INVALID',
  'EVOLVED_HINT_PREDECESSOR_INVALID',
  'EVOLVED_HINT_STREAM_INVALID',
  'EVOLVED_HINT_TYPE_INVALID',
  'EVOLVED_HINT_WRITE_LIMIT',
]);

function fail(detail) {
  throw new Error(`evolved-hints envelope rejection: ${detail}`);
}

function uint(field, label) {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(field)) fail(`${label} must be a canonical uint`);
  const value = Number(field);
  if (!Number.isSafeInteger(value)) fail(`${label} exceeds safe integer`);
  return value;
}

function textList(fields) {
  return { tag: 'list', value: fields.map((value) => ({ tag: 'text', value })) };
}

function collectAuth(fields, cursor, fieldCount, tag) {
  const authenticated = [];
  let authIndex = 0;
  while (authenticated.length < fieldCount) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    const count = uint(record[3], `${tag} count`);
    if (
      record.length !== RECORD_WIDTH || record[0] !== tag || uint(record[1], `${tag} index`) !== authIndex ||
      uint(record[2], `${tag} start`) !== authenticated.length || count <= 0 || count > 16 ||
      count > fieldCount - authenticated.length || record.slice(4 + count).some(Boolean)
    ) fail(`${tag} authentication drift`);
    authenticated.push(...record.slice(4, 4 + count));
    authIndex += 1;
    cursor += RECORD_WIDTH;
  }
  return { authenticated, cursor };
}

function parseFailure(content, snapshot, fields, policy) {
  if (fields.length !== 41 || fields[1] !== 'failure' || fields[21] !== 'failure-seal') {
    fail('invalid bounded failure envelope');
  }
  if (
    fields[2] !== fields[22] || fields[3] !== fields[23] || fields[24] !== content ||
    fields[4] !== fields[25] || fields[5] !== fields[26] || fields.slice(6, 21).some(Boolean) ||
    fields.slice(27).some(Boolean)
  ) fail('failure seal drift');
  if (
    fields[4] !== String(snapshot.runtimeInstance) ||
    fields[5] !== String(snapshot.parseEpoch)
  ) fail('failure identity drift');
  if (!EVOLVED_HINT_FAILURE_CODES.includes(fields[2])) fail('failure code contract drift');
  if (fields[3] !== '') fail('failure detail contract drift');
  return { code: fields[2], detail: fields[3], format: policy.evolvedHintsFormat, status: 'failure' };
}

function applyProperties(writes, predecessor) {
  const props = {};
  for (const write of writes) props[write.name] = write.value;
  for (const property of predecessor.finalProperties) {
    props[property.key] = property.valueKind === 'expr' ? { __expr: true, code: property.value } : property.value;
  }
  if (predecessor.finalStyles.length > 0) {
    props.styles = Object.fromEntries(predecessor.finalStyles.map(({ key, value }) => [key, value]));
  }
  if (predecessor.finalPseudoStyles.length > 0) {
    props.pseudoStyles = Object.fromEntries(predecessor.finalPseudoStyles.map(
      ({ entries, pseudo }) => [pseudo, Object.fromEntries(entries.map(({ key, value }) => [key, value]))],
    ));
  }
  if (predecessor.themeRefs.length > 0) props.themeRefs = predecessor.themeRefs;
  return props;
}

export function parseEvolvedHintsEnvelope(content, snapshot, fields, policy) {
  if (
    fields[0] !== policy.evolvedHintsFormat || fields.length < 41 || (fields.length - 1) % RECORD_WIDTH !== 0 ||
    fields.length > policy.maxEvolvedHintsEnvelopeFields ||
    Buffer.byteLength(fields.join(''), 'utf8') > policy.maxEvolvedHintsEnvelopeBytes
  ) fail('invalid evolved-hints envelope');
  if (fields[1] === 'failure') return parseFailure(content, snapshot, fields, policy);
  const header = fields.slice(1, 21);
  const writeCount = uint(header[6], 'write count');
  const predecessorFieldCount = uint(header[8], 'predecessor field count');
  const streamFieldCount = uint(header[9], 'stream field count');
  const maskedStreamFieldCount = uint(header[10], 'masked stream field count');
  const writes = [];
  let cursor = 21;
  for (let index = 0; index < writeCount; index += 1) {
    const record = fields.slice(cursor, cursor + RECORD_WIDTH);
    if (
      record.length !== RECORD_WIDTH || record[0] !== 'hint-write' || uint(record[1], 'write index') !== index ||
      record[9] !== header[11] || record[10] !== header[12] || record.slice(11).some(Boolean)
    ) fail('hint write drift');
    writes.push({
      endScalar: uint(record[7], 'write end'), index, kind: record[5], name: record[2], source: record[8],
      startScalar: uint(record[6], 'write start'), tokenIndex: uint(record[4], 'write token index'), value: record[3],
    });
    cursor += RECORD_WIDTH;
  }
  const predecessorAuth = collectAuth(fields, cursor, predecessorFieldCount, 'predecessor-auth');
  cursor = predecessorAuth.cursor;
  const streamAuth = collectAuth(fields, cursor, streamFieldCount, 'stream-auth');
  cursor = streamAuth.cursor;
  const maskedStreamAuth = collectAuth(fields, cursor, maskedStreamFieldCount, 'masked-stream-auth');
  cursor = maskedStreamAuth.cursor;
  if (cursor !== fields.length - RECORD_WIDTH) fail('seal must be terminal');
  const seal = fields.slice(cursor);
  if (
    seal[0] !== 'seal' || seal[1] !== header[1] || seal[2] !== header[2] || seal[3] !== header[3] ||
    seal[4] !== header[4] || seal[5] !== header[5] || seal[6] !== header[6] || seal[7] !== header[7] ||
    seal[8] !== header[8] || seal[9] !== header[9] || seal[10] !== header[10] || seal[11] !== content ||
    seal[12] !== header[11] || seal[13] !== header[12] || seal[14] !== header[13] || seal[15] !== header[14] ||
    seal[16] !== header[15] || seal[17] !== header[16] || seal[18] !== header[17] || seal[19] !== header[18]
  ) fail('seal drift');
  if (
    header[0] !== 'decision' || uint(header[11], 'runtime instance') !== snapshot.runtimeInstance ||
    uint(header[12], 'parse epoch') !== snapshot.parseEpoch ||
    uint(header[13], 'max writes') !== policy.maxEvolvedHintWrites ||
    uint(header[14], 'max fields') !== policy.maxEvolvedHintsEnvelopeFields ||
    uint(header[15], 'max bytes') !== policy.maxEvolvedHintsEnvelopeBytes ||
    header[16] !== policy.genericPropertyStyleThemeDiagnosticsFormat ||
    header[17] !== policy.retainedTokenStreamFormat || header[18] !== policy.evolvedHintsSourceProfile || header[19] !== ''
  ) fail('header drift');

  const stream = parseRetainedTokenStreamEnvelope(content, textList(streamAuth.authenticated), policy);
  const expected = normalizeEvolvedHintsOracle(content, snapshot, stream);
  assert.deepEqual(writes, expected.writes);
  if (
    header[1] !== expected.maskedContent || header[2] !== expected.admittedType ||
    header[3] !== expected.hintSource || header[4] !== expected.bareWord ||
    uint(header[5], 'positional count') !== expected.positionalCount ||
    uint(header[7], 'exit field cursor') !== expected.exitFieldCursor
  ) fail('hint decision drift');
  const maskedStream = parseRetainedTokenStreamEnvelope(
    expected.maskedContent, textList(maskedStreamAuth.authenticated), policy,
  );
  const predecessor = parseGenericPropertyStyleThemeDiagnosticsEnvelope(
    expected.maskedContent, snapshot, predecessorAuth.authenticated, policy,
    maskedStreamAuth.authenticated, maskedStream,
  );
  if (predecessor.status === 'failure') fail('decision authenticates a failed predecessor');
  return {
    ...expected,
    diagnostics: predecessor.diagnostics,
    format: policy.evolvedHintsFormat,
    predecessor,
    props: applyProperties(writes, predecessor),
    runtimeInstance: snapshot.runtimeInstance,
    parseEpoch: snapshot.parseEpoch,
    status: 'decision',
    stream,
  };
}
