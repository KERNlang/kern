import { parseGenericPropertyStyleThemeEnvelope } from '../check-kern-frontend-generic-property-style-theme.mjs';
import { parseGenericPropertyStyleThemeReplay } from '../kern-frontend-generic-property-style-theme/envelope.mjs';
import { parseGenericPropertyStyleThemeDiagnosticProjection } from './projection.mjs';

const RECORD_WIDTH = 20;

function fail(detail) {
  throw new Error(`style/theme diagnostics envelope rejection: ${detail}`);
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
      record.length !== RECORD_WIDTH || record[0] !== tag ||
      uint(record[1], `${tag} index`) !== authIndex ||
      uint(record[2], `${tag} start`) !== authenticated.length || count <= 0 || count > 16 ||
      count > fieldCount - authenticated.length || record.slice(4 + count).some(Boolean)
    ) fail(`${tag} authentication drift`);
    authenticated.push(...record.slice(4, 4 + count));
    cursor += RECORD_WIDTH;
    authIndex += 1;
  }
  return { authenticated, cursor };
}

function parseFailure(content, fields, policy) {
  if (fields.length !== 41 || fields[1] !== 'failure' || fields[21] !== 'failure-seal') {
    fail('invalid bounded failure envelope');
  }
  if (
    fields[2] !== fields[22] || fields[3] !== fields[23] || fields[24] !== content ||
    fields[4] !== fields[25] || fields[5] !== fields[26] || fields.slice(6, 21).some(Boolean) ||
    fields.slice(27).some(Boolean)
  ) fail('failure seal drift');
  return {
    code: fields[2], detail: fields[3], format: policy.genericPropertyStyleThemeDiagnosticsFormat,
    status: 'failure',
  };
}

function derivedStream(originalStream, projection) {
  const replacements = new Map(projection.diagnostics.map(({ tokenIndex }) => [tokenIndex, 'whitespace']));
  return {
    ...originalStream,
    tokens: originalStream.tokens.map((token, index) => (
      replacements.has(index) ? { ...token, kind: replacements.get(index) } : token
    )),
  };
}

function replayInherited(predecessor, projection) {
  if (predecessor.status !== 'failure') return predecessor.inherited;
  if (projection.reachableStyleCount > 0) return { code: 'THEME_PROFILE', detail: '', status: 'failure' };
  return { status: 'decision' };
}

function mergedDiagnostics(projection, replay) {
  const unexpected = projection.diagnostics.map((diagnostic) => ({ ...diagnostic, endLine: 1 }));
  const duplicates = replay.diagnostics.map((diagnostic) => {
    const write = replay.writes[diagnostic.writeIndex];
    if (!write) fail('duplicate diagnostic write is missing');
    return {
      ...diagnostic,
      category: 'parser',
      suggestion: 'Remove the duplicate property or merge the values into a single prop assignment.',
      tokenIndex: write.propertyIndex,
    };
  });
  return [...unexpected, ...duplicates]
    .sort((left, right) => left.tokenIndex - right.tokenIndex)
    .map((diagnostic, index) => ({ ...diagnostic, index }));
}

export function parseGenericPropertyStyleThemeDiagnosticsEnvelope(
  content,
  snapshot,
  fields,
  policy,
  originalStreamFields,
  originalStream,
) {
  if (
    fields[0] !== policy.genericPropertyStyleThemeDiagnosticsFormat || fields.length < 41 ||
    (fields.length - 1) % RECORD_WIDTH !== 0 ||
    fields.length > policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeFields ||
    Buffer.byteLength(fields.join(''), 'utf8') > policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes
  ) fail('invalid diagnostics envelope');
  if (fields[1] === 'failure') return parseFailure(content, fields, policy);

  const header = fields.slice(1, 21);
  const predecessorFieldCount = uint(header[3], 'predecessor field count');
  const projectionFieldCount = uint(header[4], 'projection field count');
  const replayFieldCount = uint(header[5], 'replay field count');
  let cursor = 21;
  const predecessorAuth = collectAuth(fields, cursor, predecessorFieldCount, 'predecessor-auth');
  cursor = predecessorAuth.cursor;
  const projectionAuth = collectAuth(fields, cursor, projectionFieldCount, 'projection-auth');
  cursor = projectionAuth.cursor;
  const replayAuth = collectAuth(fields, cursor, replayFieldCount, 'replay-auth');
  cursor = replayAuth.cursor;
  if (cursor !== fields.length - RECORD_WIDTH) fail('diagnostics seal must be terminal');

  const predecessor = parseGenericPropertyStyleThemeEnvelope(
    content, snapshot, textList(predecessorAuth.authenticated), policy,
  );
  const projection = parseGenericPropertyStyleThemeDiagnosticProjection(
    content, snapshot, projectionAuth.authenticated, policy, originalStreamFields, originalStream,
  );
  if (projection.status === 'failure') fail('decision authenticates a failed projection');
  const replay = parseGenericPropertyStyleThemeReplay(
    content, snapshot, replayAuth.authenticated, policy,
    replayInherited(predecessor, projection), derivedStream(originalStream, projection),
  );
  if (replay.status === 'failure') fail('decision authenticates a failed replay');

  const predecessorTag = predecessor.status === 'failure' ? 'failure' : 'decision';
  const predecessorCode = predecessor.status === 'failure' ? predecessor.code : '';
  if (
    header[0] !== 'decision' || header[1] !== replay.state ||
    uint(header[2], 'unexpected count') !== projection.diagnostics.length ||
    uint(header[6], 'runtime instance') !== snapshot.runtimeInstance ||
    uint(header[7], 'parse epoch') !== snapshot.parseEpoch ||
    header[8] !== policy.genericPropertyStyleThemeFormat ||
    header[9] !== policy.genericPropertyStyleThemeDiagnosticProjectionFormat ||
    header[10] !== policy.genericPropertyStyleThemeReplayFormat ||
    uint(header[11], 'bound diagnostics fields') !== policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeFields ||
    uint(header[12], 'bound diagnostics bytes') !== policy.maxGenericPropertyStyleThemeDiagnosticsEnvelopeBytes ||
    header[13] !== predecessorTag || header[14] !== predecessorCode ||
    header[15] !== policy.styleBlockEvidenceFormat || header.slice(16).some(Boolean)
  ) fail('diagnostics header drift');
  if (
    (predecessorTag === 'failure' && (predecessorCode !== 'STYLE_PROFILE' || projection.diagnostics.length === 0)) ||
    (predecessorTag === 'decision' && projection.diagnostics.length !== 0)
  ) fail('predecessor and projection contradict each other');

  const seal = fields.slice(cursor);
  if (
    seal[0] !== 'seal' || seal[1] !== header[1] || seal[2] !== header[2] ||
    seal[3] !== header[3] || seal[4] !== header[4] || seal[5] !== header[5] ||
    seal[6] !== content || seal[7] !== header[6] || seal[8] !== header[7] ||
    seal[9] !== header[8] || seal[10] !== header[9] || seal[11] !== header[10] ||
    seal[12] !== header[11] || seal[13] !== header[12] || seal[14] !== header[13] ||
    seal[15] !== header[14] || seal[16] !== header[15] || seal.slice(17).some(Boolean)
  ) fail('diagnostics seal drift');

  const duplicateDiagnostics = replay.diagnostics;
  const unexpectedDiagnostics = projection.diagnostics;
  return {
    ...replay,
    diagnostics: mergedDiagnostics(projection, replay),
    duplicateDiagnostics,
    format: policy.genericPropertyStyleThemeDiagnosticsFormat,
    predecessor,
    projection,
    sourceProfile: policy.genericPropertyStyleThemeDiagnosticsSourceProfile,
    unexpectedDiagnostics,
  };
}
